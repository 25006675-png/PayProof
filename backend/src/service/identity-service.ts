import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { DomainError, type Actor } from "../domain/types.js";
import type {
  IdentityStore,
  PayProofAccount,
} from "../store/identity-store.js";

const encoder = new TextEncoder();

export interface IdentityServiceOptions {
  sessionSecret: string;
  zkLoginSaltSecret: string;
  now?: () => Date;
}

export class IdentityService {
  private readonly now: () => Date;
  private readonly sessionKey: Uint8Array;

  constructor(
    private readonly store: IdentityStore,
    private readonly options: IdentityServiceOptions,
  ) {
    if (options.sessionSecret.length < 32)
      throw new Error("PAYPROOF_SESSION_SECRET must contain at least 32 characters");
    if (options.zkLoginSaltSecret.length < 32)
      throw new Error("ZKLOGIN_SALT_MASTER_KEY must contain at least 32 characters");
    this.now = options.now ?? (() => new Date());
    this.sessionKey = encoder.encode(options.sessionSecret);
  }

  async resolveSupabaseUser(actor: Actor): Promise<PayProofAccount> {
    return this.store.upsertSupabaseAccount({
      supabaseUserId: actor.id,
      email: actor.email,
      name: actor.name,
    });
  }

  async account(id: string): Promise<PayProofAccount | undefined> {
    return this.store.findAccountById(id);
  }

  zkLoginSalt(accountId: string): string {
    const digest = createHmac("sha256", this.options.zkLoginSaltSecret)
      .update(`payproof:zklogin:${accountId}`)
      .digest()
      .subarray(0, 16);
    return BigInt(`0x${digest.toString("hex")}`).toString(10);
  }

  async linkZkLoginAddress(input: {
    accountId: string;
    address: string;
    issuer: string;
    audience: string;
  }): Promise<PayProofAccount> {
    try {
      return await this.store.linkSuiAddress({
        ...input,
        address: normalizeSuiAddress(input.address),
        kind: "zklogin",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SUI_ADDRESS_ALREADY_LINKED")
        throw new DomainError(
          "SUI_ADDRESS_ALREADY_LINKED",
          "This Sui address is already linked to another PayProof account",
          409,
        );
      throw error;
    }
  }

  async createWalletChallenge(address: string, origin: string) {
    const normalized = normalizeSuiAddress(address);
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    const id = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const message = [
      "Sign in to PayProof",
      "",
      `Address: ${normalized}`,
      `Origin: ${origin}`,
      "Network: Sui",
      `Nonce: ${nonce}`,
      `Issued at: ${issuedAt.toISOString()}`,
      `Expires at: ${expiresAt.toISOString()}`,
      "",
      "This request does not submit a transaction or spend funds.",
    ].join("\n");
    await this.store.createChallenge({
      id,
      address: normalized,
      message,
      expiresAt: expiresAt.toISOString(),
    });
    return { id, message, expiresAt: expiresAt.toISOString() };
  }

  async verifyWalletChallenge(input: {
    challengeId: string;
    address: string;
    signature: string;
  }): Promise<{ account: PayProofAccount; accessToken: string }> {
    const normalized = normalizeSuiAddress(input.address);
    const challenge = await this.store.getChallenge(input.challengeId);
    if (!challenge)
      throw new DomainError("CHALLENGE_NOT_FOUND", "The wallet challenge was not found", 404);
    if (challenge.usedAt)
      throw new DomainError("CHALLENGE_ALREADY_USED", "This wallet challenge has already been used", 409);
    if (challenge.address !== normalized)
      throw new DomainError("CHALLENGE_ADDRESS_MISMATCH", "The connected wallet does not match the challenge", 403);
    if (new Date(challenge.expiresAt).getTime() <= this.now().getTime())
      throw new DomainError("CHALLENGE_EXPIRED", "The wallet challenge has expired", 410);

    try {
      await verifyPersonalMessageSignature(
        encoder.encode(challenge.message),
        input.signature,
        { address: normalized },
      );
    } catch {
      throw new DomainError(
        "INVALID_WALLET_SIGNATURE",
        "The signature does not prove control of the connected Sui address",
        401,
      );
    }

    const consumed = await this.store.consumeChallenge(
      input.challengeId,
      this.now().toISOString(),
    );
    if (!consumed)
      throw new DomainError("CHALLENGE_ALREADY_USED", "This wallet challenge has already been used", 409);
    const account = await this.store.createWalletAccount(normalized);
    return { account, accessToken: await this.issueSession(account) };
  }

  async verifySession(token: string): Promise<Actor> {
    try {
      const { payload } = await jwtVerify(token, this.sessionKey, {
        issuer: "payproof",
        audience: "payproof-api",
      });
      if (!payload.sub) throw new Error("missing subject");
      const account = await this.store.findAccountById(payload.sub);
      if (!account) throw new Error("account not found");
      return {
        id: account.id,
        email: account.email,
        name: account.name,
      };
    } catch {
      throw new DomainError("UNAUTHORIZED", "Invalid or expired user token", 401);
    }
  }

  private async issueSession(account: PayProofAccount): Promise<string> {
    return new SignJWT({ address: account.verifiedSuiAddress, auth: "sui-wallet" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("payproof")
      .setAudience("payproof-api")
      .setSubject(account.id)
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(this.sessionKey);
  }
}

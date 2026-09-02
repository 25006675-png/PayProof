import { createRemoteJWKSet, jwtVerify } from "jose";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  computeZkLoginAddress,
  genAddressSeed,
  generateNonce,
  getExtendedEphemeralPublicKey,
  type ZkLoginSignatureInputs,
} from "@mysten/sui/zklogin";
import { DomainError } from "../domain/types.js";
import type { IdentityService } from "./identity-service.js";

export interface VerifiedGoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  audience: string;
  nonce: string;
}

export interface GoogleTokenVerifier {
  verify(token: string): Promise<VerifiedGoogleClaims>;
}

export interface ZkProofProvider {
  prove(input: {
    jwt: string;
    extendedEphemeralPublicKey: string;
    maxEpoch: number;
    jwtRandomness: string;
    salt: string;
    keyClaimName: "sub";
  }): Promise<Omit<ZkLoginSignatureInputs, "addressSeed">>;
}

/** Enoki hosts the prover and manages the user salt, so it returns the address with the proof. */
export interface ZkLoginIssuer {
  issue(input: {
    jwt: string;
    publicKey: Ed25519PublicKey;
    maxEpoch: number;
    randomness: string;
  }): Promise<{ address: string; inputs: ZkLoginSignatureInputs }>;
}

export class EnokiZkLoginIssuer implements ZkLoginIssuer {
  constructor(
    private readonly apiKey: string,
    private readonly network: string,
    private readonly baseUrl = "https://api.enoki.mystenlabs.com/v1",
  ) {}

  private async call<T>(path: string, jwt: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "zklogin-jwt": jwt,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 400).trim();
      console.error(`Enoki ${response.status} on ${path}: ${detail || "(empty body)"}`);
      throw new DomainError(
        "ZKLOGIN_PROOF_FAILED",
        `Enoki could not complete this login (${response.status})${detail ? `: ${detail}` : ""}`,
        502,
      );
    }
    return (await response.json() as { data: T }).data;
  }

  async issue(input: { jwt: string; publicKey: Ed25519PublicKey; maxEpoch: number; randomness: string }) {
    const { address } = await this.call<{ address: string; salt: string }>("/zklogin", input.jwt);
    // Enoki expects the Sui public key encoding, not raw base64.
    const inputs = await this.call<ZkLoginSignatureInputs>("/zklogin/zkp", input.jwt, {
      method: "POST",
      body: JSON.stringify({
        network: this.network,
        ephemeralPublicKey: input.publicKey.toSuiPublicKey(),
        maxEpoch: input.maxEpoch,
        randomness: input.randomness,
      }),
    });
    return { address, inputs };
  }
}

export class GoogleOidcTokenVerifier implements GoogleTokenVerifier {
  private readonly jwks = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  );

  constructor(private readonly audiences: string[]) {
    if (audiences.length === 0) throw new Error("GOOGLE_OAUTH_CLIENT_ID is required");
  }

  async verify(token: string): Promise<VerifiedGoogleClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: this.audiences,
      });
      if (
        !payload.sub ||
        typeof payload.email !== "string" ||
        payload.email_verified !== true ||
        typeof payload.iss !== "string" ||
        typeof payload.aud !== "string" ||
        typeof payload.nonce !== "string"
      ) throw new Error("required Google claims are missing");
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: true,
        issuer: payload.iss,
        audience: payload.aud,
        nonce: payload.nonce,
      };
    } catch {
      throw new DomainError(
        "INVALID_GOOGLE_ID_TOKEN",
        "Google could not verify this zkLogin request",
        401,
      );
    }
  }
}

export class HttpZkProofProvider implements ZkProofProvider {
  constructor(private readonly url: string) {
    if (!/^https:\/\//.test(url)) throw new Error("ZKLOGIN_PROVER_URL must use HTTPS");
  }

  async prove(input: Parameters<ZkProofProvider["prove"]>[0]) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // The prover explains rejections in the body, so carry it through instead of losing it.
      const detail = (await response.text().catch(() => "")).slice(0, 400).trim();
      console.error(`zkLogin prover ${response.status} from ${this.url}: ${detail || "(empty body)"}`);
      throw new DomainError(
        "ZKLOGIN_PROOF_FAILED",
        `The Sui proof service could not complete this login (${response.status})${detail ? `: ${detail}` : ""}`,
        502,
      );
    }
    return await response.json() as Omit<ZkLoginSignatureInputs, "addressSeed">;
  }
}

export class ZkLoginService {
  constructor(
    private readonly identity: IdentityService,
    private readonly google: GoogleTokenVerifier,
    private readonly prover: ZkProofProvider | undefined,
    private readonly enoki?: ZkLoginIssuer,
  ) {}

  async complete(accountId: string, input: {
    googleIdToken: string;
    ephemeralPublicKey: string;
    randomness: string;
    maxEpoch: number;
  }) {
    const account = await this.identity.account(accountId);
    if (!account?.supabaseUserId)
      throw new DomainError(
        "GOOGLE_ACCOUNT_REQUIRED",
        "A Google-authenticated PayProof account is required for zkLogin",
        403,
      );
    const claims = await this.google.verify(input.googleIdToken);
    if (!account.email || claims.email !== account.email.toLowerCase())
      throw new DomainError(
        "GOOGLE_ACCOUNT_MISMATCH",
        "The Google identity does not match the PayProof session",
        403,
      );
    const publicKey = new Ed25519PublicKey(input.ephemeralPublicKey);
    const expectedNonce = generateNonce(publicKey, input.maxEpoch, input.randomness);
    if (claims.nonce !== expectedNonce)
      throw new DomainError(
        "ZKLOGIN_NONCE_MISMATCH",
        "The Google token is not bound to this zkLogin signing key",
        401,
      );

    const issued = this.enoki
      ? await this.enoki.issue({
          jwt: input.googleIdToken,
          publicKey,
          maxEpoch: input.maxEpoch,
          randomness: input.randomness,
        })
      : await this.selfIssue(input.googleIdToken, publicKey, input.maxEpoch, input.randomness, account.id, claims);
    await this.identity.linkZkLoginAddress({
      accountId: account.id,
      address: issued.address,
      issuer: claims.issuer,
      audience: claims.audience,
    });
    return { address: issued.address, maxEpoch: input.maxEpoch, inputs: issued.inputs };
  }

  /** Salt derived here, proof from a prover we point at ourselves. */
  private async selfIssue(
    jwt: string,
    publicKey: Ed25519PublicKey,
    maxEpoch: number,
    randomness: string,
    accountId: string,
    claims: VerifiedGoogleClaims,
  ): Promise<{ address: string; inputs: ZkLoginSignatureInputs }> {
    if (!this.prover)
      throw new DomainError("ZKLOGIN_PROOF_FAILED", "No zkLogin proof service is configured", 500);
    const salt = this.identity.zkLoginSalt(accountId);
    const proof = await this.prover.prove({
      jwt,
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(publicKey),
      maxEpoch,
      jwtRandomness: randomness,
      salt,
      keyClaimName: "sub",
    });
    const addressSeed = genAddressSeed(
      salt,
      "sub",
      claims.sub,
      claims.audience,
    ).toString();
    const address = computeZkLoginAddress({
      claimName: "sub",
      claimValue: claims.sub,
      userSalt: salt,
      iss: claims.issuer,
      aud: claims.audience,
      legacyAddress: false,
    });
    return { address, inputs: { ...proof, addressSeed } satisfies ZkLoginSignatureInputs };
  }
}

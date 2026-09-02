import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../src/service/identity-service.js";
import { MemoryIdentityStore } from "../src/store/identity-store.js";

const SESSION_SECRET = "test-only-session-secret-that-is-at-least-thirty-two-bytes";
const SALT_SECRET = "test-only-zklogin-salt-secret-at-least-thirty-two-bytes";

describe("IdentityService", () => {
  it("returns the same PayProof account and zkLogin salt for a returning Supabase user", async () => {
    const store = new MemoryIdentityStore();
    const service = new IdentityService(store, {
      sessionSecret: SESSION_SECRET,
      zkLoginSaltSecret: SALT_SECRET,
    });

    const first = await service.resolveSupabaseUser({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
      name: "Buyer",
    });
    const second = await service.resolveSupabaseUser({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
      name: "Buyer Updated",
    });

    expect(second.id).toBe(first.id);
    expect(service.zkLoginSalt(first.id)).toBe(service.zkLoginSalt(second.id));
  });

  it("verifies a wallet challenge once and rejects replay", async () => {
    const keypair = Ed25519Keypair.generate();
    const address = keypair.toSuiAddress();
    const store = new MemoryIdentityStore();
    let now = new Date("2026-09-02T00:00:00.000Z");
    const service = new IdentityService(store, {
      sessionSecret: SESSION_SECRET,
      zkLoginSaltSecret: SALT_SECRET,
      now: () => now,
    });

    const challenge = await service.createWalletChallenge(address, "http://localhost:3000");
    const { signature } = await keypair.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );
    const verified = await service.verifyWalletChallenge({
      challengeId: challenge.id,
      address,
      signature,
    });

    expect(verified.account.verifiedSuiAddress).toBe(address);
    expect(verified.accessToken).toBeTruthy();
    await expect(
      service.verifyWalletChallenge({ challengeId: challenge.id, address, signature }),
    ).rejects.toMatchObject({ code: "CHALLENGE_ALREADY_USED" });

    now = new Date("2026-09-02T00:10:00.000Z");
  });

  it("rejects a challenge signed by a different wallet", async () => {
    const expected = Ed25519Keypair.generate();
    const attacker = Ed25519Keypair.generate();
    const service = new IdentityService(new MemoryIdentityStore(), {
      sessionSecret: SESSION_SECRET,
      zkLoginSaltSecret: SALT_SECRET,
    });
    const challenge = await service.createWalletChallenge(
      expected.toSuiAddress(),
      "http://localhost:3000",
    );
    const { signature } = await attacker.signPersonalMessage(
      new TextEncoder().encode(challenge.message),
    );

    await expect(
      service.verifyWalletChallenge({
        challengeId: challenge.id,
        address: expected.toSuiAddress(),
        signature,
      }),
    ).rejects.toMatchObject({ code: "INVALID_WALLET_SIGNATURE" });
  });
});

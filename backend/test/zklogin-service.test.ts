import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { generateNonce, generateRandomness } from "@mysten/sui/zklogin";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../src/service/identity-service.js";
import { ZkLoginService } from "../src/service/zklogin-service.js";
import { MemoryIdentityStore } from "../src/store/identity-store.js";

describe("ZkLoginService", () => {
  it("uses the Google ID-token claims and maps a stable verified Sui address", async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), {
      sessionSecret: "test-only-session-secret-that-is-at-least-thirty-two-bytes",
      zkLoginSaltSecret: "test-only-zklogin-salt-secret-at-least-thirty-two-bytes",
    });
    const account = await identity.resolveSupabaseUser({
      id: "11111111-1111-4111-8111-111111111111",
      email: "buyer@example.com",
    });
    const ephemeral = Ed25519Keypair.generate();
    const randomness = generateRandomness();
    const maxEpoch = 42;
    const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);
    const google = {
      verify: async () => ({
        sub: "google-subject",
        email: "buyer@example.com",
        emailVerified: true,
        issuer: "https://accounts.google.com",
        audience: "google-client-id",
        nonce,
      }),
    };
    let proverJwt = "";
    const prover = {
      prove: async (input: { jwt: string }) => {
        proverJwt = input.jwt;
        return {
          proofPoints: { a: ["1", "2", "3"], b: [["1", "2"], ["3", "4"], ["5", "6"]], c: ["1", "2", "3"] },
          issBase64Details: { value: "issuer", indexMod4: 0 },
          headerBase64: "header",
        };
      },
    };
    const service = new ZkLoginService(identity, google, prover);
    const result = await service.complete(account.id, {
      googleIdToken: "google.id.token",
      ephemeralPublicKey: ephemeral.getPublicKey().toBase64(),
      randomness,
      maxEpoch,
    });

    expect(proverJwt).toBe("google.id.token");
    expect(result.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.inputs.addressSeed).toMatch(/^\d+$/);
    expect((await identity.account(account.id))?.verifiedSuiAddress).toBe(result.address);
  });

  it("rejects a Google token whose nonce is not bound to the ephemeral key", async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), {
      sessionSecret: "test-only-session-secret-that-is-at-least-thirty-two-bytes",
      zkLoginSaltSecret: "test-only-zklogin-salt-secret-at-least-thirty-two-bytes",
    });
    const account = await identity.resolveSupabaseUser({ id: "user", email: "buyer@example.com" });
    const ephemeral = Ed25519Keypair.generate();
    const google = { verify: async () => ({ sub: "sub", email: "buyer@example.com", emailVerified: true, issuer: "https://accounts.google.com", audience: "client", nonce: "wrong" }) };
    const prover = { prove: async () => { throw new Error("must not call prover"); } };
    const service = new ZkLoginService(identity, google, prover);
    await expect(service.complete(account.id, {
      googleIdToken: "google.id.token",
      ephemeralPublicKey: ephemeral.getPublicKey().toBase64(),
      randomness: generateRandomness(),
      maxEpoch: 42,
    })).rejects.toMatchObject({ code: "ZKLOGIN_NONCE_MISMATCH" });
  });
});

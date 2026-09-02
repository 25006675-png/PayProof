import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";
import { CompositeTokenVerifier, MappedSupabaseTokenVerifier } from "../src/api/identity-auth.js";
import { IdentityService } from "../src/service/identity-service.js";
import { MemoryIdentityStore } from "../src/store/identity-store.js";

const options = {
  sessionSecret: "test-only-session-secret-that-is-at-least-thirty-two-bytes",
  zkLoginSaltSecret: "test-only-zklogin-salt-secret-at-least-thirty-two-bytes",
};

describe("mapped authentication", () => {
  it("maps repeat Supabase JWT subjects to one PayProof actor", async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), options);
    const supabase = { verify: async () => ({ id: "supabase-user", email: "buyer@example.com" }) };
    const verifier = new MappedSupabaseTokenVerifier(supabase, identity);
    const first = await verifier.verify("first-token");
    const second = await verifier.verify("refreshed-token");
    expect(second.id).toBe(first.id);
    expect(second.email).toBe("buyer@example.com");
  });

  it("accepts a PayProof wallet session without sending it to Supabase", async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), options);
    const keypair = Ed25519Keypair.generate();
    const challenge = await identity.createWalletChallenge(keypair.toSuiAddress(), "http://localhost:3000");
    const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
    const session = await identity.verifyWalletChallenge({
      challengeId: challenge.id,
      address: keypair.toSuiAddress(),
      signature,
    });
    let supabaseCalls = 0;
    const supabase = { verify: async () => { supabaseCalls += 1; throw new Error("not a Supabase token"); } };
    const verifier = new CompositeTokenVerifier(
      new MappedSupabaseTokenVerifier(supabase, identity),
      identity,
    );
    expect((await verifier.verify(session.accessToken)).id).toBe(session.account.id);
    expect(supabaseCalls).toBe(0);
  });
});

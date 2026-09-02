import { describe, expect, it } from "vitest";
import { createApp, type TokenVerifier } from "../src/api/app.js";
import { DemoOrderService } from "../src/demo/demo-service.js";
import { DisputeService } from "../src/service/dispute-service.js";
import { MemoryDisputeStore } from "../src/store/store.js";
import { MemoryIdentityStore } from "../src/store/identity-store.js";
import { IdentityService } from "../src/service/identity-service.js";
import { BUYER, SUPPLIER, controlledContext, openInput } from "./fixtures.js";

describe("HTTP API", () => {
  it("requires authentication and executes an opening request", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const app = createApp(new DisputeService(new MemoryDisputeStore(), control.ctx), verifier);
    expect((await app.request("/v1/disputes/x")).status).toBe(401);
    const response = await app.request("/v1/disputes", {
      method: "POST", headers: { authorization: `Bearer ${BUYER}`, "content-type": "application/json" },
      body: JSON.stringify(openInput()),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as any).status).toBe("supplier_review");
  });

  it("returns the mapped PayProof identity for an authenticated request", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = {
      verify: async () => ({ id: BUYER, email: "buyer@example.com", name: "Buyer" }),
    };
    const app = createApp(new DisputeService(new MemoryDisputeStore(), control.ctx), verifier);
    const response = await app.request("/v1/me", {
      headers: { authorization: "Bearer valid" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: BUYER,
      email: "buyer@example.com",
      name: "Buyer",
    });
  });

  it("exposes wallet challenge authentication only when identity auth is configured", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const disabled = createApp(service, verifier);
    expect((await disabled.request("/auth/wallet/challenge", { method: "POST" })).status).toBe(404);

    const identity = new IdentityService(new MemoryIdentityStore(), {
      sessionSecret: "test-only-session-secret-that-is-at-least-thirty-two-bytes",
      zkLoginSaltSecret: "test-only-zklogin-salt-secret-at-least-thirty-two-bytes",
    });
    const enabled = createApp(service, verifier, undefined, undefined, undefined, undefined, false, identity);
    const response = await enabled.request("/auth/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ address: `0x${"1".repeat(64)}` }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("Sign in to PayProof") });
  });

  it("does not expose internal errors", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async () => { throw new Error("secret internal auth detail"); } };
    const app = createApp(new DisputeService(new MemoryDisputeStore(), control.ctx), verifier);
    const response = await app.request("/v1/disputes/x", { headers: { authorization: "Bearer bad" } });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret internal auth detail");
  });

  it("does not let an unrelated authenticated user trigger or inspect deadline enforcement", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const app = createApp(service, verifier);
    await service.open(openInput(), { id: BUYER });
    const outsider = "44444444-4444-4444-8444-444444444444";
    const response = await app.request(`/v1/disputes/${openInput().id}/enforce-deadline`, { method: "POST", headers: { authorization: `Bearer ${outsider}` } });
    expect(response.status).toBe(403);
  });

  it("exposes demo controls only when explicitly enabled", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    const disabled = createApp(service, verifier);
    expect((await disabled.request("/v1/demo/orders", { headers: { authorization: `Bearer ${BUYER}` } })).status).toBe(404);
    const enabled = createApp(service, verifier, undefined, new DemoOrderService(control.ctx));
    const response = await enabled.request("/v1/demo/orders", { headers: { authorization: `Bearer ${BUYER}` } });
    expect(response.status).toBe(200);
    expect((await response.json() as any).disclosure).toContain("explicitly label");
  });

  it("requires a trusted Sui verifier before marking an agreement settled", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    await service.open(openInput(), { id: BUYER });
    const agreed = await service.respond(openInput().id!, { id: SUPPLIER }, { agrees: true });
    expect(agreed.status).toBe("settlement_pending");
    const disabled = createApp(service, verifier);
    const proof = { transactionDigest: "tx", packageId: "0xpackage", escrowObjectId: "0xescrow", receiptObjectId: "0xreceipt" };
    expect((await disabled.request(`/v1/disputes/${agreed.id}/settlement-execution`, {
      method: "POST", headers: { authorization: `Bearer ${BUYER}`, "content-type": "application/json" }, body: JSON.stringify(proof),
    })).status).toBe(503);
    const suiVerifier = { verify: async () => ({ ...proof, checkpoint: "42" }) };
    const enabled = createApp(service, verifier, undefined, undefined, suiVerifier);
    const response = await enabled.request(`/v1/disputes/${agreed.id}/settlement-execution`, {
      method: "POST", headers: { authorization: `Bearer ${BUYER}`, "content-type": "application/json" }, body: JSON.stringify(proof),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "settled", settlement: { executionStatus: "verified_on_chain" } });
  });

  it("does not spend AI calls while a human proposal is still open", async () => {
    const control = controlledContext();
    const verifier: TokenVerifier = { verify: async (token) => ({ id: token }) };
    const service = new DisputeService(new MemoryDisputeStore(), control.ctx);
    await service.open(openInput(), { id: BUYER });
    await service.respond(openInput().id!, { id: SUPPLIER }, { agrees: false, statement: "Supplier counter-evidence" });
    await service.propose(openInput().id!, { id: BUYER }, { buyerUnits: "10000", supplierUnits: "20000", summary: "Human offer" });
    let mediationCalls = 0;
    const mediator = { mediate: async () => { mediationCalls += 1; throw new Error("must not run"); } } as any;
    const app = createApp(service, verifier, mediator);
    const response = await app.request(`/v1/disputes/${openInput().id}/mediate`, { method: "POST", headers: { authorization: `Bearer ${BUYER}` } });
    expect(response.status).toBe(409);
    expect(mediationCalls).toBe(0);
  });
});

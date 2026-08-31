import { describe, expect, it } from "vitest";
import { createApp, type TokenVerifier } from "../src/api/app.js";
import { DisputeService } from "../src/service/dispute-service.js";
import { MemoryDisputeStore } from "../src/store/store.js";
import { BUYER, controlledContext, openInput } from "./fixtures.js";

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
});

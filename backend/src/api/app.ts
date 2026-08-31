import { Hono } from "hono";
import { z } from "zod";
import type { MediationOrchestrator } from "../ai/mediation.js";
import { DomainError, type Actor } from "../domain/types.js";
import type { DisputeService } from "../service/dispute-service.js";

export interface TokenVerifier { verify(token: string): Promise<Actor>; }

const amount = z.string().regex(/^(0|[1-9]\d*)$/);
const proposalSchema = z.object({ buyerUnits: amount, supplierUnits: amount, summary: z.string().min(1).max(2000), reasoning: z.string().max(10_000).optional() });
const fileSchema = z.object({ storagePath: z.string().min(1), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/), mimeType: z.string().min(1), sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024) });
const openSchema = z.object({
  id: z.string().uuid().optional(), orderId: z.string().min(1).max(128), buyerId: z.string().uuid(), supplierId: z.string().uuid(), arbitratorId: z.string().uuid(),
  assetType: z.string().min(1).max(256), totalEscrowUnits: amount, disputedUnits: amount, requestedBuyerUnits: amount,
  claim: z.string().min(1).max(20_000),
  tradeTerms: z.object({ orderReference: z.string().min(1), description: z.string().min(1), inspectionTerms: z.string().optional(), acceptanceTerms: z.string().optional(), remedyTerms: z.string().optional(), governingLaw: z.string().min(1) }),
  negotiationDeadline: z.string().datetime(), maxHumanRounds: z.number().int().min(1).max(5).optional(),
  evidenceStatement: z.string().min(1).max(20_000), evidenceFiles: z.array(fileSchema).max(20).optional(),
});

export function createApp(service: DisputeService, verifier: TokenVerifier, mediator?: MediationOrchestrator) {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  app.onError((error, c) => {
    if (error instanceof DomainError) return c.json({ error: error.code, message: error.message }, error.status as any);
    if (error instanceof z.ZodError) return c.json({ error: "INVALID_REQUEST", issues: error.issues }, 400);
    console.error("Unhandled PayProof backend error", { name: error instanceof Error ? error.name : "UnknownError" });
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  });
  app.get("/health", (c) => c.json({ ok: true, service: "payproof-disputes" }));
  app.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw new DomainError("UNAUTHORIZED", "Bearer token required", 401);
    c.set("actor", await verifier.verify(header.slice(7)));
    await next();
  });
  app.post("/v1/disputes", async (c) => c.json(await service.open(openSchema.parse(await c.req.json()), c.get("actor")), 201));
  app.get("/v1/disputes/:id", async (c) => {
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId, dispute.arbitratorId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Actor cannot access dispute", 403);
    return c.json(dispute);
  });
  app.post("/v1/disputes/:id/supplier-response", async (c) => {
    const body = z.object({ agrees: z.boolean(), statement: z.string().max(20_000).optional(), files: z.array(fileSchema).max(20).optional() }).parse(await c.req.json());
    return c.json(await service.respond(c.req.param("id"), c.get("actor"), body));
  });
  app.post("/v1/disputes/:id/proposals", async (c) => c.json(await service.propose(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()))));
  app.post("/v1/disputes/:id/proposals/:proposalId/accept", async (c) => c.json(await service.accept(c.req.param("id"), c.get("actor"), c.req.param("proposalId"))));
  app.post("/v1/disputes/:id/proposals/:proposalId/reject", async (c) => c.json(await service.reject(c.req.param("id"), c.get("actor"), c.req.param("proposalId"))));
  app.post("/v1/disputes/:id/proposals/:proposalId/counter", async (c) => c.json(await service.counter(c.req.param("id"), c.get("actor"), c.req.param("proposalId"), proposalSchema.parse(await c.req.json()))));
  app.post("/v1/disputes/:id/mediate", async (c) => {
    if (!mediator) throw new DomainError("AI_UNAVAILABLE", "AI mediation is not configured", 503);
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Only a party may request mediation", 403);
    const result = await mediator.mediate(dispute);
    if (result.outcome === "abstain") return c.json(result);
    return c.json({ ...result, dispute: await service.recordAi(dispute.id, result.proposal) });
  });
  app.post("/v1/disputes/:id/enforce-deadline", async (c) => {
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId, dispute.arbitratorId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Actor cannot access dispute", 403);
    return c.json(await service.enforceDeadline(dispute.id));
  });
  app.post("/v1/disputes/:id/early-position", async (c) => c.json(await service.earlyPosition(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()))));
  app.post("/v1/disputes/:id/arbitrator-decision", async (c) => c.json(await service.decide(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()))));
  app.get("/v1/disputes/:id/arbitration-package", async (c) => c.json(await service.arbitrationPackage(c.req.param("id"), c.get("actor"))));
  return app;
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { MediationOrchestrator } from "../ai/mediation.js";
import { type DemoCommand, type DemoOrderService } from "../demo/demo-service.js";
import { DomainError, type Actor } from "../domain/types.js";
import type { DisputeService } from "../service/dispute-service.js";
import type { TradeService } from "../service/trade-service.js";
import type { SuiSettlementVerifier } from "../integrations/sui-settlement.js";
import { issueDemoGoogleSession } from "./demo-auth.js";

export interface TokenVerifier { verify(token: string): Promise<Actor>; }

const amount = z.string().regex(/^(0|[1-9]\d*)$/);
const proposalSchema = z.object({ buyerUnits: amount, supplierUnits: amount, summary: z.string().min(1).max(2000), reasoning: z.string().max(10_000).optional() });
const fileSchema = z.object({ storagePath: z.string().min(1), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/), mimeType: z.string().min(1), sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024) });
const suiAddress = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);
const suiObjectId = suiAddress;
const transactionDigest = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{20,128}$/);
const onchainEscrowSchema = z.object({
  packageId: suiObjectId,
  escrowObjectId: suiObjectId,
  fundingTransactionDigest: transactionDigest,
  disputeTransactionDigest: transactionDigest,
  buyerAddress: suiAddress,
  supplierAddress: suiAddress,
  arbitratorAddress: suiAddress,
});
const uuid = z.string().uuid();
const lineItemSchema = z.object({
  id: z.string().min(1).max(128), description: z.string().min(1).max(1000), sku: z.string().max(128).optional(),
  quantity: amount, unit: z.string().min(1).max(64), unitPriceUnits: amount,
});
const tradeOrderSchema = z.object({
  reference: z.string().min(1).max(128), supplierEmail: z.string().email(), supplierName: z.string().max(256).optional(), supplierWalletAddress: suiAddress.optional(), arbitratorWalletAddress: suiAddress.optional(),
  arbitratorId: uuid, assetType: z.string().min(1).max(256), amountUnits: amount, description: z.string().min(1).max(20_000),
  deliveryDate: z.string().min(1).max(128), deliveryLocation: z.string().min(1).max(500), lineItems: z.array(lineItemSchema).min(1).max(100),
});
const fundingSchema = z.object({
  packageId: z.string().min(1).max(128), escrowObjectId: z.string().min(1).max(128), transactionDigest: z.string().min(1).max(128),
  buyerAddress: suiAddress, supplierAddress: suiAddress, arbitratorAddress: suiAddress,
  verificationStatus: z.enum(["verified_on_chain", "external_reference"]).optional(),
});
const undisputedReleaseSchema = z.object({ transactionDigest });
const openTradeDisputeSchema = z.object({
  disputeTransactionDigest: transactionDigest, disputedUnits: amount, requestedBuyerUnits: amount,
  claim: z.string().min(1).max(20_000), evidenceStatement: z.string().min(1).max(20_000), evidenceFiles: z.array(fileSchema).max(20).optional(),
  negotiationDeadline: z.string().datetime(), maxHumanRounds: z.number().int().min(1).max(5).optional(),
});
const openSchema = z.object({
  id: z.string().uuid().optional(), orderId: z.string().min(1).max(128), buyerId: z.string().uuid(), supplierId: z.string().uuid(), arbitratorId: z.string().uuid(),
  assetType: z.string().min(1).max(256), totalEscrowUnits: amount, disputedUnits: amount, requestedBuyerUnits: amount,
  claim: z.string().min(1).max(20_000),
  tradeTerms: z.object({ orderReference: z.string().min(1), description: z.string().min(1), inspectionTerms: z.string().optional(), acceptanceTerms: z.string().optional(), remedyTerms: z.string().optional(), governingLaw: z.string().min(1) }),
  negotiationDeadline: z.string().datetime(), maxHumanRounds: z.number().int().min(1).max(5).optional(),
  evidenceStatement: z.string().min(1).max(20_000), evidenceFiles: z.array(fileSchema).max(20).optional(),
  onchainEscrow: onchainEscrowSchema.optional(),
});

export function createApp(
  service: DisputeService,
  verifier: TokenVerifier,
  mediator?: MediationOrchestrator,
  demo?: DemoOrderService,
  settlementVerifier?: SuiSettlementVerifier,
  trades?: TradeService,
  demoAuthEnabled = false,
) {
  const app = new Hono<{ Variables: { actor: Actor } }>();
  app.use("*", cors({
    origin: process.env.FRONTEND_ORIGIN ?? "*",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }));
  app.onError((error, c) => {
    if (error instanceof DomainError) return c.json({ error: error.code, message: error.message }, error.status as any);
    if (error instanceof z.ZodError) return c.json({ error: "INVALID_REQUEST", issues: error.issues }, 400);
    console.error("Unhandled PayProof backend error", { name: error instanceof Error ? error.name : "UnknownError" });
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  });
  app.get("/health", (c) => c.json({ ok: true, service: "payproof-disputes" }));
  app.post("/auth/demo/google", async (c) => {
    if (!demoAuthEnabled) throw new DomainError("DEMO_AUTH_DISABLED", "Demo Google authentication is disabled", 404);
    const body = z.object({ email: z.string().email(), name: z.string().min(1).max(256) }).parse(await c.req.json());
    return c.json(issueDemoGoogleSession(body.email, body.name));
  });
  app.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw new DomainError("UNAUTHORIZED", "Bearer token required", 401);
    c.set("actor", await verifier.verify(header.slice(7)));
    await next();
  });
  if (trades) {
    app.get("/v1/orders", async (c) => c.json(await trades.listOrders(c.get("actor"))));
    app.post("/v1/orders", async (c) => c.json(await trades.createOrder(tradeOrderSchema.parse(await c.req.json()), c.get("actor")), 201));
    app.get("/v1/orders/:id", async (c) => c.json(await trades.getOrder(c.req.param("id"), c.get("actor"))));
    app.post("/v1/orders/:id/invite", async (c) => c.json(await trades.createInvite(c.req.param("id"), c.get("actor"))));
    app.post("/v1/invites/:token/accept", async (c) => {
      const body = z.object({ email: z.string().email().optional(), name: z.string().max(256).optional(), supplierWalletAddress: suiAddress.optional() }).parse(await c.req.json().catch(() => ({})));
      return c.json(await trades.acceptInvite(c.req.param("token"), c.get("actor"), body));
    });
    app.post("/v1/orders/:id/funding", async (c) => c.json(await trades.recordFunding(c.req.param("id"), c.get("actor"), fundingSchema.parse(await c.req.json()))));
    app.post("/v1/orders/:id/undisputed-release", async (c) => c.json(await trades.recordUndisputedRelease(c.req.param("id"), c.get("actor"), undisputedReleaseSchema.parse(await c.req.json()))));
    app.post("/v1/orders/:id/shipment", async (c) => c.json(await trades.markShipment(c.req.param("id"), c.get("actor"))));
    app.post("/v1/orders/:id/delivery", async (c) => c.json(await trades.markDelivered(c.req.param("id"), c.get("actor"))));
    app.post("/v1/orders/:id/dispute", async (c) => c.json(await trades.openDispute(c.req.param("id"), c.get("actor"), openTradeDisputeSchema.parse(await c.req.json()))));
  }
  app.post("/v1/disputes", async (c) => c.json(await service.open(openSchema.parse(await c.req.json()), c.get("actor")), 201));
  app.get("/v1/disputes/:id", async (c) => {
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId, dispute.arbitratorId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Actor cannot access dispute", 403);
    return c.json(dispute);
  });
  app.post("/v1/disputes/:id/supplier-response", async (c) => {
    const body = z.object({ agrees: z.boolean(), statement: z.string().max(20_000).optional(), files: z.array(fileSchema).max(20).optional() }).parse(await c.req.json());
    const result = await service.respond(c.req.param("id"), c.get("actor"), body);
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/proposals", async (c) => {
    const result = await service.propose(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/proposals/:proposalId/accept", async (c) => {
    const result = await service.accept(c.req.param("id"), c.get("actor"), c.req.param("proposalId"));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/proposals/:proposalId/reject", async (c) => {
    const result = await service.reject(c.req.param("id"), c.get("actor"), c.req.param("proposalId"));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/proposals/:proposalId/counter", async (c) => {
    const result = await service.counter(c.req.param("id"), c.get("actor"), c.req.param("proposalId"), proposalSchema.parse(await c.req.json()));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/mediate", async (c) => {
    if (!mediator) throw new DomainError("AI_UNAVAILABLE", "AI mediation is not configured", 503);
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Only a party may request mediation", 403);
    if (dispute.proposals.some((proposal) => proposal.status === "open")) {
      throw new DomainError("OPEN_PROPOSAL_EXISTS", "Resolve the open proposal before starting AI mediation");
    }
    const result = await mediator.mediate(dispute);
    if (result.outcome === "abstain") {
      const saved = await service.recordAiAbstention(dispute.id, result.run);
      if (trades) await trades.syncDispute(saved.id);
      return c.json({ ...result, dispute: saved });
    }
    const saved = await service.recordAi(dispute.id, result.proposal, result.run);
    if (trades) await trades.syncDispute(saved.id);
    return c.json({ ...result, dispute: saved });
  });
  app.post("/v1/disputes/:id/enforce-deadline", async (c) => {
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId, dispute.arbitratorId].includes(actor.id)) throw new DomainError("FORBIDDEN", "Actor cannot access dispute", 403);
    const result = await service.enforceDeadline(dispute.id);
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/early-position", async (c) => {
    const result = await service.earlyPosition(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.post("/v1/disputes/:id/arbitrator-decision", async (c) => {
    const result = await service.decide(c.req.param("id"), c.get("actor"), proposalSchema.parse(await c.req.json()));
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.get("/v1/disputes/:id/arbitration-package", async (c) => c.json(await service.arbitrationPackage(c.req.param("id"), c.get("actor"))));
  app.post("/v1/disputes/:id/settlement-execution", async (c) => {
    if (!settlementVerifier) throw new DomainError("SUI_ESCROW_UNAVAILABLE", "The escrow settlement verifier is not configured", 503);
    const dispute = await service.get(c.req.param("id"));
    const actor = c.get("actor");
    if (![dispute.buyerId, dispute.supplierId, dispute.arbitratorId].includes(actor.id)) {
      throw new DomainError("FORBIDDEN", "Actor cannot submit settlement execution proof", 403);
    }
    const proof = z.object({
      transactionDigest: z.string().min(1).max(256), packageId: z.string().min(1).max(256),
      escrowObjectId: z.string().min(1).max(256), receiptObjectId: z.string().min(1).max(256),
    }).parse(await c.req.json());
    const verified = await settlementVerifier.verify(dispute, proof);
    const result = await service.confirmSettlement(dispute.id, verified);
    if (trades) await trades.syncDispute(result.id);
    return c.json(result);
  });
  app.get("/v1/demo/orders", (c) => {
    if (!demo) throw new DomainError("DEMO_DISABLED", "Demo controls are disabled", 404);
    return c.json({ disclosure: "Demo controls explicitly label simulated, seeded, live-AI, and external-Sui steps.", orders: demo.list() });
  });
  app.post("/v1/demo/orders/reset", (c) => {
    if (!demo) throw new DomainError("DEMO_DISABLED", "Demo controls are disabled", 404);
    return c.json({ orders: demo.reset() });
  });
  app.post("/v1/demo/orders/:id/advance", async (c) => {
    if (!demo) throw new DomainError("DEMO_DISABLED", "Demo controls are disabled", 404);
    const body = z.object({
      command: z.enum([
        "confirm_order", "record_escrow_funding", "skip_fulfilment_wait", "seed_buyer_claim",
        "seed_supplier_counter", "attach_live_mediation", "buyer_accepts", "supplier_accepts", "record_sui_settlement",
      ]),
      reference: z.object({
        transactionDigest: z.string().min(1).max(256).optional(), objectId: z.string().min(1).max(256).optional(),
        receiptObjectId: z.string().min(1).max(256).optional(), mediationRunId: z.string().min(1).max(256).optional(), proposalId: z.string().min(1).max(256).optional(),
      }).optional(),
    }).parse(await c.req.json());
    return c.json(demo.advance(c.req.param("id"), { command: body.command as DemoCommand, reference: body.reference }));
  });
  return app;
}

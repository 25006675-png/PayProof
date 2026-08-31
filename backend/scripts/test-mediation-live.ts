import { randomUUID } from "node:crypto";
import { MediationOrchestrator } from "../src/ai/mediation.js";
import { acceptProposal, openDispute, recordAiProposal, supplierRespond } from "../src/domain/dispute-machine.js";
import type { DomainContext } from "../src/domain/types.js";
import { config } from "../src/config.js";
import { GeminiEmbedder, GeminiJsonModel } from "../src/integrations/gemini.js";
import { QdrantLegalIndex } from "../src/integrations/qdrant.js";

const now = new Date("2026-08-31T08:00:00.000Z");
const ctx: DomainContext = { now: () => new Date(now), id: () => randomUUID() };
const buyer = { id: "11111111-1111-4111-8111-111111111111" };
const supplier = { id: "22222222-2222-4222-8222-222222222222" };
let dispute = openDispute({
  id: randomUUID(), orderId: "LIVE-MEDIATION-SMOKE", buyerId: buyer.id, supplierId: supplier.id,
  arbitratorId: "33333333-3333-4333-8333-333333333333", assetType: "USDC",
  totalEscrowUnits: "100000", disputedUnits: "30000", requestedBuyerUnits: "20000",
  claim: "The industrial pump delivered has visible corrosion and measured output 20% below the agreed specification. The buyer requests a partial refund.",
  tradeTerms: {
    orderReference: "LIVE-MEDIATION-SMOKE", description: "New grade-A industrial pump with rated output of 100 units per hour.",
    inspectionTerms: "Buyer must inspect within seven days of delivery.",
    acceptanceTerms: "Use during inspection does not waive latent defects.", remedyTerms: "Parties should first attempt repair or a proportionate refund.", governingLaw: "Malaysia",
  },
  negotiationDeadline: "2026-09-03T08:00:00.000Z", maxHumanRounds: 3,
  evidenceStatement: "Buyer inspected on day two. Dated photographs record corrosion and a calibrated test records output of 80 units per hour.",
}, buyer, ctx);
dispute = supplierRespond(dispute, supplier, {
  agrees: false,
  statement: "Supplier pre-shipment testing recorded 100 units per hour. Supplier disputes causation and offers an independent inspection and repair.",
}, ctx);

const retriever = new QdrantLegalIndex(
  config.qdrantUrl(), config.qdrantApiKey(), config.legalCollection,
  new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel),
);
const result = await new MediationOrchestrator(
  new GeminiJsonModel(config.geminiApiKey(), config.geminiModel), retriever, ctx,
).mediate(dispute);

if (result.outcome === "abstain") {
  if (!result.reason || !result.unresolvedIssues.length) throw new Error("Live mediator abstained without a structured reason");
  console.log(`Live mediation safely abstained after ${result.debateRounds} round(s) and ${result.modelCalls} calls; citations=${result.citations.length}.`);
} else {
  if (!result.proposal.citations.length) throw new Error("Live AI proposal contained no verified legal citations");
  dispute = recordAiProposal(dispute, result.proposal, ctx);
  dispute = acceptProposal(dispute, buyer, result.proposal.id, ctx);
  dispute = acceptProposal(dispute, supplier, result.proposal.id, ctx);
  if (dispute.status !== "settled" || dispute.settlement?.source !== "mutual_proposal") throw new Error("Live AI proposal did not complete the acceptance flow");
  console.log(`Live mediation proposal passed: rounds=${result.debateRounds}, calls=${result.modelCalls}, citations=${result.proposal.citations.length}.`);
  console.log(`Validated allocation: buyer=${result.proposal.buyerUnits}, supplier=${result.proposal.supplierUnits}, total=${dispute.disputedUnits}.`);
  console.log("Independent buyer and supplier acceptance completed the immutable proposal flow.");
}

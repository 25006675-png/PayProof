import { describe, expect, it } from "vitest";
import { MediationOrchestrator } from "../src/ai/mediation.js";
import { openDispute, recordAiProposal, recordMediationAbstention, supplierRespond } from "../src/domain/dispute-machine.js";
import type { JsonModel } from "../src/integrations/gemini.js";
import type { LegalPassage, LegalRetriever } from "../src/rag/legal-rag.js";
import { buyer, controlledContext, openInput, supplier } from "./fixtures.js";

const passage: LegalPassage = {
  id: "law-16", sourceId: "act-382", title: "Sale of Goods Act 1957", locator: "section 16",
  sourceUrl: "https://example.test/act",
  text: "Goods sold by description in the course of business shall be of merchantable quality subject to examination defects.",
};
const retriever: LegalRetriever = { retrieve: async () => [passage] };

class QueueModel implements JsonModel {
  calls = 0;
  systems: string[] = [];
  schemas: Record<string, unknown>[] = [];
  constructor(private readonly queue: unknown[]) {}
  async generateJson<T>(system: string, _input: string, schema?: Record<string, unknown>): Promise<T> {
    this.calls += 1;
    this.systems.push(system);
    this.schemas.push(schema ?? {});
    return this.queue.shift() as T;
  }
}

function advocate(buyerRefund: string, supplierRelease = (30_000n - BigInt(buyerRefund)).toString()) {
  return {
    recommendedBuyerRefundUnits: buyerRefund,
    recommendedSupplierReleaseUnits: supplierRelease,
    evidenceBasis: [{ evidenceId: "00000000-0000-4000-8000-000000000001", quote: "Inspection report records corrosion and reduced output." }],
    legalBasis: [{ passageId: "law-16", quote: "merchantable quality subject to examination defects" }],
    inferences: ["The alleged defect may justify a proportionate remedy."], unresolvedQuestions: [],
  };
}

function proposal(buyerRefund: string, supplierRelease = (30_000n - BigInt(buyerRefund)).toString()) {
  return {
    outcome: "proposal", buyerRefundUnits: buyerRefund, supplierReleaseUnits: supplierRelease,
    evidenceBasis: [{ evidenceId: "00000000-0000-4000-8000-000000000001", quote: "Inspection report records corrosion and reduced output." }],
    legalBasis: [{ passageId: "law-16", quote: "merchantable quality subject to examination defects" }],
    inferences: ["The quoted defect allegation may justify a partial remedy."],
    evidenceSufficiency: "moderate", legalRelevance: "direct", unresolvedQuestions: ["What caused the corrosion?"],
  };
}

function disputeFixture() {
  const control = controlledContext();
  const opened = openDispute(openInput(), buyer, control.ctx);
  return { control, dispute: supplierRespond(opened, supplier, { agrees: false, statement: "Supplier evidence" }, control.ctx) };
}

describe("bounded AI mediation", () => {
  it("runs at most two rounds, persists structured finals, and creates an explicit conserved allocation", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"), proposal("12000", "18000"),
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result).toMatchObject({ debateRounds: 2, modelCalls: 5, run: { outcome: "proposal", debateRounds: 2 } });
    if (result.outcome === "proposal") {
      expect(result.proposal).toMatchObject({
        buyerUnits: "12000", supplierUnits: "18000",
        summary: "Refund 12000 USDC units to the buyer; release 18000 USDC units to the supplier.",
      });
      expect(result.run.buyerFinal).toMatchObject({ side: "buyer", recommendedBuyerRefundUnits: "18000" });
      expect(result.run.supplierFinal).toMatchObject({ side: "supplier", recommendedSupplierReleaseUnits: "22000" });
      expect(result.run.mediatorFinal).toMatchObject({ outcome: "proposal", buyerRefundUnits: "12000", supplierReleaseUnits: "18000" });
      expect(result.proposal.reasoning).toContain("Validated evidence quotes");
      expect(result.proposal.reasoning).toContain("AI inferences (not verified facts)");
      expect(result.proposal.citations[0]).toMatchObject({ passageId: "law-16" });
      expect(result.proposal.citations[0]?.excerpt).toContain("merchantable quality");
      const recorded = recordAiProposal(dispute, result.proposal, control.ctx, result.run);
      expect(recorded.mediationRuns).toHaveLength(1);
    }
  });

  it("early-stops after one round when explicit refund positions converge", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "proposal", debateRounds: 1, modelCalls: 3 });
  });

  it("makes the refund/release meanings explicit in both prompt and JSON schema", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(model.systems[0]).toContain("buyerRefundUnits goes back to the BUYER");
    expect(JSON.stringify(model.schemas[0])).toContain("recommendedSupplierReleaseUnits");
    expect(JSON.stringify(model.schemas[0])).toContain("copied verbatim");
    expect(JSON.stringify(model.schemas.at(-1))).toContain("buyerRefundUnits");
  });

  it("abstains without relevant verified law and makes no model call", async () => {
    const model = new QueueModel([]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, { retrieve: async () => [] }, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", debateRounds: 0, modelCalls: 0, run: { outcome: "abstain" } });
    expect(model.calls).toBe(0);
  });

  it("turns invented citations into a persisted validation abstention, never an open proposal", async () => {
    const model = new QueueModel([{ ...advocate("10000"), legalBasis: [{ passageId: "invented", quote: "invented legal quote" }] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("unknown legal passage");
    if (result.outcome === "abstain") {
      const recorded = recordMediationAbstention(dispute, result.run, control.ctx);
      expect(recorded.proposals).toHaveLength(0);
      expect(recorded.mediationRuns).toHaveLength(1);
    }
  });

  it("turns invented evidence references into a validation abstention", async () => {
    const model = new QueueModel([{ ...advocate("10000"), evidenceBasis: [{ evidenceId: "invented-evidence", quote: "invented evidence quote" }] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("unknown evidence");
  });

  it("repairs a model legal quote that accidentally copied a trade term", async () => {
    const invalid = advocate("15000");
    invalid.legalBasis[0]!.quote = "Parties should first attempt repair or a proportionate refund.";
    const model = new QueueModel([invalid, advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result).toMatchObject({ debateRounds: 1, modelCalls: 4 });
  });

  it("rejects a fabricated quote even when it points at a real evidence ID", async () => {
    const fabricated = advocate("10000");
    fabricated.evidenceBasis[0]!.quote = "Buyer refused every independent inspection request.";
    const model = new QueueModel([fabricated, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("quote is not present");
  });

  it("abstains when the two destinations do not conserve the disputed amount", async () => {
    const model = new QueueModel([advocate("10000"), advocate("10000"), proposal("10000", "10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("does not conserve");
  });

  it("abstains when a proposal exceeds the buyer's requested remedy even if it conserves", async () => {
    const model = new QueueModel([advocate("10000"), advocate("10000"), proposal("24000", "6000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("exceeds the buyer's requested remedy");
  });

  it("permits the neutral mediator to abstain with its cited structured final", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"),
      { outcome: "abstain", reason: "Independent inspection evidence is missing", unresolvedQuestions: ["What would a neutral inspection establish?"], legalBasis: [{ passageId: "law-16", quote: "merchantable quality subject to examination defects" }] },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", reason: "Independent inspection evidence is missing", run: { outcome: "abstain" } });
  });
});

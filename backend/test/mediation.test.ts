import { describe, expect, it } from "vitest";
import { MediationOrchestrator } from "../src/ai/mediation.js";
import { openDispute, supplierRespond } from "../src/domain/dispute-machine.js";
import type { JsonModel } from "../src/integrations/gemini.js";
import type { LegalPassage, LegalRetriever } from "../src/rag/legal-rag.js";
import { buyer, controlledContext, openInput, supplier } from "./fixtures.js";

const passage: LegalPassage = { id: "law-16", sourceId: "act-382", title: "Sale of Goods Act 1957", locator: "section 16", sourceUrl: "https://example.test/act", text: "Goods sold by description in the course of business shall be of merchantable quality subject to examination defects." };
const retriever: LegalRetriever = { retrieve: async () => [passage] };

class QueueModel implements JsonModel {
  calls = 0;
  constructor(private readonly queue: unknown[]) {}
  async generateJson<T>(): Promise<T> { this.calls += 1; return this.queue.shift() as T; }
}

function advocate(amount: string) {
  return { recommendedBuyerUnits: amount, arguments: ["Supported argument"], evidenceIds: [], legalPassageIds: ["law-16"], unresolvedIssues: [] };
}

function disputeFixture() {
  const control = controlledContext();
  const opened = openDispute(openInput(), buyer, control.ctx);
  return { control, dispute: supplierRespond(opened, supplier, { agrees: false, statement: "Supplier evidence" }, control.ctx) };
}

describe("bounded AI mediation", () => {
  it("runs two rounds only when advocates materially disagree", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"),
      { outcome: "proposal", buyerUnits: "12000", supplierUnits: "18000", summary: "Proportionate refund", reasoning: "Evidence and section 16 support a partial remedy.", legalPassageIds: ["law-16"], evidenceSufficiency: "moderate", legalRelevance: "direct", unresolvedIssues: ["Cause of corrosion"] },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result.debateRounds).toBe(2);
    expect(result.modelCalls).toBe(5);
    if (result.outcome === "proposal") expect(result.proposal.citations[0]?.passageId).toBe("law-16");
  });

  it("early-stops after one round when positions converge", async () => {
    const model = new QueueModel([
      advocate("15000"), advocate("15000"),
      { outcome: "proposal", buyerUnits: "15000", supplierUnits: "15000", summary: "Equal split", reasoning: "Positions converge.", legalPassageIds: ["law-16"], evidenceSufficiency: "moderate", legalRelevance: "direct", unresolvedIssues: [] },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result.debateRounds).toBe(1);
    expect(result.modelCalls).toBe(3);
  });

  it("abstains without relevant verified law and makes no model call", async () => {
    const model = new QueueModel([]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, { retrieve: async () => [] }, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", debateRounds: 0, modelCalls: 0 });
    expect(model.calls).toBe(0);
  });

  it("rejects invented citations", async () => {
    const model = new QueueModel([{ ...advocate("10000"), legalPassageIds: ["invented"] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    await expect(new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute)).rejects.toThrow("unknown legal passage");
  });

  it("rejects invented evidence references", async () => {
    const model = new QueueModel([{ ...advocate("10000"), evidenceIds: ["invented-evidence"] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    await expect(new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute)).rejects.toThrow("unknown evidence");
  });

  it("rejects buyer allocations outside the disputed amount", async () => {
    const model = new QueueModel([
      advocate("10000"), advocate("10000"),
      { outcome: "proposal", buyerUnits: "40000", summary: "Out of range", reasoning: "Bad", legalPassageIds: ["law-16"], evidenceSufficiency: "weak", legalRelevance: "limited", unresolvedIssues: [] },
    ]);
    const { control, dispute } = disputeFixture();
    await expect(new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute)).rejects.toThrow("outside the disputed amount");
  });

  it("derives the supplier remainder deterministically", async () => {
    const model = new QueueModel([
      advocate("10000"), advocate("10000"),
      { outcome: "proposal", buyerUnits: "10000", summary: "Calculated", reasoning: "Backend computes remainder", legalPassageIds: ["law-16"], evidenceSufficiency: "moderate", legalRelevance: "direct", unresolvedIssues: [] },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    if (result.outcome === "proposal") expect(result.proposal).toMatchObject({ buyerUnits: "10000", supplierUnits: "20000" });
  });

  it("permits the neutral mediator to abstain", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"),
      { outcome: "abstain", reason: "Independent inspection evidence is missing", unresolvedIssues: ["No neutral inspection"], legalPassageIds: ["law-16"] },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, retriever, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", reason: "Independent inspection evidence is missing" });
  });
});

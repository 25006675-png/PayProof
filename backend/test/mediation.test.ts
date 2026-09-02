import { describe, expect, it } from "vitest";
import { MediationOrchestrator } from "../src/ai/mediation.js";
import { openDispute, recordAiProposal, recordMediationAbstention, supplierRespond } from "../src/domain/dispute-machine.js";
import type { DisputeAggregate } from "../src/domain/types.js";
import type { JsonModel } from "../src/integrations/gemini.js";
import type { PolicyCorpus } from "../src/policy/policy-corpus.js";
import { buyer, controlledContext, openInput, supplier } from "./fixtures.js";

const policy: PolicyCorpus = {
  version: "1.0",
  clauses: [
    {
      id: "DP-7.3", section: "DP-7 · How a case is assessed",
      text: "Where goods arrive damaged and the damage is evidenced within the inspection window in DP-2.1, the damaged quantity is treated as not delivered, and is refundable at the unit price for that line.",
    },
    {
      id: "DP-7.5", section: "DP-7 · How a case is assessed",
      text: "Where the evidence supports part of a claim only, the remedy is proportionate to the part that is evidenced, not to the part that is alleged.",
    },
    {
      id: "DP-5.4", section: "DP-5 · Evidence",
      text: "A written statement is an allegation by the party who made it, not an established fact.",
    },
  ],
};

const BUYER_EVIDENCE = "BUYER-STATEMENT-1";
const BUYER_DOCUMENT = "BUYER-DOC-1";
const EVIDENCE_QUOTE = "Inspection report records corrosion and reduced output.";
const POLICY_QUOTE = "proportionate to the part that is evidenced";
const CONTRACT_QUOTE = "Inspect within seven days";

class QueueModel implements JsonModel {
  calls = 0;
  systems: string[] = [];
  inputs: string[] = [];
  schemas: Record<string, unknown>[] = [];
  constructor(private readonly queue: unknown[]) {}
  async generateJson<T>(system: string, input: string, schema?: Record<string, unknown>): Promise<T> {
    this.calls += 1;
    this.systems.push(system);
    this.inputs.push(input);
    this.schemas.push(schema ?? {});
    return this.queue.shift() as T;
  }
}

function advocate(buyerRefund: string, supplierRelease = (30_000n - BigInt(buyerRefund)).toString()) {
  return {
    recommendedBuyerRefundUnits: buyerRefund,
    recommendedSupplierReleaseUnits: supplierRelease,
    issues: ["Was the delivered quantity conforming?"],
    evidenceBasis: [{ evidenceId: BUYER_EVIDENCE, quote: EVIDENCE_QUOTE }],
    contractBasis: [{ clauseId: "AGREEMENT-2", quote: CONTRACT_QUOTE }],
    policyBasis: [{ clauseId: "DP-7.5", quote: POLICY_QUOTE }],
    application: "The quoted inspection finding supports a proportionate remedy under DP-7.5.",
    concessions: ["No independent inspection report was produced."],
    inferences: ["The alleged defect may justify a proportionate remedy."],
    unresolvedQuestions: [],
  };
}

function proposal(buyerRefund: string, supplierRelease = (30_000n - BigInt(buyerRefund)).toString()) {
  return {
    outcome: "proposal", buyerRefundUnits: buyerRefund, supplierReleaseUnits: supplierRelease,
    commonGround: ["The order was delivered and inspected."],
    findings: [{
      issue: "Was part of the delivery non-conforming?",
      finding: "The buyer's inspection records a defect; the supplier does not quote a contrary inspection.",
      supportingEvidence: [{ evidenceId: BUYER_EVIDENCE, quote: EVIDENCE_QUOTE }],
    }],
    contractBasis: [{ clauseId: "AGREEMENT-2", quote: CONTRACT_QUOTE }],
    policyBasis: [{ clauseId: "DP-7.5", quote: POLICY_QUOTE }],
    reasoning: "Applying DP-7.5 to the evidenced portion produces a partial refund.",
    inferences: ["The quoted defect allegation may justify a partial remedy."],
    evidenceSufficiency: "moderate", legalRelevance: "direct",
    unresolvedQuestions: ["What caused the corrosion?"],
  };
}

function disputeFixture() {
  const control = controlledContext();
  const opened = openDispute(openInput(), buyer, control.ctx);
  return { control, dispute: supplierRespond(opened, supplier, { agrees: false, statement: "Supplier evidence" }, control.ctx) };
}

function withTranscript(dispute: DisputeAggregate, transcript: string): DisputeAggregate {
  const copy = structuredClone(dispute);
  copy.evidence[0]!.files = [{
    storagePath: "evidence/receiving-note.pdf", sha256: "a".repeat(64), mimeType: "application/pdf",
    sizeBytes: 240_000, transcript,
  }];
  return copy;
}

describe("bounded AI mediation", () => {
  it("runs at most two rounds, persists structured finals, and creates an explicit conserved allocation", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"), proposal("12000", "18000"),
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result).toMatchObject({ debateRounds: 2, modelCalls: 5, run: { outcome: "proposal", debateRounds: 2 } });
    if (result.outcome === "proposal") {
      expect(result.proposal).toMatchObject({
        buyerUnits: "12000", supplierUnits: "18000",
        summary: "Refund 12000 USDC units to the buyer; release 18000 USDC units to the supplier.",
      });
      expect(result.run.buyerFinal).toMatchObject({ side: "buyer", recommendedBuyerRefundUnits: "18000" });
      expect(result.run.supplierFinal).toMatchObject({ side: "supplier", recommendedSupplierReleaseUnits: "22000" });
      expect(result.run.mediatorFinal).toMatchObject({ outcome: "proposal", buyerRefundUnits: "12000" });
      expect(result.proposal.reasoning).toContain("Common ground");
      expect(result.proposal.reasoning).toContain("Findings");
      expect(result.proposal.reasoning).toContain("Policy clauses applied");
      expect(result.proposal.reasoning).toContain("AI inferences (not verified facts)");
      expect(result.proposal.citations).toEqual(expect.arrayContaining([
        expect.objectContaining({ passageId: "DP-7.5", sourceId: "payproof-dispute-policy", sourceUrl: "/legal/dispute-policy" }),
        expect.objectContaining({ passageId: "AGREEMENT-2", sourceId: "order-agreement" }),
      ]));
      const recorded = recordAiProposal(dispute, result.proposal, control.ctx, result.run);
      expect(recorded.mediationRuns).toHaveLength(1);
    }
  });

  it("early-stops after one round when explicit refund positions converge", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "proposal", debateRounds: 1, modelCalls: 3 });
  });

  it("gives the agreement and the policy to the models as the only authority", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(model.systems[0]).toContain("buyerRefundUnits goes back to the BUYER");
    expect(model.systems[0]).toContain("You do not interpret legislation");
    expect(model.inputs[0]).toContain("policyClauses");
    expect(model.inputs[0]).toContain("agreementClauses");
    expect(model.inputs[0]).toContain("DP-7.5");
    const advocateSchema = JSON.stringify(model.schemas[0]);
    expect(advocateSchema).toContain("policyBasis");
    expect(advocateSchema).toContain("contractBasis");
    expect(advocateSchema).toContain("copied verbatim");
    expect(advocateSchema).not.toContain("legalBasis");
    expect(JSON.stringify(model.schemas.at(-1))).toContain("findings");
  });

  it("proposes without any statute retrieval configured", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result.run.legalContext).toEqual([]);
  });

  it("quotes a document transcript as evidence and refuses a file that was never read", async () => {
    const transcript = "Receiving note 8841: 13 of 100 cartons recorded as crushed on arrival.";
    const quoting = {
      ...advocate("15000"),
      evidenceBasis: [{ evidenceId: BUYER_DOCUMENT, quote: "13 of 100 cartons recorded as crushed on arrival" }],
    };
    const model = new QueueModel([quoting, advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(withTranscript(dispute, transcript));
    expect(result.outcome).toBe("proposal");
    expect(result.run.buyerFinal?.evidenceBasis[0]).toMatchObject({ evidenceId: BUYER_DOCUMENT });
    expect(model.inputs[0]).toContain("document_transcript");

    const unread = new QueueModel([quoting, advocate("15000")]);
    const blocked = await new MediationOrchestrator(unread, policy, control.ctx).mediate(dispute);
    expect(blocked).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(blocked.run.validationIssues.join(" ")).toContain("unknown evidence");
    expect(unread.inputs[0]).toContain("filesRegisteredButNotRead");
  });

  it("turns invented clause citations into a persisted validation abstention, never an open proposal", async () => {
    const model = new QueueModel([{ ...advocate("10000"), policyBasis: [{ clauseId: "DP-9.9", quote: "invented policy quote" }] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("unknown clause");
    if (result.outcome === "abstain") {
      const recorded = recordMediationAbstention(dispute, result.run, control.ctx);
      expect(recorded.proposals).toHaveLength(0);
      expect(recorded.mediationRuns).toHaveLength(1);
    }
  });

  it("turns invented evidence references into a validation abstention", async () => {
    const model = new QueueModel([{ ...advocate("10000"), evidenceBasis: [{ evidenceId: "invented-evidence", quote: "invented evidence quote" }] }, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("unknown evidence");
  });

  it("repairs a clause quote that was paraphrased instead of copied", async () => {
    const invalid = advocate("15000");
    invalid.policyBasis[0]!.quote = "remedies should be proportionate to whatever the evidence shows";
    const model = new QueueModel([invalid, advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result.outcome).toBe("proposal");
    expect(result).toMatchObject({ debateRounds: 1, modelCalls: 4 });
  });

  it("rejects a fabricated quote even when it points at a real evidence ID", async () => {
    const fabricated = advocate("10000");
    fabricated.evidenceBasis[0]!.quote = "Buyer refused every independent inspection request.";
    const model = new QueueModel([fabricated, advocate("10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("quote is not present");
  });

  it("abstains when the two destinations do not conserve the disputed amount", async () => {
    const model = new QueueModel([advocate("10000"), advocate("10000"), proposal("10000", "10000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("does not conserve");
  });

  it("abstains when a proposal exceeds the buyer's requested remedy even if it conserves", async () => {
    const model = new QueueModel([advocate("10000"), advocate("10000"), proposal("24000", "6000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "abstain", run: { outcome: "validation_failed" } });
    expect(result.run.validationIssues.join(" ")).toContain("exceeds the buyer's requested remedy");
  });

  it("permits the neutral mediator to abstain when no rule answers the dispute", async () => {
    const model = new QueueModel([
      advocate("20000"), advocate("5000"), advocate("18000"), advocate("8000"),
      {
        outcome: "abstain", reason: "No agreement term or policy clause covers late partial delivery of this kind",
        commonGround: ["The delivery arrived after the agreed date."],
        findings: [{ issue: "Was the delay a breach?", finding: "No finding: neither side quotes a term making time essential.", supportingEvidence: [] }],
        contractBasis: [], policyBasis: [{ clauseId: "DP-5.4", quote: "an allegation by the party who made it" }],
        unresolvedQuestions: ["Did the parties agree that the delivery date was essential?"],
      },
    ]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({
      outcome: "abstain",
      reason: "No agreement term or policy clause covers late partial delivery of this kind",
      run: { outcome: "abstain" },
    });
    if (result.outcome === "abstain") {
      expect(result.citations[0]).toMatchObject({ passageId: "DP-5.4" });
    }
  });
  it("accepts a quote that only differs by terminal punctuation or typographic characters", async () => {
    const retyped = advocate("15000");
    // A model closing a sentence, and re-typing the hyphen as an en dash.
    retyped.evidenceBasis = [{ evidenceId: BUYER_EVIDENCE, quote: "Inspection report records corrosion and reduced output." }];
    retyped.policyBasis = [{ clauseId: "DP-7.5", quote: "proportionate to the part that is evidenced," }];
    retyped.contractBasis = [{ clauseId: "AGREEMENT-2", quote: "“Inspect within seven days”" }];
    const model = new QueueModel([retyped, advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(dispute);
    expect(result).toMatchObject({ outcome: "proposal", modelCalls: 3 });
  });

  it("records a traceable index from readable citation ids back to submissions", async () => {
    const model = new QueueModel([advocate("15000"), advocate("15000"), proposal("15000")]);
    const { control, dispute } = disputeFixture();
    const withDoc = withTranscript(dispute, "Receiving note 8841: 13 of 100 cartons recorded as crushed on arrival.");
    const result = await new MediationOrchestrator(model, policy, control.ctx).mediate(withDoc);
    expect(result.run.evidenceIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "BUYER-STATEMENT-1", kind: "statement", submissionId: withDoc.evidence[0]!.id }),
      expect.objectContaining({ id: "BUYER-DOC-1", kind: "document_transcript", sha256: "a".repeat(64) }),
      expect.objectContaining({ id: "SUPPLIER-STATEMENT-1", side: "supplier" }),
    ]));
  });
});

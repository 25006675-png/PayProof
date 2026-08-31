import { describe, expect, it } from "vitest";
import {
  acceptProposal, arbitratorInstruct, buildArbitrationPackage, counterProposal, enforceDeadline,
  openDispute, recordAiProposal, rejectProposal, submitEarlyPosition, submitHumanProposal, supplierRespond,
} from "../src/domain/dispute-machine.js";
import type { Proposal } from "../src/domain/types.js";
import { ARBITRATOR, BUYER, SUPPLIER, arbitrator, buyer, controlledContext, openInput, supplier } from "./fixtures.js";

function negotiating() {
  const control = controlledContext();
  const opened = openDispute(openInput(), buyer, control.ctx);
  const dispute = supplierRespond(opened, supplier, { agrees: false, statement: "Supplier tests show output within tolerance.", files: [] }, control.ctx);
  return { control, dispute };
}

describe("dispute state machine", () => {
  it("opens with buyer evidence and releases only the undisputed amount", () => {
    const { ctx } = controlledContext();
    const dispute = openDispute(openInput(), buyer, ctx);
    expect(dispute.status).toBe("supplier_review");
    expect(dispute.undisputedReleasedUnits).toBe("70000");
    expect(dispute.audit.map((event) => event.type)).toContain("escrow.undisputed_release_instructed");
    expect(dispute.audit.at(-1)?.details.executionStatus).toBe("pending_on_chain_escrow");
  });

  it.each([
    [{ disputedUnits: "100001" }, "INVALID_DISPUTE_AMOUNT"],
    [{ requestedBuyerUnits: "30001" }, "INVALID_DISPUTE_AMOUNT"],
    [{ supplierId: BUYER }, "INVALID_PARTIES"],
    [{ negotiationDeadline: "2020-01-01T00:00:00.000Z" }, "INVALID_DEADLINE"],
    [{ evidenceStatement: "" }, "EVIDENCE_REQUIRED"],
  ] as const)("rejects invalid opening %#", (overrides, code) => {
    const { ctx } = controlledContext();
    expect(() => openDispute(openInput(overrides), buyer, ctx)).toThrow(expect.objectContaining({ code }));
  });

  it("settles to the buyer claim when supplier agrees", () => {
    const control = controlledContext();
    const opened = openDispute(openInput(), buyer, control.ctx);
    const result = supplierRespond(opened, supplier, { agrees: true }, control.ctx);
    expect(result.status).toBe("settled");
    expect(result.settlement).toMatchObject({ buyerUnits: "20000", supplierUnits: "10000", source: "supplier_agreement" });
  });

  it("requires supplier counter-evidence before negotiation", () => {
    const control = controlledContext();
    const opened = openDispute(openInput(), buyer, control.ctx);
    expect(() => supplierRespond(opened, supplier, { agrees: false }, control.ctx)).toThrow(expect.objectContaining({ code: "EVIDENCE_REQUIRED" }));
    const result = supplierRespond(opened, supplier, { agrees: false, statement: "Factory test supports conformity." }, control.ctx);
    expect(result.status).toBe("negotiation_open");
    expect(result.evidence.map((item) => item.side)).toEqual(["buyer", "supplier"]);
  });

  it("settles only after both parties accept an immutable human proposal", () => {
    const { control, dispute } = negotiating();
    const proposed = submitHumanProposal(dispute, buyer, { buyerUnits: "18000", supplierUnits: "12000", summary: "Compromise" }, control.ctx);
    expect(proposed.proposals[0]?.acceptances).toEqual(["buyer"]);
    const settled = acceptProposal(proposed, supplier, proposed.proposals[0]!.id, control.ctx);
    expect(settled.status).toBe("settled");
    expect(settled.settlement?.source).toBe("mutual_proposal");
    expect(dispute.proposals).toHaveLength(0);
  });

  it("prevents unbalanced proposals and proposal spam", () => {
    const { control, dispute } = negotiating();
    expect(() => submitHumanProposal(dispute, buyer, { buyerUnits: "1", supplierUnits: "1", summary: "Bad" }, control.ctx)).toThrow(expect.objectContaining({ code: "UNBALANCED_ALLOCATION" }));
    const first = submitHumanProposal(dispute, buyer, { buyerUnits: "15000", supplierUnits: "15000", summary: "Half" }, control.ctx);
    expect(() => submitHumanProposal(first, supplier, { buyerUnits: "10000", supplierUnits: "20000", summary: "Spam" }, control.ctx)).toThrow(expect.objectContaining({ code: "OPEN_PROPOSAL_EXISTS" }));
  });

  it("caps human rounds and escalates the unresolved amount", () => {
    const { control, dispute } = negotiating();
    let state = submitHumanProposal(dispute, buyer, { buyerUnits: "20000", supplierUnits: "10000", summary: "R1" }, control.ctx);
    state = counterProposal(state, supplier, state.proposals.at(-1)!.id, { buyerUnits: "5000", supplierUnits: "25000", summary: "R2" }, control.ctx);
    state = counterProposal(state, buyer, state.proposals.at(-1)!.id, { buyerUnits: "15000", supplierUnits: "15000", summary: "R3" }, control.ctx);
    state = rejectProposal(state, supplier, state.proposals.at(-1)!.id, control.ctx);
    expect(state.status).toBe("arbitration_pending");
    expect(state.escalationReason).toBe("human_round_limit_reached");
  });

  it("closes negotiation exactly at the deadline", () => {
    const { control, dispute } = negotiating();
    control.set("2026-09-03T00:00:00.000Z");
    const result = enforceDeadline(dispute, control.ctx);
    expect(result.status).toBe("arbitration_pending");
    expect(() => submitHumanProposal(dispute, buyer, { buyerUnits: "10000", supplierUnits: "20000", summary: "Late" }, control.ctx)).toThrow(expect.objectContaining({ code: "NEGOTIATION_DEADLINE_PASSED" }));
  });

  it("records AI output as immutable and requires independent acceptance", () => {
    const { control, dispute } = negotiating();
    const ai: Proposal = { id: "ai-1", source: "ai", proposedBy: "ai", round: 99, buyerUnits: "12000", supplierUnits: "18000", summary: "AI", reasoning: "Cited", citations: [], unresolvedIssues: [], acceptances: ["buyer"], status: "accepted", createdAt: control.ctx.now().toISOString() };
    let state = recordAiProposal(dispute, ai, control.ctx);
    expect(state.proposals[0]).toMatchObject({ source: "ai", status: "open", acceptances: [], round: 1 });
    state = acceptProposal(state, buyer, "ai-1", control.ctx);
    expect(state.status).toBe("negotiation_open");
    state = acceptProposal(state, supplier, "ai-1", control.ctx);
    expect(state.status).toBe("settled");
  });

  it("allows matching independent positions to settle during pending arbitration", () => {
    const { control, dispute } = negotiating();
    control.set("2026-09-04T00:00:00.000Z");
    let state = enforceDeadline(dispute, control.ctx);
    state = submitEarlyPosition(state, buyer, { buyerUnits: "14000", supplierUnits: "16000", summary: "Buyer position" }, control.ctx);
    expect(state.status).toBe("arbitration_pending");
    state = submitEarlyPosition(state, supplier, { buyerUnits: "14000", supplierUnits: "16000", summary: "Supplier position" }, control.ctx);
    expect(state.status).toBe("settled");
    expect(state.settlement?.source).toBe("early_mutual");
  });

  it("restricts final instruction to the designated arbitrator and builds a complete package", () => {
    const { control, dispute } = negotiating();
    control.set("2026-09-04T00:00:00.000Z");
    const escalated = enforceDeadline(dispute, control.ctx);
    const pkg = buildArbitrationPackage(escalated, control.ctx);
    expect(pkg.evidence).toHaveLength(2);
    expect(pkg.dispute.undisputedReleasedUnits).toBe("70000");
    expect(() => arbitratorInstruct(escalated, buyer, { buyerUnits: "10000", supplierUnits: "20000", summary: "Decision" }, control.ctx)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    const settled = arbitratorInstruct(escalated, arbitrator, { buyerUnits: "10000", supplierUnits: "20000", summary: "Final decision" }, control.ctx);
    expect(settled.settlement?.source).toBe("arbitrator");
    expect(settled.proposals.at(-1)?.proposedBy).toBe(ARBITRATOR);
  });

  it("rejects actors outside the buyer/supplier/arbitrator roles", () => {
    const { control, dispute } = negotiating();
    expect(() => submitHumanProposal(dispute, { id: "44444444-4444-4444-8444-444444444444" }, { buyerUnits: "1", supplierUnits: "29999", summary: "Intrusion" }, control.ctx)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(dispute.buyerId).toBe(BUYER);
    expect(dispute.supplierId).toBe(SUPPLIER);
  });
});

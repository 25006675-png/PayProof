import { createHash } from "node:crypto";
import { units, validateAllocation } from "./money.js";
import {
  DomainError,
  type Actor,
  type ArbitrationCasePackage,
  type DisputeAggregate,
  type DomainContext,
  type EvidenceFile,
  type MediationRun,
  type OnchainEscrowBinding,
  type PartySide,
  type Proposal,
  type SettlementExecution,
  type SettlementAllocation,
  type TradeTerms,
} from "./types.js";

export interface OpenDisputeInput {
  id?: string;
  orderId: string;
  buyerId: string;
  supplierId: string;
  arbitratorId: string;
  assetType: string;
  totalEscrowUnits: string;
  disputedUnits: string;
  requestedBuyerUnits: string;
  claim: string;
  tradeTerms: TradeTerms;
  negotiationDeadline: string;
  maxHumanRounds?: number;
  evidenceStatement: string;
  evidenceFiles?: EvidenceFile[];
  onchainEscrow?: OnchainEscrowBinding;
}

export interface ProposalInput extends SettlementAllocation {
  summary: string;
  reasoning?: string;
}

const MAX_STATEMENT = 20_000;
const MAX_FILES = 20;

function clone(dispute: DisputeAggregate): DisputeAggregate {
  return structuredClone(dispute);
}

function sideFor(dispute: DisputeAggregate, actor: Actor): PartySide {
  if (actor.id === dispute.buyerId) return "buyer";
  if (actor.id === dispute.supplierId) return "supplier";
  throw new DomainError("FORBIDDEN", "Actor is not a party to this dispute", 403);
}

function requireSide(dispute: DisputeAggregate, actor: Actor, expected: PartySide): void {
  if (sideFor(dispute, actor) !== expected) {
    throw new DomainError("FORBIDDEN", `Only the ${expected} may perform this action`, 403);
  }
}

function audit(
  dispute: DisputeAggregate,
  ctx: DomainContext,
  actorId: string,
  type: string,
  details: Record<string, unknown> = {},
): void {
  const at = ctx.now().toISOString();
  dispute.audit.push({ id: ctx.id(), actorId, type, at, details });
  dispute.updatedAt = at;
  dispute.version += 1;
}

function ensureBeforeDeadline(dispute: DisputeAggregate, ctx: DomainContext): void {
  if (ctx.now().getTime() >= new Date(dispute.negotiationDeadline).getTime()) {
    throw new DomainError("NEGOTIATION_DEADLINE_PASSED", "The negotiation deadline has passed");
  }
}

function ensureEvidence(statement: string, files: EvidenceFile[]): void {
  if (!statement.trim()) throw new DomainError("EVIDENCE_REQUIRED", "An evidence statement is required", 400);
  if (statement.length > MAX_STATEMENT) throw new DomainError("EVIDENCE_TOO_LONG", "Evidence statement is too long", 400);
  if (files.length > MAX_FILES) throw new DomainError("TOO_MANY_FILES", "Too many evidence files", 400);
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/i.test(file.sha256) || file.sizeBytes < 0 || !file.storagePath) {
      throw new DomainError("INVALID_EVIDENCE_FILE", "Evidence file metadata is invalid", 400);
    }
  }
}

function evidenceBundleHash(dispute: DisputeAggregate): string {
  const canonical = JSON.stringify({
    disputeId: dispute.id,
    orderId: dispute.orderId,
    claim: dispute.claim,
    tradeTerms: dispute.tradeTerms,
    evidence: dispute.evidence.map((item) => ({
      id: item.id, side: item.side, statement: item.statement,
      files: item.files.map((file) => ({ storagePath: file.storagePath, sha256: file.sha256, mimeType: file.mimeType, sizeBytes: file.sizeBytes })),
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function agreeSettlement(
  dispute: DisputeAggregate,
  allocation: SettlementAllocation,
  source: NonNullable<DisputeAggregate["settlement"]>["source"],
  ctx: DomainContext,
  actorId: string,
  proposalId?: string,
): DisputeAggregate {
  validateAllocation(allocation, dispute.disputedUnits);
  dispute.status = "settlement_pending";
  const agreementId = ctx.id();
  const signedIdentifier = proposalId ?? agreementId;
  dispute.settlement = {
    ...allocation,
    source,
    proposalId,
    proposalHash: createHash("sha256").update(signedIdentifier).digest("hex"),
    agreementId,
    evidenceBundleHash: evidenceBundleHash(dispute),
    agreedAt: ctx.now().toISOString(),
    executionStatus: "pending_on_chain",
  };
  const proposal = proposalId ? dispute.proposals.find((item) => item.id === proposalId) : undefined;
  if (proposal) proposal.status = "accepted";
  audit(dispute, ctx, actorId, "settlement.agreed", {
    source, proposalId, agreementId: dispute.settlement.agreementId,
    evidenceBundleHash: dispute.settlement.evidenceBundleHash, ...allocation,
    executionStatus: "pending_on_chain",
  });
  return dispute;
}

export function openDispute(input: OpenDisputeInput, actor: Actor, ctx: DomainContext): DisputeAggregate {
  if (actor.id !== input.buyerId) throw new DomainError("FORBIDDEN", "Only the buyer may open this dispute", 403);
  if (input.buyerId === input.supplierId || input.arbitratorId === input.buyerId || input.arbitratorId === input.supplierId) {
    throw new DomainError("INVALID_PARTIES", "Buyer, supplier, and arbitrator must be distinct", 400);
  }
  const total = units(input.totalEscrowUnits, "totalEscrowUnits");
  const disputed = units(input.disputedUnits, "disputedUnits");
  const requested = units(input.requestedBuyerUnits, "requestedBuyerUnits");
  if (total <= 0n || disputed <= 0n || disputed > total || requested > disputed) {
    throw new DomainError("INVALID_DISPUTE_AMOUNT", "Dispute amounts are outside the escrow balance", 400);
  }
  const deadline = new Date(input.negotiationDeadline);
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= ctx.now().getTime()) {
    throw new DomainError("INVALID_DEADLINE", "Negotiation deadline must be in the future", 400);
  }
  const maxHumanRounds = input.maxHumanRounds ?? 3;
  if (!Number.isInteger(maxHumanRounds) || maxHumanRounds < 1 || maxHumanRounds > 5) {
    throw new DomainError("INVALID_ROUND_LIMIT", "Human negotiation rounds must be between 1 and 5", 400);
  }
  const files = input.evidenceFiles ?? [];
  ensureEvidence(input.evidenceStatement, files);
  const now = ctx.now().toISOString();
  const dispute: DisputeAggregate = {
    id: input.id ?? ctx.id(), orderId: input.orderId, buyerId: input.buyerId,
    supplierId: input.supplierId, arbitratorId: input.arbitratorId, assetType: input.assetType,
    totalEscrowUnits: total.toString(), disputedUnits: disputed.toString(),
    undisputedReleasedUnits: (total - disputed).toString(), requestedBuyerUnits: requested.toString(),
    claim: input.claim.trim(), tradeTerms: input.tradeTerms,
    onchainEscrow: input.onchainEscrow ? structuredClone(input.onchainEscrow) : undefined,
    status: "supplier_review",
    negotiationDeadline: deadline.toISOString(), maxHumanRounds, currentRound: 0,
    evidence: [{ id: ctx.id(), side: "buyer", statement: input.evidenceStatement.trim(), files, submittedAt: now }],
    proposals: [], mediationRuns: [], earlyPositions: {}, audit: [], version: 0, createdAt: now, updatedAt: now,
  };
  audit(dispute, ctx, actor.id, "dispute.opened", { disputedUnits: dispute.disputedUnits });
  if (total > disputed) {
    audit(dispute, ctx, actor.id, "escrow.undisputed_release_instructed", {
      supplierUnits: dispute.undisputedReleasedUnits,
      executionStatus: "pending_on_chain_escrow",
    });
  }
  return dispute;
}

export function supplierRespond(
  original: DisputeAggregate,
  actor: Actor,
  response: { agrees: boolean; statement?: string; files?: EvidenceFile[] },
  ctx: DomainContext,
): DisputeAggregate {
  const dispute = clone(original);
  requireSide(dispute, actor, "supplier");
  if (dispute.status !== "supplier_review") throw new DomainError("INVALID_STATE", "Supplier review is closed");
  ensureBeforeDeadline(dispute, ctx);
  if (response.agrees) {
    return agreeSettlement(dispute, {
      buyerUnits: dispute.requestedBuyerUnits,
      supplierUnits: (units(dispute.disputedUnits) - units(dispute.requestedBuyerUnits)).toString(),
    }, "supplier_agreement", ctx, actor.id);
  }
  const files = response.files ?? [];
  ensureEvidence(response.statement ?? "", files);
  dispute.evidence.push({ id: ctx.id(), side: "supplier", statement: response.statement!.trim(), files, submittedAt: ctx.now().toISOString() });
  dispute.status = "negotiation_open";
  dispute.currentRound = 1;
  audit(dispute, ctx, actor.id, "supplier.counter_evidence_submitted");
  audit(dispute, ctx, actor.id, "negotiation.opened", { round: 1 });
  return dispute;
}

function openProposal(dispute: DisputeAggregate): Proposal | undefined {
  return dispute.proposals.find((proposal) => proposal.status === "open");
}

export function submitHumanProposal(original: DisputeAggregate, actor: Actor, input: ProposalInput, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  const side = sideFor(dispute, actor);
  if (dispute.status !== "negotiation_open") throw new DomainError("INVALID_STATE", "Negotiation is not open");
  ensureBeforeDeadline(dispute, ctx);
  if (openProposal(dispute)) throw new DomainError("OPEN_PROPOSAL_EXISTS", "Accept, reject, or counter the open proposal first");
  validateAllocation(input, dispute.disputedUnits);
  const proposal: Proposal = {
    id: ctx.id(), source: "human", proposedBy: actor.id, proposerSide: side, round: dispute.currentRound,
    buyerUnits: input.buyerUnits, supplierUnits: input.supplierUnits, summary: input.summary.trim(),
    reasoning: input.reasoning?.trim() ?? "", citations: [], unresolvedIssues: [], acceptances: [side],
    status: "open", createdAt: ctx.now().toISOString(),
  };
  dispute.proposals.push(proposal);
  audit(dispute, ctx, actor.id, "proposal.created", { proposalId: proposal.id, round: proposal.round, source: proposal.source });
  return dispute;
}

export function recordAiProposal(original: DisputeAggregate, proposal: Proposal, ctx: DomainContext, run?: MediationRun): DisputeAggregate {
  const dispute = clone(original);
  if (dispute.status !== "negotiation_open") throw new DomainError("INVALID_STATE", "Negotiation is not open");
  ensureBeforeDeadline(dispute, ctx);
  if (openProposal(dispute)) throw new DomainError("OPEN_PROPOSAL_EXISTS", "An open proposal already exists");
  if (run && run.disputeVersion !== original.version) throw new DomainError("STALE_MEDIATION_RUN", "The dispute changed while AI mediation was running");
  validateAllocation(proposal, dispute.disputedUnits);
  proposal.source = "ai";
  proposal.proposerSide = undefined;
  proposal.acceptances = [];
  proposal.status = "open";
  proposal.round = dispute.currentRound;
  dispute.proposals.push(structuredClone(proposal));
  if (run) dispute.mediationRuns.push(structuredClone(run));
  audit(dispute, ctx, "ai-mediator", "proposal.created", { proposalId: proposal.id, round: proposal.round, source: "ai" });
  return dispute;
}

export function recordMediationAbstention(original: DisputeAggregate, run: MediationRun, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  if (dispute.status !== "negotiation_open") throw new DomainError("INVALID_STATE", "Negotiation is not open");
  ensureBeforeDeadline(dispute, ctx);
  if (run.disputeVersion !== original.version) throw new DomainError("STALE_MEDIATION_RUN", "The dispute changed while AI mediation was running");
  dispute.mediationRuns.push(structuredClone(run));
  audit(dispute, ctx, "ai-mediator", "mediation.abstained", { runId: run.id, outcome: run.outcome, validationIssues: run.validationIssues });
  return dispute;
}

export function acceptProposal(original: DisputeAggregate, actor: Actor, proposalId: string, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  const side = sideFor(dispute, actor);
  if (dispute.status !== "negotiation_open") throw new DomainError("INVALID_STATE", "Negotiation is not open");
  ensureBeforeDeadline(dispute, ctx);
  const proposal = dispute.proposals.find((item) => item.id === proposalId && item.status === "open");
  if (!proposal) throw new DomainError("PROPOSAL_NOT_OPEN", "Proposal is not open");
  if (!proposal.acceptances.includes(side)) proposal.acceptances.push(side);
  audit(dispute, ctx, actor.id, "proposal.accepted_by_party", { proposalId, side });
  if (proposal.acceptances.includes("buyer") && proposal.acceptances.includes("supplier")) {
    return agreeSettlement(dispute, proposal, "mutual_proposal", ctx, actor.id, proposal.id);
  }
  return dispute;
}

export function rejectProposal(original: DisputeAggregate, actor: Actor, proposalId: string, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  const side = sideFor(dispute, actor);
  if (dispute.status !== "negotiation_open") throw new DomainError("INVALID_STATE", "Negotiation is not open");
  ensureBeforeDeadline(dispute, ctx);
  const proposal = dispute.proposals.find((item) => item.id === proposalId && item.status === "open");
  if (!proposal) throw new DomainError("PROPOSAL_NOT_OPEN", "Proposal is not open");
  if (proposal.proposerSide === side) throw new DomainError("CANNOT_REJECT_OWN_PROPOSAL", "The proposer cannot reject their own proposal");
  proposal.status = "rejected";
  audit(dispute, ctx, actor.id, "proposal.rejected", { proposalId, side });
  if (dispute.currentRound >= dispute.maxHumanRounds) return escalate(dispute, "human_round_limit_reached", ctx, actor.id);
  dispute.currentRound += 1;
  audit(dispute, ctx, actor.id, "negotiation.round_advanced", { round: dispute.currentRound });
  return dispute;
}

export function counterProposal(original: DisputeAggregate, actor: Actor, proposalId: string, input: ProposalInput, ctx: DomainContext): DisputeAggregate {
  let dispute = rejectProposal(original, actor, proposalId, ctx);
  if (dispute.status === "arbitration_pending") return dispute;
  dispute = submitHumanProposal(dispute, actor, input, ctx);
  return dispute;
}

function escalate(dispute: DisputeAggregate, reason: string, ctx: DomainContext, actorId: string): DisputeAggregate {
  const existing = openProposal(dispute);
  if (existing) existing.status = "superseded";
  dispute.status = "arbitration_pending";
  dispute.escalationReason = reason;
  audit(dispute, ctx, actorId, "arbitration.escalated", { reason });
  return dispute;
}

export function enforceDeadline(original: DisputeAggregate, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  if ((dispute.status === "supplier_review" || dispute.status === "negotiation_open") &&
      ctx.now().getTime() >= new Date(dispute.negotiationDeadline).getTime()) {
    return escalate(dispute, "negotiation_deadline_reached", ctx, "system");
  }
  return dispute;
}

export function submitEarlyPosition(original: DisputeAggregate, actor: Actor, input: ProposalInput, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  const side = sideFor(dispute, actor);
  if (dispute.status !== "arbitration_pending") throw new DomainError("INVALID_STATE", "Arbitration is not pending");
  validateAllocation(input, dispute.disputedUnits);
  const proposal: Proposal = {
    id: ctx.id(), source: "early_position", proposedBy: actor.id, proposerSide: side, round: dispute.currentRound,
    buyerUnits: input.buyerUnits, supplierUnits: input.supplierUnits, summary: input.summary.trim(),
    reasoning: input.reasoning?.trim() ?? "", citations: [], unresolvedIssues: [], acceptances: [side], status: "open",
    createdAt: ctx.now().toISOString(),
  };
  dispute.earlyPositions[side] = proposal;
  audit(dispute, ctx, actor.id, "arbitration.early_position_submitted", { side });
  const other = dispute.earlyPositions[side === "buyer" ? "supplier" : "buyer"];
  if (other && other.buyerUnits === proposal.buyerUnits && other.supplierUnits === proposal.supplierUnits) {
    proposal.acceptances = ["buyer", "supplier"];
    dispute.proposals.push(proposal);
    return agreeSettlement(dispute, proposal, "early_mutual", ctx, actor.id, proposal.id);
  }
  return dispute;
}

export function arbitratorInstruct(original: DisputeAggregate, actor: Actor, input: ProposalInput, ctx: DomainContext): DisputeAggregate {
  const dispute = clone(original);
  if (dispute.status !== "arbitration_pending") throw new DomainError("INVALID_STATE", "Arbitration is not pending");
  if (actor.id !== dispute.arbitratorId) throw new DomainError("FORBIDDEN", "Only the designated arbitrator may decide", 403);
  validateAllocation(input, dispute.disputedUnits);
  const proposal: Proposal = {
    id: ctx.id(), source: "arbitrator", proposedBy: actor.id, round: dispute.currentRound,
    buyerUnits: input.buyerUnits, supplierUnits: input.supplierUnits, summary: input.summary.trim(),
    reasoning: input.reasoning?.trim() ?? "", citations: [], unresolvedIssues: [], acceptances: ["buyer", "supplier"],
    status: "accepted", createdAt: ctx.now().toISOString(),
  };
  dispute.proposals.push(proposal);
  return agreeSettlement(dispute, proposal, "arbitrator", ctx, actor.id, proposal.id);
}

export function confirmSettlementExecution(
  original: DisputeAggregate,
  execution: Omit<SettlementExecution, "verifiedAt">,
  ctx: DomainContext,
): DisputeAggregate {
  const dispute = clone(original);
  if (dispute.status !== "settlement_pending" || !dispute.settlement) {
    throw new DomainError("INVALID_STATE", "No settlement agreement is awaiting on-chain execution");
  }
  for (const [name, value] of Object.entries(execution)) {
    if (name !== "checkpoint" && (!value || !String(value).trim())) {
      throw new DomainError("INVALID_SETTLEMENT_EXECUTION", `${name} is required`, 400);
    }
  }
  dispute.status = "settled";
  dispute.settlement.executionStatus = "verified_on_chain";
  dispute.settlement.execution = { ...execution, verifiedAt: ctx.now().toISOString() };
  audit(dispute, ctx, "sui-verifier", "settlement.executed_on_chain", {
    agreementId: dispute.settlement.agreementId,
    transactionDigest: execution.transactionDigest,
    receiptObjectId: execution.receiptObjectId,
  });
  return dispute;
}

export function buildArbitrationPackage(dispute: DisputeAggregate, ctx: DomainContext): ArbitrationCasePackage {
  if (dispute.status !== "arbitration_pending") throw new DomainError("INVALID_STATE", "Dispute has not been escalated");
  return {
    schemaVersion: 1,
    generatedAt: ctx.now().toISOString(),
    dispute: {
      id: dispute.id, orderId: dispute.orderId, assetType: dispute.assetType,
      totalEscrowUnits: dispute.totalEscrowUnits, disputedUnits: dispute.disputedUnits,
      undisputedReleasedUnits: dispute.undisputedReleasedUnits, claim: dispute.claim,
      tradeTerms: dispute.tradeTerms,
      onchainEscrow: dispute.onchainEscrow,
      negotiationDeadline: dispute.negotiationDeadline,
      escalationReason: dispute.escalationReason,
    },
    evidence: structuredClone(dispute.evidence),
    aiAnalysis: dispute.proposals.filter((proposal) => proposal.source === "ai"),
    mediationRuns: structuredClone(dispute.mediationRuns),
    negotiationHistory: dispute.proposals.filter((proposal) => proposal.source !== "arbitrator"),
    audit: structuredClone(dispute.audit),
  };
}

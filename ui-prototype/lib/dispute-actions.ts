"use client";

import { apiRequest } from "@/lib/payproof-api";
import type { ClaimMediation, ClaimProposal, ClaimView, MediationReport } from "@/lib/demo-orders";
import { fromUnits, toUnits } from "@/lib/live-orders";

/** The backend dispute aggregate, limited to the fields the order page reads. */
export type DisputeRecord = {
  id: string;
  orderId: string;
  buyerId: string;
  supplierId: string;
  status: ClaimView["status"];
  totalEscrowUnits: string;
  disputedUnits: string;
  undisputedReleasedUnits: string;
  requestedBuyerUnits: string;
  claim: string;
  negotiationDeadline: string;
  maxHumanRounds: number;
  currentRound: number;
  evidence: Array<{ id: string; side: "buyer" | "supplier"; statement: string; files: unknown[]; submittedAt: string }>;
  proposals: Array<{
    id: string; source: ClaimProposal["source"]; proposerSide?: "buyer" | "supplier"; round: number; buyerUnits: string; supplierUnits: string;
    summary: string; reasoning: string; citations: Array<{ title: string; locator: string; excerpt: string }>; unresolvedIssues: string[];
    evidenceSufficiency?: "strong" | "moderate" | "weak"; acceptances: Array<"buyer" | "supplier">; status: ClaimProposal["status"]; createdAt: string;
  }>;
  mediationRuns: Array<{
    id: string; createdAt: string; outcome: ClaimMediation["outcome"]; modelCalls: number; debateRounds: number; validationIssues: string[];
    legalContext: Array<{ title: string; locator: string; excerpt: string }>;
    evidenceIndex: Array<{ id: string; side: "buyer" | "supplier"; kind: string }>;
    buyerFinal?: RawAdvocate; supplierFinal?: RawAdvocate;
    mediatorFinal?: {
      outcome: "proposal" | "abstain"; buyerRefundUnits?: string; supplierReleaseUnits?: string; reason?: string;
      commonGround: string[]; findings: Array<{ issue: string; finding: string; supportingEvidence: Array<{ evidenceId: string; quote: string }> }>;
      contractBasis: Array<{ clauseId: string; quote: string }>; policyBasis: Array<{ clauseId: string; quote: string }>;
      reasoning?: string; inferences?: string[]; evidenceSufficiency?: "strong" | "moderate" | "weak"; legalRelevance?: "direct" | "analogous" | "limited"; unresolvedQuestions: string[];
    };
  }>;
  settlement?: { buyerUnits: string; supplierUnits: string; executionStatus: "pending_on_chain" | "verified_on_chain"; proposalId?: string; agreementId: string; execution?: { transactionDigest: string } };
  escalationReason?: string;
  onchainEscrow?: { escrowObjectId: string };
};

type RawAdvocate = {
  side: "buyer" | "supplier"; recommendedBuyerRefundUnits: string; recommendedSupplierReleaseUnits: string; issues: string[];
  evidenceBasis: Array<{ evidenceId: string; quote: string }>; contractBasis: Array<{ clauseId: string; quote: string }>; policyBasis: Array<{ clauseId: string; quote: string }>;
  application: string; concessions: string[]; inferences: string[]; unresolvedQuestions: string[];
};

function advocate(raw?: RawAdvocate): MediationReport["buyer"] {
  if (!raw) return undefined;
  return { side: raw.side, buyerValue: fromUnits(raw.recommendedBuyerRefundUnits), supplierValue: fromUnits(raw.recommendedSupplierReleaseUnits), issues: raw.issues, evidenceBasis: raw.evidenceBasis, contractBasis: raw.contractBasis, policyBasis: raw.policyBasis, application: raw.application, concessions: raw.concessions, inferences: raw.inferences, unresolvedQuestions: raw.unresolvedQuestions };
}

function nearestAiProposal(proposals: ClaimProposal[], at: string): ClaimProposal | undefined {
  const target = new Date(at).getTime();
  return proposals.filter((proposal) => proposal.source === "ai").sort((a, b) => Math.abs(new Date(a.createdAt).getTime() - target) - Math.abs(new Date(b.createdAt).getTime() - target))[0];
}

export function disputeToClaim(dispute: DisputeRecord): ClaimView {
  const proposals: ClaimProposal[] = dispute.proposals.map((proposal) => ({
    id: proposal.id, source: proposal.source, side: proposal.proposerSide, round: proposal.round,
    buyerValue: fromUnits(proposal.buyerUnits), supplierValue: fromUnits(proposal.supplierUnits),
    summary: proposal.summary, reasoning: proposal.reasoning, status: proposal.status, acceptances: proposal.acceptances,
    citations: proposal.citations ?? [], unresolvedIssues: proposal.unresolvedIssues ?? [], evidenceSufficiency: proposal.evidenceSufficiency, createdAt: proposal.createdAt,
  }));
  const mediations: ClaimMediation[] = dispute.mediationRuns.map((run) => ({
    id: run.id, createdAt: run.createdAt, outcome: run.outcome, modelCalls: run.modelCalls,
    reason: run.mediatorFinal?.reason ?? run.validationIssues[0],
    unresolved: run.mediatorFinal?.unresolvedQuestions ?? run.validationIssues,
    proposalId: run.outcome === "proposal" ? nearestAiProposal(proposals, run.createdAt)?.id : undefined,
    report: {
      legalContext: run.legalContext ?? [], evidenceIndex: run.evidenceIndex ?? [], debateRounds: run.debateRounds ?? 0,
      buyer: advocate(run.buyerFinal), supplier: advocate(run.supplierFinal),
      mediator: run.mediatorFinal ? {
        outcome: run.mediatorFinal.outcome, reason: run.mediatorFinal.reason,
        buyerValue: run.mediatorFinal.buyerRefundUnits ? fromUnits(run.mediatorFinal.buyerRefundUnits) : undefined,
        supplierValue: run.mediatorFinal.supplierReleaseUnits ? fromUnits(run.mediatorFinal.supplierReleaseUnits) : undefined,
        commonGround: run.mediatorFinal.commonGround ?? [], findings: run.mediatorFinal.findings ?? [], contractBasis: run.mediatorFinal.contractBasis ?? [], policyBasis: run.mediatorFinal.policyBasis ?? [],
        reasoning: run.mediatorFinal.reasoning, inferences: run.mediatorFinal.inferences ?? [], evidenceSufficiency: run.mediatorFinal.evidenceSufficiency, legalRelevance: run.mediatorFinal.legalRelevance,
        unresolvedQuestions: run.mediatorFinal.unresolvedQuestions ?? [],
      } : undefined,
    },
  }));
  return {
    id: dispute.id, status: dispute.status,
    totalValue: fromUnits(dispute.totalEscrowUnits), disputedValue: fromUnits(dispute.disputedUnits), requestedValue: fromUnits(dispute.requestedBuyerUnits),
    undisputedReleased: BigInt(dispute.undisputedReleasedUnits || "0") > 0n,
    claim: dispute.claim, deadline: dispute.negotiationDeadline, round: dispute.currentRound, maxRounds: dispute.maxHumanRounds,
    evidence: dispute.evidence.map((entry) => ({ id: entry.id, side: entry.side, statement: entry.statement, files: entry.files.length, submittedAt: entry.submittedAt })),
    proposals, mediations,
    settlement: dispute.settlement ? { buyerValue: fromUnits(dispute.settlement.buyerUnits), supplierValue: fromUnits(dispute.settlement.supplierUnits), executionStatus: dispute.settlement.executionStatus, proposalId: dispute.settlement.proposalId, agreementId: dispute.settlement.agreementId, transactionDigest: dispute.settlement.execution?.transactionDigest } : undefined,
    escalationReason: dispute.escalationReason,
    onchain: dispute.onchainEscrow ? { escrowObjectId: dispute.onchainEscrow.escrowObjectId } : undefined,
  };
}

export async function loadClaim(disputeId: string): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}`));
}

export type EvidenceFileInput = { storagePath: string; sha256: string; mimeType: string; sizeBytes: number; transcript?: string };

export async function respondToClaim(disputeId: string, input: { agrees: boolean; statement: string; files?: EvidenceFileInput[] }): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}/supplier-response`, { method: "POST", body: JSON.stringify(input) }));
}

export async function acceptClaimProposal(disputeId: string, proposalId: string): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}/proposals/${encodeURIComponent(proposalId)}/accept`, { method: "POST" }));
}

export async function rejectClaimProposal(disputeId: string, proposalId: string): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}/proposals/${encodeURIComponent(proposalId)}/reject`, { method: "POST" }));
}

export type ProposalInput = { buyerValue: number; supplierValue: number; summary: string; reasoning: string };

function proposalBody(input: ProposalInput) {
  return JSON.stringify({ buyerUnits: toUnits(input.buyerValue), supplierUnits: toUnits(input.supplierValue), summary: input.summary, reasoning: input.reasoning });
}

/** Counter an open proposal, or table a fresh one when nothing is open. */
export async function proposeClaimSplit(disputeId: string, input: ProposalInput, counterTo?: string): Promise<ClaimView> {
  const path = counterTo
    ? `/v1/disputes/${encodeURIComponent(disputeId)}/proposals/${encodeURIComponent(counterTo)}/counter`
    : `/v1/disputes/${encodeURIComponent(disputeId)}/proposals`;
  return disputeToClaim(await apiRequest<DisputeRecord>(path, { method: "POST", body: proposalBody(input) }));
}

export type MediationOutcome = { outcome: "proposal" | "abstain"; reason?: string; unresolvedIssues?: string[]; claim: ClaimView };

export async function requestMediation(disputeId: string): Promise<MediationOutcome> {
  const result = await apiRequest<{ outcome: "proposal" | "abstain"; reason?: string; unresolvedIssues?: string[]; dispute: DisputeRecord }>(`/v1/disputes/${encodeURIComponent(disputeId)}/mediate`, { method: "POST" });
  return { outcome: result.outcome, reason: result.reason, unresolvedIssues: result.unresolvedIssues, claim: disputeToClaim(result.dispute) };
}

export async function enforceClaimDeadline(disputeId: string): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}/enforce-deadline`, { method: "POST" }));
}

export async function confirmClaimExecution(disputeId: string, proof: { transactionDigest: string; packageId: string; escrowObjectId: string; receiptObjectId?: string }): Promise<ClaimView> {
  return disputeToClaim(await apiRequest<DisputeRecord>(`/v1/disputes/${encodeURIComponent(disputeId)}/settlement-execution`, { method: "POST", body: JSON.stringify(proof) }));
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A placeholder that passes the backend's digest format check while clearly not being a real Sui digest. */
export function demoDigest(): string {
  let value = "Demo";
  for (let index = 0; index < 28; index += 1) value += BASE58[Math.floor(Math.random() * BASE58.length)];
  return value;
}

/** Demo control only: opens a claim without the Sui dispute transaction. */
export async function openDemoClaim(orderId: string, input: { disputedValue: number; requestedValue: number; claim: string; evidence: string; files?: EvidenceFileInput[]; inspection?: { lines: Array<{ lineId: string; accepted: number; missing: number; damaged: number }>; note?: string } }): Promise<{ claim: ClaimView; orderId: string }> {
  const result = await apiRequest<{ order: { id: string }; dispute: DisputeRecord }>(`/v1/orders/${encodeURIComponent(orderId)}/dispute`, {
    method: "POST",
    body: JSON.stringify({
      disputeTransactionDigest: demoDigest(), disputedUnits: toUnits(input.disputedValue), requestedBuyerUnits: toUnits(input.requestedValue),
      claim: input.claim, evidenceStatement: input.evidence, evidenceFiles: input.files,
      negotiationDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), maxHumanRounds: 3,
      inspection: input.inspection ? { lines: input.inspection.lines.map((line) => ({ lineId: line.lineId, accepted: String(line.accepted), missing: String(line.missing), damaged: String(line.damaged) })), note: input.inspection.note } : undefined,
    }),
  });
  return { claim: disputeToClaim(result.dispute), orderId: result.order.id };
}

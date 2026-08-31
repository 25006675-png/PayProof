export type PartySide = "buyer" | "supplier";
export type DisputeStatus =
  | "supplier_review"
  | "negotiation_open"
  | "arbitration_pending"
  | "settlement_pending"
  | "settled";

export type ProposalSource = "human" | "ai" | "arbitrator" | "early_position";
export type ProposalStatus = "open" | "rejected" | "accepted" | "superseded";

export interface EvidenceFile {
  storagePath: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
}

export interface EvidenceSubmission {
  id: string;
  side: PartySide;
  statement: string;
  files: EvidenceFile[];
  submittedAt: string;
}

export interface LegalCitation {
  passageId: string;
  sourceId: string;
  title: string;
  locator: string;
  sourceUrl: string;
  excerpt: string;
}

export interface AdvocatePosition {
  side: PartySide;
  recommendedBuyerRefundUnits: string;
  recommendedSupplierReleaseUnits: string;
  evidenceBasis: Array<{ evidenceId: string; quote: string }>;
  legalBasis: Array<{ passageId: string; quote: string }>;
  inferences: string[];
  unresolvedQuestions: string[];
}

export type MediatorDecision =
  | {
      outcome: "proposal";
      buyerRefundUnits: string;
      supplierReleaseUnits: string;
      evidenceBasis: Array<{ evidenceId: string; quote: string }>;
      legalBasis: Array<{ passageId: string; quote: string }>;
      inferences: string[];
      evidenceSufficiency: "strong" | "moderate" | "weak";
      legalRelevance: "direct" | "analogous" | "limited";
      unresolvedQuestions: string[];
    }
  | {
      outcome: "abstain";
      reason: string;
      legalBasis: Array<{ passageId: string; quote: string }>;
      unresolvedQuestions: string[];
    };

/** Structured final outputs only. Hidden model reasoning is deliberately not stored. */
export interface MediationRun {
  id: string;
  disputeVersion: number;
  createdAt: string;
  debateRounds: number;
  modelCalls: number;
  legalContext: LegalCitation[];
  buyerFinal?: AdvocatePosition;
  supplierFinal?: AdvocatePosition;
  mediatorFinal?: MediatorDecision;
  outcome: "proposal" | "abstain" | "validation_failed";
  validationIssues: string[];
}

export interface SettlementAllocation {
  buyerUnits: string;
  supplierUnits: string;
}

export interface Proposal extends SettlementAllocation {
  id: string;
  source: ProposalSource;
  proposedBy: string;
  proposerSide?: PartySide;
  round: number;
  summary: string;
  reasoning: string;
  citations: LegalCitation[];
  evidenceSufficiency?: "strong" | "moderate" | "weak";
  legalRelevance?: "direct" | "analogous" | "limited";
  unresolvedIssues: string[];
  acceptances: PartySide[];
  status: ProposalStatus;
  createdAt: string;
}

export interface SettlementRecord extends SettlementAllocation {
  source: "supplier_agreement" | "mutual_proposal" | "arbitrator" | "early_mutual";
  proposalId?: string;
  agreementId: string;
  evidenceBundleHash: string;
  agreedAt: string;
  executionStatus: "pending_on_chain" | "verified_on_chain";
  execution?: SettlementExecution;
}

export interface SettlementExecution {
  transactionDigest: string;
  packageId: string;
  escrowObjectId: string;
  receiptObjectId: string;
  checkpoint?: string;
  verifiedAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  actorId: string;
  at: string;
  details: Record<string, unknown>;
}

export interface TradeTerms {
  orderReference: string;
  description: string;
  inspectionTerms?: string;
  acceptanceTerms?: string;
  remedyTerms?: string;
  governingLaw: string;
}

export interface DisputeAggregate {
  id: string;
  orderId: string;
  buyerId: string;
  supplierId: string;
  arbitratorId: string;
  assetType: string;
  totalEscrowUnits: string;
  disputedUnits: string;
  undisputedReleasedUnits: string;
  requestedBuyerUnits: string;
  claim: string;
  tradeTerms: TradeTerms;
  status: DisputeStatus;
  negotiationDeadline: string;
  maxHumanRounds: number;
  currentRound: number;
  evidence: EvidenceSubmission[];
  proposals: Proposal[];
  mediationRuns: MediationRun[];
  earlyPositions: Partial<Record<PartySide, Proposal>>;
  settlement?: SettlementRecord;
  escalationReason?: string;
  audit: AuditEvent[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArbitrationCasePackage {
  schemaVersion: 1;
  generatedAt: string;
  dispute: Pick<
    DisputeAggregate,
    | "id"
    | "orderId"
    | "assetType"
    | "totalEscrowUnits"
    | "disputedUnits"
    | "undisputedReleasedUnits"
    | "claim"
    | "tradeTerms"
    | "negotiationDeadline"
    | "escalationReason"
  >;
  evidence: EvidenceSubmission[];
  aiAnalysis: Proposal[];
  mediationRuns: MediationRun[];
  negotiationHistory: Proposal[];
  audit: AuditEvent[];
}

export interface Actor {
  id: string;
  side?: PartySide;
  arbitrator?: boolean;
}

export interface DomainContext {
  now(): Date;
  id(): string;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

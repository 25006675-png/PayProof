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
  /**
   * Mechanical extraction of the file's contents, produced once when the file
   * is submitted. Analysis quotes this text; it never sees the file itself.
   * Absent means the file was registered but never read (policy DP-5.5).
   */
  transcript?: string;
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

export interface QuotedClause { clauseId: string; quote: string; }
export interface QuotedEvidence { evidenceId: string; quote: string; }

/** One side's case, structured as issues, evidence, rules, and application. */
export interface AdvocatePosition {
  side: PartySide;
  recommendedBuyerRefundUnits: string;
  recommendedSupplierReleaseUnits: string;
  issues: string[];
  evidenceBasis: QuotedEvidence[];
  contractBasis: QuotedClause[];
  policyBasis: QuotedClause[];
  application: string;
  concessions: string[];
  inferences: string[];
  unresolvedQuestions: string[];
}

/** A finding on one disputed point, and the quoted evidence supporting it. */
export interface MediatorFinding {
  issue: string;
  finding: string;
  supportingEvidence: QuotedEvidence[];
}

export type MediatorDecision =
  | {
      outcome: "proposal";
      buyerRefundUnits: string;
      supplierReleaseUnits: string;
      commonGround: string[];
      findings: MediatorFinding[];
      contractBasis: QuotedClause[];
      policyBasis: QuotedClause[];
      reasoning: string;
      inferences: string[];
      evidenceSufficiency: "strong" | "moderate" | "weak";
      /** How directly the quoted terms and policy clauses address this dispute. */
      legalRelevance: "direct" | "analogous" | "limited";
      unresolvedQuestions: string[];
    }
  | {
      outcome: "abstain";
      reason: string;
      commonGround: string[];
      findings: MediatorFinding[];
      contractBasis: QuotedClause[];
      policyBasis: QuotedClause[];
      unresolvedQuestions: string[];
    };

/** Maps a readable citation id back to the submission and file it came from. */
export interface EvidenceIndexEntry {
  id: string;
  side: PartySide;
  kind: "statement" | "document_transcript";
  submissionId: string;
  sha256?: string;
  mimeType?: string;
}

/** Structured final outputs only. Hidden model reasoning is deliberately not stored. */
export interface MediationRun {
  id: string;
  disputeVersion: number;
  createdAt: string;
  debateRounds: number;
  modelCalls: number;
  legalContext: LegalCitation[];
  evidenceIndex: EvidenceIndexEntry[];
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
  /** SHA-256 of the immutable proposal/agreement identifier signed by Sui. */
  proposalHash?: string;
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

/**
 * On-chain facts that bind an off-chain dispute to one escrow lifecycle.
 * Clients may submit these after wallet-signed transactions finalize; the
 * backend verifier re-reads each digest from Sui before recording settlement.
 */
export interface OnchainEscrowBinding {
  packageId: string;
  escrowObjectId: string;
  fundingTransactionDigest: string;
  disputeTransactionDigest: string;
  buyerAddress: string;
  supplierAddress: string;
  arbitratorAddress: string;
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
  onchainEscrow?: OnchainEscrowBinding;
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
    | "onchainEscrow"
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
  email?: string;
  name?: string;
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

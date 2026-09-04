import type { TradeOrder } from "@/lib/payproof-api";
import type { OrderRole, OrderStatus } from "@/lib/order-status";

export type DemoOrderRole = OrderRole;

export type DemoOrderLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

export type DocumentKind =
  | "internal_agreement"
  | "purchase_order"
  | "dispatch_evidence"
  | "delivery_evidence"
  | "inspection_evidence"
  | "claim_evidence";

export type ExtractedLine = { description: string; quantity: number; unit: string; unitPrice: number | null };

export type ExtractedPurchaseOrder = {
  reference: string | null;
  supplierName: string | null;
  buyerName: string | null;
  deliveryDate: string | null;
  deliveryLocation: string | null;
  currency: string | null;
  lines: ExtractedLine[];
  warnings: string[];
};

export type OrderDocument = {
  id: string;
  kind: DocumentKind;
  name: string;
  size: number;
  mimeType?: string;
  sha256: string;
  uploadedAt: string;
  uploadedBy: OrderRole;
  extracted?: ExtractedPurchaseOrder;
  /** Plain-text transcript used by the AI mediator. Only for evidence files. */
  transcript?: string;
  /** Path in the backend document store. Present when both parties can open the file. */
  storagePath?: string;
  remote?: boolean;
  /** Public demo asset that can be opened without the private document API. */
  url?: string;
};

export type QuotedClause = { clauseId: string; quote: string };
export type QuotedEvidence = { evidenceId: string; quote: string };

/** One AI advocate's structured case for a side. */
export type AdvocateCase = {
  side: "buyer" | "supplier";
  buyerValue: number;
  supplierValue: number;
  issues: string[];
  evidenceBasis: QuotedEvidence[];
  contractBasis: QuotedClause[];
  policyBasis: QuotedClause[];
  application: string;
  concessions: string[];
  inferences: string[];
  unresolvedQuestions: string[];
};

export type MediatorCase = {
  outcome: "proposal" | "abstain";
  buyerValue?: number;
  supplierValue?: number;
  reason?: string;
  commonGround: string[];
  findings: Array<{ issue: string; finding: string; supportingEvidence: QuotedEvidence[] }>;
  contractBasis: QuotedClause[];
  policyBasis: QuotedClause[];
  reasoning?: string;
  inferences: string[];
  evidenceSufficiency?: "strong" | "moderate" | "weak";
  legalRelevance?: "direct" | "analogous" | "limited";
  unresolvedQuestions: string[];
};

export type MediationReport = {
  legalContext: Array<{ title: string; locator: string; excerpt: string }>;
  evidenceIndex: Array<{ id: string; side: "buyer" | "supplier"; kind: string }>;
  buyer?: AdvocateCase;
  supplier?: AdvocateCase;
  mediator?: MediatorCase;
  debateRounds: number;
};

export type InspectionLine = { lineId: string; accepted: number; missing: number; damaged: number };

export type OrderInspection = {
  lines: InspectionLine[];
  note: string;
  recordedAt: string;
  acceptedValue: number;
  heldValue: number;
};

export type OrderShipment = {
  carrier: string;
  trackingNumber: string;
  dispatchedAt: string;
  expectedAt?: string;
  /** The mark_shipped transaction on Sui, for live orders where the supplier signed shipment. */
  transactionDigest?: string;
  verifiedOnChain?: boolean;
};

/** Deadlines written into the escrow at funding. */
export type OrderDeadlines = {
  deliveryDeadlineMs: number;
  inspectionClosesAtMs: number;
};

export type OrderDelivery = {
  recordedAt: string;
  recordedBy: OrderRole;
  reference?: string;
};

export type OrderConfirmation = {
  confirmedBy: string;
  confirmedRole: "buyer" | "supplier";
  email?: string;
  organizationName?: string;
  orderVersion: number;
  termsVersion: string;
  confirmedAt: string;
};

export type OrderEvent = { at: string; label: string; detail?: string };

export type ClaimStatus = "supplier_review" | "negotiation_open" | "arbitration_pending" | "settlement_pending" | "settled";

export type ClaimProposal = {
  id: string;
  source: "human" | "ai" | "arbitrator" | "early_position";
  side?: "buyer" | "supplier";
  buyerValue: number;
  supplierValue: number;
  summary: string;
  reasoning: string;
  status: "open" | "rejected" | "accepted" | "superseded";
  acceptances: Array<"buyer" | "supplier">;
  citations: Array<{ title: string; locator: string; excerpt: string }>;
  unresolvedIssues: string[];
  evidenceSufficiency?: "strong" | "moderate" | "weak";
  round: number;
  createdAt: string;
};

export type ClaimEvidence = { id: string; side: "buyer" | "supplier"; statement: string; files: number; submittedAt: string };

export type ClaimMediation = {
  id: string;
  createdAt: string;
  outcome: "proposal" | "abstain" | "validation_failed";
  reason?: string;
  unresolved: string[];
  modelCalls: number;
  proposalId?: string;
  report?: MediationReport;
};

/** A dispute normalised for the order page, for live and sample orders alike. */
export type ClaimView = {
  id: string;
  status: ClaimStatus;
  totalValue: number;
  disputedValue: number;
  requestedValue: number;
  undisputedReleased: boolean;
  claim: string;
  deadline: string;
  round: number;
  maxRounds: number;
  evidence: ClaimEvidence[];
  proposals: ClaimProposal[];
  mediations: ClaimMediation[];
  settlement?: { buyerValue: number; supplierValue: number; executionStatus: "pending_on_chain" | "verified_on_chain"; proposalId?: string; agreementId: string; transactionDigest?: string };
  escalationReason?: string;
  onchain?: { escrowObjectId: string; buyerApproved?: boolean; supplierApproved?: boolean };
};

export type DemoOrder = {
  id: string;
  reference: string;
  role: OrderRole;
  initiatorRole: "buyer" | "supplier";
  counterparty: string;
  buyer: string;
  supplier: string;
  item: string;
  items: DemoOrderLine[];
  status: OrderStatus;
  value: number;
  delivery: string;
  deliveryLocation: string;
  settlementAsset: "Testnet SUI" | "Testnet USDC";
  /** Symbol shown next to every amount on this order. */
  currency: string;
  deadlines?: OrderDeadlines;
  inviteToken?: string;
  inviteExpiresAt?: string;
  /** True when the signed-in account is the invited party who still has to confirm. */
  invited?: boolean;
  version: number;
  source: "sample" | "backend";
  /** Curated sample whose demo control walks through the complete claim journey. */
  guidedDemo?: boolean;
  documents: OrderDocument[];
  confirmation?: OrderConfirmation;
  shipment?: OrderShipment;
  deliveryRecord?: OrderDelivery;
  inspection?: OrderInspection;
  claim?: ClaimView;
  events: OrderEvent[];
  funding?: TradeOrder["funding"];
  settlement?: { buyerValue: number; supplierValue: number; transactionDigest?: string; verifiedOnChain: boolean; source?: "full_acceptance" | "dispute" | "refund_unshipped" | "claim_uninspected" };
  disputeId?: string;
  /** The backend record, present for live orders only. */
  raw?: TradeOrder;
};

export const formatOrderMoney = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

export function itemSummary(items: DemoOrderLine[], fallback = "Untitled order"): string {
  const first = items[0]?.description?.trim();
  if (!first) return fallback;
  return items.length > 1 ? `${first} and ${items.length - 1} more` : first;
}

export function totalQuantity(items: DemoOrderLine[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function formatDate(value: string): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Who has to act on a claim right now, from the signed-in party's point of view. */
export function claimOwner(claim: ClaimView | undefined): "buyer" | "supplier" | "both" | "none" {
  if (!claim) return "none";
  switch (claim.status) {
    case "supplier_review": return "supplier";
    case "negotiation_open": {
      const open = claim.proposals.find((proposal) => proposal.status === "open");
      if (!open) return "both";
      if (open.source === "ai") return open.acceptances.length === 0 ? "both" : open.acceptances.includes("buyer") ? "supplier" : "buyer";
      return open.side === "buyer" ? "supplier" : open.side === "supplier" ? "buyer" : "both";
    }
    case "settlement_pending": return "both";
    case "arbitration_pending": return "none";
    default: return "none";
  }
}

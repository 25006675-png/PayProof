import type { OnchainEscrowBinding } from "./types.js";

export type TradeOrderStatus =
  | "awaiting_supplier"
  | "awaiting_buyer"
  | "supplier_confirmed"
  | "funded"
  | "in_transit"
  | "delivered"
  | "dispute_open"
  | "negotiation_open"
  | "arbitration_pending"
  | "settlement_pending"
  | "settled";

export interface TradeLineItem {
  id: string;
  description: string;
  sku?: string;
  quantity: string;
  unit: string;
  unitPriceUnits: string;
}

export type TradeInitiatorRole = "buyer" | "supplier";

export interface TradeReleasePlan {
  depositUnits: string;
  dispatchUnits: string;
  deliveryUnits: string;
}

export interface TradeReleaseRecord {
  stage: "deposit" | "dispatch" | "delivery";
  amountUnits: string;
  cumulativeReleasedUnits: string;
  remainingUnits: string;
  transactionDigest: string;
  verificationStatus: "verified_on_chain" | "external_reference";
  releasedAt: string;
  evidenceSha256?: string;
}

/** Quantities the buyer recorded when inspecting the delivery. */
export interface TradeInspectionLine {
  lineId: string;
  accepted: string;
  missing: string;
  damaged: string;
}

export interface TradeInspection {
  lines: TradeInspectionLine[];
  note?: string;
  recordedBy: string;
  recordedAt: string;
}

/** Who confirmed the shared terms, and which terms version they accepted. */
export interface TradeConfirmation {
  confirmedBy: string;
  confirmedRole: TradeInitiatorRole;
  email?: string;
  organizationName?: string;
  orderVersion: number;
  termsVersion: string;
  confirmedAt: string;
}

export interface TradeShipment {
  carrier: string;
  trackingNumber: string;
  dispatchedAt: string;
  expectedAt?: string;
  recordedBy: string;
  /** The mark_shipped transaction, when the supplier signed shipment on Sui. */
  transactionDigest?: string;
  verificationStatus?: "verified_on_chain" | "external_reference";
}

export interface TradeDeliveryRecord {
  reference?: string;
  recordedBy: string;
  recordedAt: string;
}

export type TradeDocumentKind =
  | "internal_agreement"
  | "purchase_order"
  | "dispatch_evidence"
  | "delivery_evidence"
  | "inspection_evidence"
  | "claim_evidence";

/** A file attached to the order. Bytes live in the document store; this is the shared record. */
export interface TradeDocument {
  id: string;
  kind: TradeDocumentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  uploadedBy: string;
  uploadedRole: TradeInitiatorRole;
  uploadedAt: string;
  /** The anchor_evidence transaction that bound this file's hash to the escrow. */
  anchor?: { transactionDigest: string; verificationStatus: "verified_on_chain" | "external_reference" };
  /** Plain-text reading of the file, produced once at upload for the record and the mediator. */
  transcript?: string;
  /** Structured purchase-order extraction, when the file was read as a purchase order. */
  extracted?: Record<string, unknown>;
}

export interface TradeOrder {
  id: string;
  reference: string;
  /** Which party issued the order. Undefined means buyer, for records created before supplier-initiated orders existed. */
  initiatorRole?: TradeInitiatorRole;
  /** Absent until the buyer confirms a supplier-initiated order. */
  buyerId?: string;
  buyerOrganizationId?: string;
  buyerEmail?: string;
  buyerName?: string;
  supplierId?: string;
  supplierOrganizationId?: string;
  supplierEmail: string;
  supplierName: string;
  supplierWalletAddress?: string;
  arbitratorWalletAddress?: string;
  arbitratorId: string;
  assetType: string;
  amountUnits: string;
  orderHash: string;
  description: string;
  deliveryDate: string;
  deliveryLocation: string;
  lineItems: TradeLineItem[];
  /** Exact base-unit allocation accepted with the commercial terms. */
  releasePlan?: TradeReleasePlan;
  releaseRecords?: TradeReleaseRecord[];
  status: TradeOrderStatus;
  inviteId?: string;
  inviteExpiresAt?: string;
  funding?: {
    packageId: string;
    escrowObjectId: string;
    transactionDigest: string;
    buyerAddress: string;
    supplierAddress: string;
    arbitratorAddress: string;
    verificationStatus: "verified_on_chain" | "external_reference";
    fundedAt: string;
    /** Deadlines written into the escrow: the supplier must ship by the first, and the buyer must
     *  inspect within the second after the later of shipment and that deadline. */
    deliveryDeadlineMs?: number;
    inspectionWindowMs?: number;
  };
  /** Set when the claim transaction paid the undisputed value to the supplier. */
  undisputedRelease?: {
    transactionDigest: string;
    verificationStatus: "verified_on_chain" | "external_reference";
    releasedAt: string;
  };
  disputeId?: string;
  confirmation?: TradeConfirmation;
  documents?: TradeDocument[];
  shipment?: TradeShipment;
  deliveryRecord?: TradeDeliveryRecord;
  inspection?: TradeInspection;
  settlement?: {
    buyerUnits: string;
    supplierUnits: string;
    transactionDigest?: string;
    receiptObjectId?: string;
    verifiedOnChain: boolean;
    /** "full_acceptance" when the buyer released the whole escrow without a dispute; the two
     *  deadline sources are the contract's no-signature-needed paths. */
    source?: "full_acceptance" | "dispute" | "refund_unshipped" | "claim_uninspected";
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TradeInvite {
  id: string;
  orderId: string;
  tokenHash: string;
  invitedEmail: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  createdAt: string;
  deliveryStatus?: "sent" | "failed" | "not_configured";
  deliveryMessageId?: string;
  deliveryAttemptedAt?: string;
}

/** A pending invitation as shown to the invited party before they accept. */
export interface TradeInvitation {
  orderId: string;
  reference: string;
  /** Name of the party that sent the invitation. Kept as buyerName for older clients. */
  buyerName: string;
  counterpartyName: string;
  /** The role the invited account takes on the order. */
  invitedRole: TradeInitiatorRole;
  invitedEmail: string;
  assetType: string;
  amountUnits: string;
  deliveryDate: string;
  invitedAt: string;
  expiresAt: string;
}

export interface FundingInput {
  packageId: string;
  escrowObjectId: string;
  transactionDigest: string;
  buyerAddress: string;
  supplierAddress: string;
  arbitratorAddress: string;
  verificationStatus?: "verified_on_chain" | "external_reference";
  deliveryDeadlineMs?: number;
  inspectionWindowMs?: number;
}

export interface ShipmentInput {
  carrier: string;
  trackingNumber: string;
  dispatchedAt: string;
  expectedAt?: string;
  transactionDigest: string;
  evidenceSha256: string;
}

export type DeadlineSettlementKind = "refund_unshipped" | "claim_uninspected";

export interface DeadlineSettlementInput {
  kind: DeadlineSettlementKind;
  transactionDigest: string;
  receiptObjectId?: string;
}

export interface AcceptDeliveryInput {
  transactionDigest: string;
  receiptObjectId?: string;
  inspection?: { lines: TradeInspectionLine[]; note?: string };
  verificationStatus?: "verified_on_chain" | "external_reference";
}

export interface TradeOrderWithInvite extends TradeOrder {
  inviteToken?: string;
  inviteUrl?: string;
  inviteDelivery?: {
    status: "sent" | "failed" | "not_configured";
    messageId?: string;
    attemptedAt: string;
  };
}

export function publicOrder(order: TradeOrder): TradeOrder {
  return structuredClone(order);
}

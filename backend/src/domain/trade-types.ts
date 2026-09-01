import type { OnchainEscrowBinding } from "./types.js";

export type TradeOrderStatus =
  | "awaiting_supplier"
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

export interface TradeOrder {
  id: string;
  reference: string;
  buyerId: string;
  buyerEmail?: string;
  buyerName?: string;
  supplierId?: string;
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
  };
  undisputedRelease?: {
    transactionDigest: string;
    verificationStatus: "verified_on_chain" | "external_reference";
    releasedAt: string;
  };
  disputeId?: string;
  settlement?: {
    buyerUnits: string;
    supplierUnits: string;
    transactionDigest?: string;
    receiptObjectId?: string;
    verifiedOnChain: boolean;
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
}

export interface FundingInput {
  packageId: string;
  escrowObjectId: string;
  transactionDigest: string;
  buyerAddress: string;
  supplierAddress: string;
  arbitratorAddress: string;
  verificationStatus?: "verified_on_chain" | "external_reference";
}

export interface UndisputedReleaseInput {
  transactionDigest: string;
  verificationStatus?: "verified_on_chain" | "external_reference";
}

export interface TradeOrderWithInvite extends TradeOrder {
  inviteToken?: string;
  inviteUrl?: string;
}

export function publicOrder(order: TradeOrder): TradeOrder {
  return structuredClone(order);
}

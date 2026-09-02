"use client";

import { apiRequest, backendUrl, loadSession, type InvitationDelivery, type TradeInvitation, type TradeOrder, type WorkspaceProfile } from "@/lib/payproof-api";
import { type DemoOrder, type DocumentKind, type ExtractedPurchaseOrder, type InspectionLine, type OrderDocument, type OrderEvent, type OrderInspection, formatOrderMoney as money, itemSummary } from "@/lib/demo-orders";
import { STATUS, type OrderStatus } from "@/lib/order-status";
import { DEFAULT_ARBITRATOR_ADDRESS, SUI_TYPE, TESTNET_USDC_TYPE } from "@/lib/sui-dapp-kit";

/** Orders carry their own coin type, so scale and label follow the order rather than a global constant.
 *  Orders created before the move to SUI still hold the USDC type and six decimal amounts. */
type AssetLabel = "Testnet SUI" | "Testnet USDC";
const ASSETS: Record<string, { decimals: number; symbol: string; label: AssetLabel }> = {
  [SUI_TYPE]: { decimals: 9, symbol: "SUI", label: "Testnet SUI" },
  [TESTNET_USDC_TYPE]: { decimals: 6, symbol: "USDC", label: "Testnet USDC" },
};
const DEFAULT_ASSET = ASSETS[SUI_TYPE];

const assetOf = (assetType?: string) => (assetType && ASSETS[assetType]) || DEFAULT_ASSET;
export const assetSymbol = (assetType?: string) => assetOf(assetType).symbol;
export const assetLabel = (assetType?: string): AssetLabel => assetOf(assetType).label;
const DEFAULT_ARBITRATOR_ID = process.env.NEXT_PUBLIC_DEFAULT_ARBITRATOR_ID?.trim()
  || "00000000-0000-4000-8000-000000000001";

export function fromUnits(units: string, assetType?: string): number {
  return Number(BigInt(units)) / 10 ** assetOf(assetType).decimals;
}

export function toUnits(value: number, assetType?: string): string {
  return BigInt(Math.round(value * 10 ** assetOf(assetType).decimals)).toString();
}

function inspectionFromOrder(order: TradeOrder): OrderInspection | undefined {
  const record = order.inspection;
  if (!record) return undefined;
  const lines: InspectionLine[] = record.lines.map((line) => ({ lineId: line.lineId, accepted: Number(line.accepted), missing: Number(line.missing), damaged: Number(line.damaged) }));
  const acceptedValue = lines.reduce((sum, line) => {
    const item = order.lineItems.find((candidate) => candidate.id === line.lineId);
    return sum + (item ? line.accepted * fromUnits(item.unitPriceUnits, order.assetType) : 0);
  }, 0);
  return { lines, note: record.note ?? "", recordedAt: record.recordedAt, acceptedValue, heldValue: Math.max(0, fromUnits(order.amountUnits, order.assetType) - acceptedValue) };
}

function liveEvents(order: TradeOrder): OrderEvent[] {
  const initiator = order.initiatorRole === "supplier" ? order.supplierName : order.buyerName || "The buyer";
  const events: OrderEvent[] = [{ at: order.createdAt, label: "Order created", detail: `${initiator} issued the purchase order${order.initiatorRole === "supplier" ? " as supplier" : ""}.` }];
  const step = STATUS[order.status as OrderStatus]?.step ?? 0;
  if (order.confirmation) {
    const who = order.confirmation.organizationName || (order.confirmation.confirmedRole === "buyer" ? order.buyerName : order.supplierName) || "The counterparty";
    events.push({ at: order.confirmation.confirmedAt, label: "Order confirmed", detail: `Confirmed by ${who}, order version ${order.confirmation.orderVersion + 1}, terms version ${order.confirmation.termsVersion}.` });
  } else if (order.supplierId && order.buyerId && step >= 1) {
    events.push({ at: order.updatedAt, label: "Order confirmed", detail: "Both parties confirmed the order terms." });
  }
  if (order.funding) events.push({ at: order.funding.fundedAt, label: "Escrow funded", detail: order.funding.verificationStatus === "verified_on_chain" ? `${money(fromUnits(order.amountUnits, order.assetType))} ${assetSymbol(order.assetType)} secured and verified on Sui.` : `${money(fromUnits(order.amountUnits, order.assetType))} ${assetSymbol(order.assetType)} recorded from an external Sui reference.` });
  if (order.shipment) events.push({ at: order.shipment.dispatchedAt, label: "Shipped", detail: `${order.supplierName} dispatched the goods with ${order.shipment.carrier}${order.shipment.trackingNumber ? `, tracking ${order.shipment.trackingNumber}` : ""}.` });
  else if (step >= 3) events.push({ at: order.updatedAt, label: "Shipped", detail: `${order.supplierName} marked the order in transit.` });
  if (order.deliveryRecord) events.push({ at: order.deliveryRecord.recordedAt, label: "Delivered", detail: order.deliveryRecord.reference ? `Delivery recorded, reference ${order.deliveryRecord.reference}.` : "Delivery was recorded." });
  else if (step >= 4) events.push({ at: order.updatedAt, label: "Delivered", detail: "Delivery was recorded." });
  for (const document of order.documents ?? []) events.push({ at: document.uploadedAt, label: "Document attached", detail: `${document.name}, by ${document.uploadedRole === "buyer" ? order.buyerName || "the buyer" : order.supplierName}.` });
  if (order.inspection) events.push({ at: order.inspection.recordedAt, label: "Inspection recorded", detail: order.inspection.note || "Quantities were recorded for every line." });
  if (order.disputeId) events.push({ at: order.updatedAt, label: "Claim opened", detail: "The buyer reported exceptions. The disputed amount is held." });
  if (order.undisputedRelease) events.push({ at: order.undisputedRelease.releasedAt, label: "Undisputed amount released", detail: "The accepted value was released to the supplier." });
  if (order.settlement) events.push({ at: order.updatedAt, label: "Settled", detail: order.settlement.source === "full_acceptance" ? "Delivery accepted in full. The whole escrow was released to the supplier." : order.settlement.verifiedOnChain ? "Settlement verified on Sui." : "Settlement recorded." });
  return events;
}

function documentsOf(order: TradeOrder): OrderDocument[] {
  return (order.documents ?? []).map((document) => ({
    id: document.id, kind: document.kind as DocumentKind, name: document.name, size: document.sizeBytes, mimeType: document.mimeType, sha256: document.sha256,
    uploadedAt: document.uploadedAt, uploadedBy: document.uploadedRole === "buyer" ? "BUYER" as const : "SUPPLIER" as const,
    extracted: document.extracted as ExtractedPurchaseOrder | undefined, transcript: document.transcript, storagePath: document.storagePath, remote: true,
  })).reverse();
}

export function tradeOrderToView(order: TradeOrder, profile?: WorkspaceProfile): DemoOrder {
  const session = loadSession();
  const organizationIds = profile?.organizations.map((item) => item.organizationId) ?? [];
  const isBuyer = Boolean(order.buyerId) && (order.buyerId === session?.user.id || organizationIds.includes(order.buyerOrganizationId ?? ""));
  const isSupplier = Boolean(order.supplierId) && (order.supplierId === session?.user.id || organizationIds.includes(order.supplierOrganizationId ?? ""));
  const email = session?.user.email?.trim().toLowerCase();
  const pendingSide = !order.buyerId ? "buyer" : !order.supplierId ? "supplier" : undefined;
  const pendingEmail = pendingSide === "buyer" ? order.buyerEmail?.trim().toLowerCase() : pendingSide === "supplier" ? order.supplierEmail.trim().toLowerCase() : undefined;
  const invited = Boolean(email && pendingEmail && pendingEmail === email && !isBuyer && !isSupplier);
  const role: DemoOrder["role"] = isBuyer ? "BUYER" : isSupplier ? "SUPPLIER" : invited && pendingSide === "buyer" ? "BUYER" : "SUPPLIER";
  const items = order.lineItems.map((item) => ({
    id: item.id, description: item.description, quantity: Number(item.quantity), unit: item.unit,
    unitPrice: fromUnits(item.unitPriceUnits, order.assetType),
  }));
  const buyer = order.buyerName || order.buyerEmail || "Buyer organisation";
  const supplier = order.supplierName || order.supplierEmail;
  const status = (STATUS[order.status as OrderStatus] ? order.status : "awaiting_supplier") as OrderStatus;
  return {
    invited,
    inviteExpiresAt: order.inviteExpiresAt,
    id: order.id, reference: order.reference, role, initiatorRole: order.initiatorRole ?? "buyer",
    counterparty: role === "BUYER" ? supplier : buyer, buyer, supplier,
    item: itemSummary(items, order.description),
    items, status, value: fromUnits(order.amountUnits, order.assetType),
    delivery: order.deliveryDate, deliveryLocation: order.deliveryLocation,
    settlementAsset: assetLabel(order.assetType),
    version: order.version, inviteToken: undefined,
    source: "backend",
    documents: documentsOf(order),
    confirmation: order.confirmation,
    shipment: order.shipment ? { carrier: order.shipment.carrier, trackingNumber: order.shipment.trackingNumber, dispatchedAt: order.shipment.dispatchedAt, expectedAt: order.shipment.expectedAt } : undefined,
    deliveryRecord: order.deliveryRecord ? { recordedAt: order.deliveryRecord.recordedAt, recordedBy: order.deliveryRecord.recordedBy === order.buyerId ? "BUYER" : "SUPPLIER", reference: order.deliveryRecord.reference } : undefined,
    inspection: inspectionFromOrder(order),
    events: liveEvents(order),
    funding: order.funding,
    disputeId: order.disputeId,
    settlement: order.settlement ? {
      buyerValue: fromUnits(order.settlement.buyerUnits), supplierValue: fromUnits(order.settlement.supplierUnits),
      transactionDigest: order.settlement.transactionDigest, verifiedOnChain: order.settlement.verifiedOnChain, source: order.settlement.source,
    } : undefined,
    raw: order,
  };
}

export async function loadLiveOrders(): Promise<{ orders: DemoOrder[]; profile: WorkspaceProfile }> {
  const [raw, profile] = await Promise.all([
    apiRequest<TradeOrder[]>("/v1/orders"), apiRequest<WorkspaceProfile>("/v1/workspace"),
  ]);
  return { orders: raw.map((order) => tradeOrderToView(order, profile)), profile };
}

export type CreateLiveOrderInput = {
  reference: string;
  initiatorRole: "buyer" | "supplier";
  counterpartyName: string;
  counterpartyEmail: string;
  deliveryDate: string;
  deliveryLocation: string;
  items: Array<{ id: string; description: string; quantity: number; unit: string; unitPrice: number }>;
  organizationId: string;
  supplierWalletAddress?: string;
};

export async function createLiveOrder(input: CreateLiveOrderInput): Promise<{ order: DemoOrder; inviteUrl: string; inviteDelivery: InvitationDelivery }> {
  const amount = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const counterparty = input.initiatorRole === "buyer"
    ? { supplierEmail: input.counterpartyEmail.trim().toLowerCase(), supplierName: input.counterpartyName.trim(), buyerOrganizationId: input.organizationId }
    : { buyerEmail: input.counterpartyEmail.trim().toLowerCase(), buyerName: input.counterpartyName.trim(), supplierOrganizationId: input.organizationId, supplierWalletAddress: input.supplierWalletAddress };
  const created = await apiRequest<TradeOrder>("/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      reference: input.reference.trim() || `PO-${Date.now().toString().slice(-8)}`,
      initiatorRole: input.initiatorRole, ...counterparty,
      arbitratorId: DEFAULT_ARBITRATOR_ID, arbitratorWalletAddress: DEFAULT_ARBITRATOR_ADDRESS, assetType: SUI_TYPE, amountUnits: toUnits(amount),
      description: input.items.map((item) => item.description).join("; "),
      deliveryDate: input.deliveryDate, deliveryLocation: input.deliveryLocation,
      lineItems: input.items.map((item) => ({
        id: item.id, description: item.description, quantity: String(item.quantity), unit: item.unit,
        unitPriceUnits: toUnits(item.unitPrice),
      })),
    }),
  });
  const invited = await apiRequest<TradeOrder & { inviteUrl: string; inviteDelivery: InvitationDelivery }>(`/v1/orders/${created.id}/invite`, { method: "POST" });
  return { order: tradeOrderToView(invited), inviteUrl: invited.inviteUrl, inviteDelivery: invited.inviteDelivery };
}

/** The order's party ids are PayProof account ids, not the session user id, so the role can
 *  only be resolved against the workspace profile. Any view built without it reads as SUPPLIER. */
export async function viewLiveOrder(order: TradeOrder): Promise<DemoOrder> {
  return tradeOrderToView(order, await apiRequest<WorkspaceProfile>("/v1/workspace"));
}

async function withProfile(request: Promise<TradeOrder>): Promise<DemoOrder> {
  const [order, profile] = await Promise.all([request, apiRequest<WorkspaceProfile>("/v1/workspace")]);
  return tradeOrderToView(order, profile);
}

export async function getLiveOrder(id: string): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}`));
}

export async function sendLiveInvite(id: string): Promise<{ order: DemoOrder; inviteUrl: string; inviteDelivery: InvitationDelivery }> {
  const [invited, profile] = await Promise.all([
    apiRequest<TradeOrder & { inviteUrl: string; inviteDelivery: InvitationDelivery }>(`/v1/orders/${encodeURIComponent(id)}/invite`, { method: "POST" }),
    apiRequest<WorkspaceProfile>("/v1/workspace"),
  ]);
  return { order: tradeOrderToView(invited, profile), inviteUrl: invited.inviteUrl, inviteDelivery: invited.inviteDelivery };
}

export type LiveInvitation = {
  orderId: string;
  reference: string;
  counterpartyName: string;
  invitedRole: "buyer" | "supplier";
  invitedEmail: string;
  value: number;
  deliveryDate: string;
  expiresAt: string;
};

export async function loadInvitations(): Promise<LiveInvitation[]> {
  const invitations = await apiRequest<TradeInvitation[]>("/v1/invitations");
  return invitations.map((invitation) => ({
    orderId: invitation.orderId, reference: invitation.reference, counterpartyName: invitation.counterpartyName ?? invitation.buyerName,
    invitedRole: invitation.invitedRole ?? "supplier",
    invitedEmail: invitation.invitedEmail, value: fromUnits(invitation.amountUnits),
    deliveryDate: invitation.deliveryDate, expiresAt: invitation.expiresAt,
  }));
}

export async function cancelLiveInvite(id: string): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}/invite/cancel`, { method: "POST" }));
}

/** Accept an invitation the invited party reached from their workspace, with no token in hand. */
export async function acceptLiveInvitation(id: string): Promise<DemoOrder> {
  const session = loadSession();
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}/accept`, {
    method: "POST", body: JSON.stringify({ name: session?.user.name, supplierWalletAddress: session?.suiAddress }),
  }));
}

export async function acceptLiveInvite(token: string): Promise<DemoOrder> {
  const session = loadSession();
  return withProfile(apiRequest<TradeOrder>(`/v1/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST", body: JSON.stringify({ email: session?.user.email, name: session?.user.name, supplierWalletAddress: session?.suiAddress }),
  }));
}

export async function previewLiveInvite(token: string): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/invites/${encodeURIComponent(token)}`));
}

export async function markLiveShipment(id: string, shipment?: { carrier: string; trackingNumber: string; dispatchedAt: string; expectedAt?: string }): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}/shipment`, { method: "POST", body: JSON.stringify(shipment ?? {}) }));
}

export async function markLiveDelivered(id: string, record?: { reference?: string }): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}/delivery`, { method: "POST", body: JSON.stringify(record ?? {}) }));
}

export type AcceptanceInput = {
  transactionDigest: string;
  receiptObjectId?: string;
  inspection?: { lines: InspectionLine[]; note?: string };
};

/** Records the buyer's full acceptance against the release transaction. */
export async function acceptLiveDelivery(id: string, input: AcceptanceInput): Promise<DemoOrder> {
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(id)}/acceptance`, {
    method: "POST",
    body: JSON.stringify({
      transactionDigest: input.transactionDigest, receiptObjectId: input.receiptObjectId,
      inspection: input.inspection ? { lines: input.inspection.lines.map((line) => ({ lineId: line.lineId, accepted: String(line.accepted), missing: String(line.missing), damaged: String(line.damaged) })), note: input.inspection.note } : undefined,
    }),
  }));
}

const placeholderId = (prefix: string) => `${prefix}${Date.now().toString(16).padStart(40, "0")}`;

/**
 * Demo control only: records a funding reference without an on-chain
 * transaction. The backend accepts this only when its Sui verifier is off and
 * marks the record as an external reference.
 */
export async function recordDemoFunding(order: DemoOrder): Promise<DemoOrder> {
  const raw = order.raw;
  if (!raw) throw new Error("Only live orders can record funding.");
  const session = loadSession();
  return withProfile(apiRequest<TradeOrder>(`/v1/orders/${encodeURIComponent(order.id)}/funding`, {
    method: "POST",
    body: JSON.stringify({
      packageId: process.env.NEXT_PUBLIC_PAYPROOF_PACKAGE_ID?.trim() || "0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535",
      escrowObjectId: placeholderId("0x"), transactionDigest: `demo-${Date.now()}`,
      buyerAddress: session?.suiAddress || placeholderId("0x"), supplierAddress: raw.supplierWalletAddress || placeholderId("0x"),
      arbitratorAddress: raw.arbitratorWalletAddress || DEFAULT_ARBITRATOR_ADDRESS,
    }),
  }));
}

/** Uploads a file to the order's document store and returns the refreshed order. */
export async function uploadOrderDocument(orderId: string, file: File, kind: DocumentKind, extras: { transcript?: string; extracted?: ExtractedPurchaseOrder } = {}): Promise<DemoOrder> {
  const session = loadSession();
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("kind", kind);
  if (extras.transcript) form.append("transcript", extras.transcript);
  if (extras.extracted) form.append("extracted", JSON.stringify(extras.extracted));
  const response = await fetch(`${backendUrl()}/v1/orders/${encodeURIComponent(orderId)}/documents`, { method: "POST", headers: session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : undefined, body: form });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(payload.message || payload.error || `The file could not be uploaded (${response.status}).`);
  }
  const [order, profile] = await Promise.all([response.json() as Promise<TradeOrder>, apiRequest<WorkspaceProfile>("/v1/workspace")]);
  return tradeOrderToView(order, profile);
}

/** Opens a document the backend serves only to the two parties. */
export async function openOrderDocument(orderId: string, documentId: string): Promise<void> {
  const session = loadSession();
  const response = await fetch(`${backendUrl()}/v1/orders/${encodeURIComponent(orderId)}/documents/${encodeURIComponent(documentId)}`, { headers: session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : undefined });
  if (!response.ok) throw new Error(`The document could not be opened (${response.status}).`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Demo control only: full acceptance without the release_full transaction. */
export async function recordDemoAcceptance(order: DemoOrder, inspection?: { lines: InspectionLine[]; note?: string }): Promise<DemoOrder> {
  return acceptLiveDelivery(order.id, { transactionDigest: `demo-release-${Date.now()}`, inspection });
}

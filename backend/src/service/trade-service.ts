import { createHash, randomBytes } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { DisputeService } from "./dispute-service.js";
import { DomainError, type Actor, type DomainContext, type EvidenceFile } from "../domain/types.js";
import type {
  FundingInput,
  TradeInvite,
  TradeOrder,
  TradeOrderStatus,
  TradeOrderWithInvite,
  TradeLineItem,
  UndisputedReleaseInput,
} from "../domain/trade-types.js";
import type { TradeStore } from "../store/trade-store.js";
import type { SuiFundingVerifier } from "../integrations/sui-funding.js";

export interface CreateTradeOrderInput {
  reference: string;
  supplierEmail: string;
  supplierName?: string;
  supplierWalletAddress?: string;
  arbitratorWalletAddress?: string;
  arbitratorId: string;
  assetType: string;
  amountUnits: string;
  description: string;
  deliveryDate: string;
  deliveryLocation: string;
  lineItems: TradeLineItem[];
}

export interface OpenTradeDisputeInput {
  disputeTransactionDigest: string;
  disputedUnits: string;
  requestedBuyerUnits: string;
  claim: string;
  evidenceStatement: string;
  evidenceFiles?: EvidenceFile[];
  negotiationDeadline: string;
  maxHumanRounds?: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenHash(token: string): string {
  return sha256(token);
}

function canonicalOrderHash(input: CreateTradeOrderInput, buyerId: string): string {
  return sha256(JSON.stringify({
    reference: input.reference.trim(), buyerId, supplierEmail: input.supplierEmail.trim().toLowerCase(),
    supplierName: input.supplierName?.trim() ?? "", supplierWalletAddress: input.supplierWalletAddress, arbitratorWalletAddress: input.arbitratorWalletAddress, arbitratorId: input.arbitratorId,
    assetType: input.assetType, amountUnits: input.amountUnits, description: input.description.trim(),
    deliveryDate: input.deliveryDate, deliveryLocation: input.deliveryLocation.trim(), lineItems: input.lineItems,
  }));
}

function ensureEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("INVALID_EMAIL", "A valid supplier email is required", 400);
  return email;
}

function ensureAmount(value: string): string {
  if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) <= 0n) {
    throw new DomainError("INVALID_ORDER_AMOUNT", "Order amount must be a positive integer in asset base units", 400);
  }
  return value;
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try { return normalizeSuiAddress(left) === normalizeSuiAddress(right); } catch { return left.toLowerCase() === right.toLowerCase(); }
}

function allowed(order: TradeOrder, actor: Actor): boolean {
  return order.buyerId === actor.id || order.supplierId === actor.id || order.arbitratorId === actor.id;
}

export class TradeService {
  constructor(
    private readonly store: TradeStore,
    private readonly disputes: DisputeService,
    private readonly ctx: DomainContext,
    private readonly inviteBaseUrl = "http://localhost:3000/workspace",
    private readonly fundingVerifier?: SuiFundingVerifier,
  ) {}

  async createOrder(input: CreateTradeOrderInput, actor: Actor): Promise<TradeOrder> {
    if (!input.reference.trim() || !input.description.trim() || !input.deliveryDate.trim() || !input.deliveryLocation.trim()) {
      throw new DomainError("INVALID_ORDER", "Reference, description, delivery date, and location are required", 400);
    }
    if (actor.id === input.arbitratorId) throw new DomainError("INVALID_PARTIES", "Buyer and arbitrator must be different", 400);
    const now = this.ctx.now().toISOString();
    const order: TradeOrder = {
      id: this.ctx.id(), reference: input.reference.trim(), buyerId: actor.id,
      buyerEmail: actor.email, buyerName: actor.name,
      supplierEmail: ensureEmail(input.supplierEmail), supplierName: input.supplierName?.trim() || input.supplierEmail.trim(), supplierWalletAddress: input.supplierWalletAddress?.trim(), arbitratorWalletAddress: input.arbitratorWalletAddress?.trim(),
      arbitratorId: input.arbitratorId, assetType: input.assetType.trim(), amountUnits: ensureAmount(input.amountUnits),
      orderHash: canonicalOrderHash(input, actor.id), description: input.description.trim(),
      deliveryDate: input.deliveryDate.trim(), deliveryLocation: input.deliveryLocation.trim(),
      lineItems: structuredClone(input.lineItems), status: "awaiting_supplier", version: 0,
      createdAt: now, updatedAt: now,
    };
    await this.store.createOrder(order);
    return structuredClone(order);
  }

  async listOrders(actor: Actor): Promise<TradeOrder[]> {
    return this.store.listOrders(actor.id);
  }

  async getOrder(id: string, actor: Actor): Promise<TradeOrder> {
    const order = await this.store.getOrder(id);
    if (!order) throw new DomainError("NOT_FOUND", "Trade order not found", 404);
    if (!allowed(order, actor)) throw new DomainError("FORBIDDEN", "Actor cannot access this trade order", 403);
    return order;
  }

  async createInvite(orderId: string, actor: Actor): Promise<TradeOrderWithInvite> {
    const order = await this.getOrder(orderId, actor);
    if (order.buyerId !== actor.id) throw new DomainError("FORBIDDEN", "Only the buyer can send an invitation", 403);
    if (order.status !== "awaiting_supplier") throw new DomainError("INVALID_STATE", "This order is no longer waiting for a supplier");
    const existing = await this.store.getInviteByOrderId(orderId);
    const now = this.ctx.now();
    if (existing && !existing.acceptedBy && new Date(existing.expiresAt).getTime() > now.getTime()) {
      // The raw token is intentionally never stored, so an unaccepted invite
      // cannot be re-issued after a page reload. Expire it before minting a
      // fresh one when the buyer explicitly asks to resend.
      await this.store.saveInvite({ ...existing, expiresAt: now.toISOString() });
    }
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invite: TradeInvite = {
      id: this.ctx.id(), orderId, tokenHash: tokenHash(rawToken), invitedEmail: order.supplierEmail,
      expiresAt, createdAt: now.toISOString(),
    };
    await this.store.createInvite(invite);
    const updated: TradeOrder = { ...order, inviteId: invite.id, inviteExpiresAt: expiresAt, updatedAt: now.toISOString(), version: order.version + 1 };
    await this.store.saveOrder(updated, order.version);
    const result = structuredClone(updated) as TradeOrderWithInvite;
    result.inviteToken = rawToken;
    result.inviteUrl = `${this.inviteBaseUrl}?invite=${encodeURIComponent(rawToken)}`;
    return result;
  }

  async acceptInvite(rawToken: string, actor: Actor, input: { email?: string; name?: string; supplierWalletAddress?: string } = {}): Promise<TradeOrder> {
    if (!rawToken.trim()) throw new DomainError("INVALID_INVITE", "Invitation token is required", 400);
    const invite = await this.store.getInviteByTokenHash(tokenHash(rawToken.trim()));
    if (!invite) throw new DomainError("INVALID_INVITE", "This invitation is invalid or has expired", 404);
    if (new Date(invite.expiresAt).getTime() <= this.ctx.now().getTime()) throw new DomainError("INVITE_EXPIRED", "This invitation has expired", 410);
    const order = await this.store.getOrder(invite.orderId);
    if (!order) throw new DomainError("NOT_FOUND", "The invited order no longer exists", 404);
    if (order.supplierId && order.supplierId !== actor.id) throw new DomainError("INVITE_ALREADY_ACCEPTED", "This order has already been accepted by another supplier", 409);
    if (invite.acceptedBy && invite.acceptedBy !== actor.id) throw new DomainError("INVITE_ALREADY_ACCEPTED", "This invitation has already been accepted", 409);
    if (actor.id === order.buyerId || actor.id === order.arbitratorId) throw new DomainError("INVALID_PARTY", "Buyer and arbitrator cannot accept as supplier", 400);
    const verifiedEmail = actor.email?.trim().toLowerCase();
    const submittedEmail = input.email?.trim().toLowerCase();
    if (verifiedEmail && submittedEmail && verifiedEmail !== submittedEmail) throw new DomainError("INVITE_EMAIL_MISMATCH", "The submitted supplier email does not match the authenticated account", 403);
    const candidateEmail = verifiedEmail ?? submittedEmail;
    if (!candidateEmail) throw new DomainError("INVITE_EMAIL_REQUIRED", "A verified supplier email is required to accept this invitation", 403);
    if (candidateEmail !== invite.invitedEmail) throw new DomainError("INVITE_EMAIL_MISMATCH", "This invitation was issued to a different supplier account", 403);
    const now = this.ctx.now().toISOString();
    if (order.supplierWalletAddress && input.supplierWalletAddress && !sameAddress(order.supplierWalletAddress, input.supplierWalletAddress)) throw new DomainError("SUPPLIER_WALLET_MISMATCH", "The supplier wallet does not match the wallet recorded on the order", 409);
    const updated: TradeOrder = {
      ...order, supplierId: actor.id, supplierEmail: ensureEmail(input.email ?? actor.email ?? order.supplierEmail),
      supplierName: (input.name ?? actor.name ?? order.supplierName).trim(), supplierWalletAddress: order.supplierWalletAddress ?? input.supplierWalletAddress?.trim(), status: "supplier_confirmed",
      updatedAt: now, version: order.version + 1,
    };
    await this.store.saveOrder(updated, order.version);
    await this.store.saveInvite({ ...invite, acceptedBy: actor.id, acceptedAt: now });
    return updated;
  }

  async recordFunding(orderId: string, actor: Actor, input: FundingInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (order.buyerId !== actor.id) throw new DomainError("FORBIDDEN", "Only the buyer can fund an order", 403);
    if (!order.supplierId) throw new DomainError("SUPPLIER_REQUIRED", "The supplier must accept the invitation before funding", 409);
    if (!["supplier_confirmed", "funded"].includes(order.status)) throw new DomainError("INVALID_STATE", "This order is not ready for funding");
    if (!input.packageId || !input.escrowObjectId || !input.transactionDigest) throw new DomainError("INVALID_FUNDING", "Sui package, escrow object, and transaction digest are required", 400);
    if (order.funding) {
      const same = order.funding.packageId === input.packageId && sameAddress(order.funding.escrowObjectId, input.escrowObjectId) && order.funding.transactionDigest === input.transactionDigest && sameAddress(order.funding.buyerAddress, input.buyerAddress) && sameAddress(order.funding.supplierAddress, input.supplierAddress) && sameAddress(order.funding.arbitratorAddress, input.arbitratorAddress);
      if (same) return structuredClone(order);
      throw new DomainError("FUNDING_ALREADY_RECORDED", "This order is already bound to a different escrow funding transaction", 409);
    }
    if (order.supplierWalletAddress && !sameAddress(order.supplierWalletAddress, input.supplierAddress)) throw new DomainError("SUPPLIER_WALLET_MISMATCH", "Funding must pay the supplier wallet recorded on the order", 409);
    if (order.arbitratorWalletAddress && !sameAddress(order.arbitratorWalletAddress, input.arbitratorAddress)) throw new DomainError("ARBITRATOR_WALLET_MISMATCH", "Funding must use the arbitrator wallet recorded on the order", 409);
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier) {
      await this.fundingVerifier.verify(order, input);
      verificationStatus = "verified_on_chain";
    }
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = {
      ...order, status: "funded", updatedAt: now, version: order.version + 1,
      funding: { ...input, verificationStatus, fundedAt: now },
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
  }

  async markShipment(orderId: string, actor: Actor): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (order.supplierId !== actor.id) throw new DomainError("FORBIDDEN", "Only the supplier can mark shipment", 403);
    if (order.status !== "funded") throw new DomainError("INVALID_STATE", "The order must be funded before shipment");
    return this.saveStatus(order, "in_transit");
  }

  async markDelivered(orderId: string, actor: Actor): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (order.buyerId !== actor.id && order.supplierId !== actor.id) throw new DomainError("FORBIDDEN", "Only a trade party can record delivery", 403);
    if (order.status !== "in_transit") throw new DomainError("INVALID_STATE", "The order must be in transit before delivery");
    return this.saveStatus(order, "delivered");
  }

  async recordUndisputedRelease(orderId: string, actor: Actor, input: UndisputedReleaseInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (order.supplierId !== actor.id) throw new DomainError("FORBIDDEN", "Only the supplier can release the undisputed balance", 403);
    if (!order.funding || !order.disputeId) throw new DomainError("DISPUTE_REQUIRED", "A funded order with an open dispute is required", 409);
    if (order.undisputedRelease) throw new DomainError("ALREADY_RELEASED", "The undisputed balance has already been released", 409);
    const dispute = await this.disputes.get(order.disputeId);
    if (dispute.orderId !== order.id) throw new DomainError("DISPUTE_ORDER_MISMATCH", "The dispute is not bound to this order", 409);
    if (dispute.status === "settled") throw new DomainError("INVALID_STATE", "The dispute has already been settled", 409);
    if (!input.transactionDigest?.trim()) throw new DomainError("INVALID_RELEASE", "A release transaction digest is required", 400);
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyUndisputedRelease) {
      await this.fundingVerifier.verifyUndisputedRelease(order, dispute, input);
      verificationStatus = "verified_on_chain";
    }
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = {
      ...order,
      undisputedRelease: { transactionDigest: input.transactionDigest, verificationStatus, releasedAt: now },
      updatedAt: now,
      version: order.version + 1,
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
  }

  async openDispute(orderId: string, actor: Actor, input: OpenTradeDisputeInput) {
    const order = await this.getOrder(orderId, actor);
    if (order.buyerId !== actor.id) throw new DomainError("FORBIDDEN", "Only the buyer can open a dispute", 403);
    if (!order.supplierId || !order.funding) throw new DomainError("FUNDING_REQUIRED", "A funded order with a supplier is required before opening a dispute", 409);
    if (!["funded", "in_transit", "delivered"].includes(order.status)) throw new DomainError("INVALID_STATE", "This order cannot be disputed at its current stage");
    const dispute = await this.disputes.open({
      orderId: order.id, buyerId: order.buyerId, supplierId: order.supplierId, arbitratorId: order.arbitratorId,
      assetType: order.assetType, totalEscrowUnits: order.amountUnits, disputedUnits: input.disputedUnits,
      requestedBuyerUnits: input.requestedBuyerUnits, claim: input.claim, evidenceStatement: input.evidenceStatement,
      evidenceFiles: input.evidenceFiles, negotiationDeadline: input.negotiationDeadline, maxHumanRounds: input.maxHumanRounds,
      tradeTerms: {
        orderReference: order.reference, description: order.description,
        inspectionTerms: "Buyer records accepted, missing, and damaged quantities within the inspection window.",
        acceptanceTerms: "Only accepted quantity is releasable; disputed quantity remains held.",
        remedyTerms: "Buyer may request a refund up to the disputed amount.", governingLaw: "Malaysian law, Sale of Goods Act 1957 and Contracts Act 1950",
      },
      onchainEscrow: {
        packageId: order.funding.packageId, escrowObjectId: order.funding.escrowObjectId,
        fundingTransactionDigest: order.funding.transactionDigest, disputeTransactionDigest: input.disputeTransactionDigest,
        buyerAddress: order.funding.buyerAddress, supplierAddress: order.funding.supplierAddress,
        arbitratorAddress: order.funding.arbitratorAddress,
      },
    }, actor);
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = { ...order, disputeId: dispute.id, status: "dispute_open", updatedAt: now, version: order.version + 1 };
    await this.store.saveOrder(updated, order.version);
    return { order: updated, dispute };
  }

  async syncDispute(disputeId: string): Promise<TradeOrder | undefined> {
    const dispute = await this.disputes.get(disputeId);
    const order = await this.store.getOrder(dispute.orderId);
    if (!order) return undefined;
    const status: TradeOrderStatus = dispute.status === "supplier_review" ? "dispute_open"
      : dispute.status === "negotiation_open" ? "negotiation_open"
      : dispute.status === "arbitration_pending" ? "arbitration_pending"
      : dispute.status === "settlement_pending" ? "settlement_pending"
      : "settled";
    const next: TradeOrder = { ...order, status, updatedAt: this.ctx.now().toISOString(), version: order.version + 1 };
    if (dispute.settlement) next.settlement = { buyerUnits: dispute.settlement.buyerUnits, supplierUnits: dispute.settlement.supplierUnits, verifiedOnChain: dispute.settlement.executionStatus === "verified_on_chain", transactionDigest: dispute.settlement.execution?.transactionDigest, receiptObjectId: dispute.settlement.execution?.receiptObjectId };
    await this.store.saveOrder(next, order.version);
    return next;
  }

  private async saveStatus(order: TradeOrder, status: TradeOrderStatus): Promise<TradeOrder> {
    const next = { ...order, status, updatedAt: this.ctx.now().toISOString(), version: order.version + 1 };
    await this.store.saveOrder(next, order.version);
    return next;
  }
}

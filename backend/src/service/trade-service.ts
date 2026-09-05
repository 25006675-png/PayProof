import { createHash, randomBytes } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { DisputeService } from "./dispute-service.js";
import { DomainError, type Actor, type DomainContext, type EvidenceFile } from "../domain/types.js";
import type {
  AcceptDeliveryInput,
  DeadlineSettlementInput,
  FundingInput,
  ShipmentInput,
  TradeDocument,
  TradeDocumentKind,
  TradeInitiatorRole,
  TradeInspection,
  TradeInvitation,
  TradeInvite,
  TradeOrder,
  TradeOrderStatus,
  TradeOrderWithInvite,
  TradeLineItem,
  TradeReleasePlan,
} from "../domain/trade-types.js";
import type { TradeStore } from "../store/trade-store.js";
import { MemoryDocumentStore, type DocumentStore } from "../store/document-store.js";
import type { SuiFundingVerifier } from "../integrations/sui-funding.js";
import type { OrganizationService } from "./organization-service.js";
import { DisabledInvitationEmailSender, type InvitationEmailSender } from "../integrations/invitation-email.js";

/** Version of the platform terms a party accepts when confirming an order. */
export const TERMS_VERSION = "1.1";

export interface CreateTradeOrderInput {
  reference: string;
  /** Defaults to buyer. A supplier-initiated order invites the buyer to confirm. */
  initiatorRole?: TradeInitiatorRole;
  supplierEmail?: string;
  supplierName?: string;
  supplierOrganizationId?: string;
  buyerEmail?: string;
  buyerName?: string;
  supplierWalletAddress?: string;
  arbitratorWalletAddress?: string;
  arbitratorId: string;
  assetType: string;
  amountUnits: string;
  description: string;
  deliveryDate: string;
  deliveryLocation: string;
  lineItems: TradeLineItem[];
  releasePlan?: TradeReleasePlan;
  buyerOrganizationId?: string;
}

export interface AttachDocumentInput {
  kind: TradeDocumentKind;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  transcript?: string;
  extracted?: Record<string, unknown>;
  /** The anchor_evidence (or mark_shipped) transaction that carries this file's hash. */
  anchorTransactionDigest?: string;
}

const DOCUMENT_KINDS: TradeDocumentKind[] = ["internal_agreement", "purchase_order", "dispatch_evidence", "delivery_evidence", "inspection_evidence", "claim_evidence"];
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface AcceptInvitationInput {
  email?: string;
  name?: string;
  supplierWalletAddress?: string;
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
  inspection?: { lines: TradeInspection["lines"]; note?: string };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenHash(token: string): string {
  return sha256(token);
}

function canonicalOrderHash(input: CreateTradeOrderInput, initiatorId: string): string {
  return sha256(JSON.stringify({
    reference: input.reference.trim(), initiatorRole: input.initiatorRole ?? "buyer", initiatorId,
    buyerOrganizationId: input.buyerOrganizationId ?? null, buyerEmail: input.buyerEmail?.trim().toLowerCase() ?? null,
    supplierEmail: input.supplierEmail?.trim().toLowerCase() ?? null,
    supplierName: input.supplierName?.trim() ?? "", supplierWalletAddress: input.supplierWalletAddress, arbitratorWalletAddress: input.arbitratorWalletAddress, arbitratorId: input.arbitratorId,
    assetType: input.assetType, amountUnits: input.amountUnits, description: input.description.trim(),
    deliveryDate: input.deliveryDate, deliveryLocation: input.deliveryLocation.trim(), lineItems: input.lineItems,
    releasePlan: releasePlan(input),
  }));
}

function ensureEmail(value: string | undefined, party = "supplier"): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("INVALID_EMAIL", `A valid ${party} email is required`, 400);
  return email;
}

/** The side that still has to confirm, or undefined once both parties are on the order. */
function pendingSide(order: TradeOrder): TradeInitiatorRole | undefined {
  if (!order.buyerId) return "buyer";
  if (!order.supplierId) return "supplier";
  return undefined;
}

function pendingEmail(order: TradeOrder): string | undefined {
  const side = pendingSide(order);
  return side === "buyer" ? order.buyerEmail?.trim().toLowerCase() : side === "supplier" ? order.supplierEmail.trim().toLowerCase() : undefined;
}

function initiatorName(order: TradeOrder): string {
  return (order.initiatorRole === "supplier" ? order.supplierName : order.buyerName) || "A PayProof company";
}

function invitedName(order: TradeOrder): string {
  return (order.initiatorRole === "supplier" ? order.buyerName : order.supplierName) || "the invited company";
}

function ensureAmount(value: string): string {
  if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) <= 0n) {
    throw new DomainError("INVALID_ORDER_AMOUNT", "Order amount must be a positive integer in asset base units", 400);
  }
  return value;
}

function releasePlan(input: CreateTradeOrderInput): TradeReleasePlan {
  const total = BigInt(ensureAmount(input.amountUnits));
  const plan = input.releasePlan ?? { depositUnits: "0", dispatchUnits: "0", deliveryUnits: total.toString() };
  for (const value of [plan.depositUnits, plan.dispatchUnits, plan.deliveryUnits]) {
    if (!/^\d+$/.test(value)) throw new DomainError("INVALID_RELEASE_PLAN", "Release amounts must be non-negative integers in asset base units", 400);
  }
  if (BigInt(plan.depositUnits) + BigInt(plan.dispatchUnits) + BigInt(plan.deliveryUnits) !== total) {
    throw new DomainError("INVALID_RELEASE_PLAN", "Deposit, dispatch, and delivery releases must equal the order amount", 400);
  }
  return structuredClone(plan);
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
    private readonly organizations?: OrganizationService,
    private readonly invitationEmail: InvitationEmailSender = new DisabledInvitationEmailSender(),
    private readonly documents: DocumentStore = new MemoryDocumentStore(),
  ) {}

  /** Attach a file to the order. Either party (or the invited party) can attach; both can read. */
  async attachDocument(orderId: string, actor: Actor, input: AttachDocumentInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (!DOCUMENT_KINDS.includes(input.kind)) throw new DomainError("INVALID_DOCUMENT", "Unknown document kind", 400);
    if (!input.name.trim()) throw new DomainError("INVALID_DOCUMENT", "A file name is required", 400);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DomainError("INVALID_DOCUMENT", "The file must be between 1 byte and 8 MB", 400);
    const role: TradeInitiatorRole = order.buyerId === actor.id || (order.buyerOrganizationId && await this.hasCapability(actor, "buy", order.buyerOrganizationId))
      ? "buyer"
      : order.supplierId === actor.id || (order.supplierOrganizationId && await this.hasCapability(actor, "supply", order.supplierOrganizationId))
        ? "supplier"
        : pendingSide(order) ?? "supplier";
    // Hash the raw bytes so the record matches what the browser hashed and anchored on Sui.
    const fileHash = createHash("sha256").update(input.bytes).digest("hex");
    let anchor: TradeDocument["anchor"];
    const anchorDigest = input.anchorTransactionDigest?.trim();
    if (anchorDigest) {
      if (!order.funding) throw new DomainError("FUNDING_REQUIRED", "Evidence can only be anchored to a funded order", 409);
      let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
      if (this.fundingVerifier?.verifyEvidenceAnchor) {
        await this.fundingVerifier.verifyEvidenceAnchor(order, anchorDigest, fileHash);
        verificationStatus = "verified_on_chain";
      }
      anchor = { transactionDigest: anchorDigest, verificationStatus };
    }
    const id = this.ctx.id();
    const storagePath = `orders/${order.id}/${id}`;
    await this.documents.put(storagePath, input.bytes, input.mimeType || "application/octet-stream");
    const now = this.ctx.now().toISOString();
    const document: TradeDocument = {
      id, kind: input.kind, name: input.name.trim().slice(0, 256), mimeType: input.mimeType || "application/octet-stream", sizeBytes: input.bytes.byteLength,
      sha256: fileHash, storagePath, uploadedBy: actor.id, uploadedRole: role, uploadedAt: now, anchor,
      transcript: input.transcript?.trim().slice(0, 50_000) || undefined, extracted: input.extracted,
    };
    // Re-read so a concurrent update (for example the claim that references this file) is not lost.
    const fresh = await this.store.getOrder(order.id);
    if (!fresh) throw new DomainError("NOT_FOUND", "Trade order not found", 404);
    const updated: TradeOrder = { ...fresh, documents: [...(fresh.documents ?? []), document], updatedAt: now, version: fresh.version + 1 };
    await this.store.saveOrder(updated, fresh.version);
    return updated;
  }

  async readDocument(orderId: string, actor: Actor, documentId: string): Promise<{ document: TradeDocument; bytes: Uint8Array; mimeType: string }> {
    const order = await this.getOrder(orderId, actor);
    const document = order.documents?.find((candidate) => candidate.id === documentId);
    if (!document) throw new DomainError("NOT_FOUND", "Document not found", 404);
    const file = await this.documents.get(document.storagePath);
    if (!file) throw new DomainError("NOT_FOUND", "The document file is no longer available", 404);
    return { document, bytes: file.bytes, mimeType: file.mimeType || document.mimeType };
  }

  /** Bind an already-stored document to a verified Sui transaction. This lets irreversible
   * release flows persist evidence before asking the supplier to sign. */
  async anchorDocument(orderId: string, actor: Actor, documentId: string, transactionDigest: string): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    const document = order.documents?.find((candidate) => candidate.id === documentId);
    if (!document) throw new DomainError("NOT_FOUND", "Document not found", 404);
    if (!order.funding) throw new DomainError("FUNDING_REQUIRED", "Evidence can only be anchored to a funded order", 409);
    const digest = transactionDigest.trim();
    if (!digest) throw new DomainError("INVALID_DOCUMENT", "An anchor transaction digest is required", 400);
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyEvidenceAnchor) {
      await this.fundingVerifier.verifyEvidenceAnchor(order, digest, document.sha256);
      verificationStatus = "verified_on_chain";
    }
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = {
      ...order,
      documents: order.documents!.map((candidate) => candidate.id === documentId
        ? { ...candidate, anchor: { transactionDigest: digest, verificationStatus } }
        : candidate),
      updatedAt: now,
      version: order.version + 1,
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
  }

  private async hasCapability(actor: Actor, capability: "buy" | "supply", organizationId: string): Promise<boolean> {
    if (!this.organizations) return false;
    try { await this.organizations.requireCapability(actor, capability, organizationId); return true; } catch { return false; }
  }

  async createOrder(input: CreateTradeOrderInput, actor: Actor): Promise<TradeOrder> {
    if (!input.reference.trim() || !input.description.trim() || !input.deliveryDate.trim() || !input.deliveryLocation.trim()) {
      throw new DomainError("INVALID_ORDER", "Reference, description, delivery date, and location are required", 400);
    }
    if (actor.id === input.arbitratorId) throw new DomainError("INVALID_PARTIES", "The initiating party and the arbitrator must be different", 400);
    const initiatorRole: TradeInitiatorRole = input.initiatorRole ?? "buyer";
    const now = this.ctx.now().toISOString();
    const shared = {
      id: this.ctx.id(), reference: input.reference.trim(), initiatorRole,
      arbitratorWalletAddress: input.arbitratorWalletAddress?.trim(),
      arbitratorId: input.arbitratorId, assetType: input.assetType.trim(), amountUnits: ensureAmount(input.amountUnits),
      orderHash: canonicalOrderHash(input, actor.id), description: input.description.trim(),
      deliveryDate: input.deliveryDate.trim(), deliveryLocation: input.deliveryLocation.trim(),
      lineItems: structuredClone(input.lineItems), releasePlan: releasePlan(input), version: 0, createdAt: now, updatedAt: now,
    };
    let order: TradeOrder;
    if (initiatorRole === "supplier") {
      const supplierMembership = this.organizations
        ? await this.organizations.requireCapability(actor, "supply", input.supplierOrganizationId)
        : undefined;
      const buyerEmail = ensureEmail(input.buyerEmail, "buyer");
      if (actor.email && buyerEmail === actor.email.trim().toLowerCase()) throw new DomainError("INVALID_PARTIES", "The buyer email must belong to another company", 400);
      order = {
        ...shared, status: "awaiting_buyer",
        supplierId: actor.id, supplierOrganizationId: supplierMembership?.organizationId,
        supplierEmail: actor.email?.trim().toLowerCase() ?? ensureEmail(input.supplierEmail),
        supplierName: supplierMembership?.organizationName ?? input.supplierName?.trim() ?? actor.name ?? "Supplier",
        supplierWalletAddress: input.supplierWalletAddress?.trim(),
        buyerEmail, buyerName: input.buyerName?.trim() || buyerEmail,
      };
    } else {
      const buyerMembership = this.organizations
        ? await this.organizations.requireCapability(actor, "buy", input.buyerOrganizationId)
        : undefined;
      const supplierEmail = ensureEmail(input.supplierEmail);
      if (actor.email && supplierEmail === actor.email.trim().toLowerCase()) throw new DomainError("INVALID_PARTIES", "The supplier email must belong to another company", 400);
      order = {
        ...shared, status: "awaiting_supplier",
        buyerId: actor.id, buyerOrganizationId: buyerMembership?.organizationId,
        buyerEmail: actor.email, buyerName: buyerMembership?.organizationName ?? actor.name,
        supplierEmail, supplierName: input.supplierName?.trim() || supplierEmail,
        supplierWalletAddress: input.supplierWalletAddress?.trim(),
      };
    }
    await this.store.createOrder(order);
    return structuredClone(order);
  }

  async listOrders(actor: Actor): Promise<TradeOrder[]> {
    const organizationIds = this.organizations
      ? (await this.organizations.workspace(actor)).organizations.map((item) => item.organizationId)
      : [];
    return this.store.listOrders(actor.id, organizationIds);
  }

  async getOrder(id: string, actor: Actor): Promise<TradeOrder> {
    const order = await this.store.getOrder(id);
    if (!order) throw new DomainError("NOT_FOUND", "Trade order not found", 404);
    const organizationIds = this.organizations
      ? (await this.organizations.workspace(actor)).organizations.map((item) => item.organizationId)
      : [];
    if (!allowed(order, actor) && !organizationIds.includes(order.buyerOrganizationId ?? "") && !organizationIds.includes(order.supplierOrganizationId ?? "")) {
      // An invited supplier reads the order before accepting, with or without
      // the emailed token: their verified email is what the invitation binds.
      if (!(await this.pendingInviteFor(order, actor)))
        throw new DomainError("FORBIDDEN", "Actor cannot access this trade order", 403);
    }
    return order;
  }

  /** Pending invitations addressed to the actor's verified email. */
  async listInvitations(actor: Actor): Promise<TradeInvitation[]> {
    const email = actor.email?.trim().toLowerCase();
    if (!email) return [];
    const invites = await this.store.listPendingInvitesByEmail(email, this.ctx.now().toISOString());
    const invitations: TradeInvitation[] = [];
    const seenOrders = new Set<string>();
    for (const invite of invites) {
      if (seenOrders.has(invite.orderId)) continue;
      seenOrders.add(invite.orderId);
      const order = await this.store.getOrder(invite.orderId);
      if (!order) continue;
      const side = pendingSide(order);
      if (!side || !["awaiting_supplier", "awaiting_buyer"].includes(order.status)) continue;
      invitations.push({
        orderId: order.id, reference: order.reference, buyerName: initiatorName(order), counterpartyName: initiatorName(order), invitedRole: side,
        invitedEmail: invite.invitedEmail, assetType: order.assetType, amountUnits: order.amountUnits,
        deliveryDate: order.deliveryDate, invitedAt: invite.createdAt, expiresAt: invite.expiresAt,
      });
    }
    return invitations;
  }

  async createInvite(orderId: string, actor: Actor): Promise<TradeOrderWithInvite> {
    const order = await this.getOrder(orderId, actor);
    await this.requireInitiatorAuthority(order, actor, "Only the company that issued the order can send an invitation");
    const invitedEmail = pendingEmail(order);
    if (!invitedEmail || !["awaiting_supplier", "awaiting_buyer"].includes(order.status)) throw new DomainError("INVALID_STATE", "This order is no longer waiting for confirmation");
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
      id: this.ctx.id(), orderId, tokenHash: tokenHash(rawToken), invitedEmail,
      expiresAt, createdAt: now.toISOString(),
    };
    await this.store.createInvite(invite);
    const updated: TradeOrder = { ...order, inviteId: invite.id, inviteExpiresAt: expiresAt, updatedAt: now.toISOString(), version: order.version + 1 };
    await this.store.saveOrder(updated, order.version);
    const result = structuredClone(updated) as TradeOrderWithInvite;
    result.inviteToken = rawToken;
    result.inviteUrl = `${this.inviteBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(order.id)}?invite=${encodeURIComponent(rawToken)}`;
    const delivery = await this.invitationEmail.send({
      invitationId: invite.id, to: invite.invitedEmail, orderReference: order.reference,
      buyerName: initiatorName(order), supplierName: invitedName(order),
      reviewUrl: result.inviteUrl, expiresAt,
    });
    await this.store.saveInvite({
      ...invite, deliveryStatus: delivery.status, deliveryMessageId: delivery.messageId,
      deliveryAttemptedAt: delivery.attemptedAt,
    });
    result.inviteDelivery = delivery;
    return result;
  }

  async acceptInvite(rawToken: string, actor: Actor, input: AcceptInvitationInput = {}): Promise<TradeOrder> {
    if (!rawToken.trim()) throw new DomainError("INVALID_INVITE", "Invitation token is required", 400);
    const invite = await this.store.getInviteByTokenHash(tokenHash(rawToken.trim()));
    if (!invite) throw new DomainError("INVALID_INVITE", "This invitation is invalid or has expired", 404);
    return this.acceptWithInvite(invite, actor, input, true);
  }

  /** Accept from the workspace, where the verified email stands in for the emailed token. */
  async acceptInvitation(orderId: string, actor: Actor, input: AcceptInvitationInput = {}): Promise<TradeOrder> {
    const invite = await this.store.getInviteByOrderId(orderId);
    if (!invite) throw new DomainError("INVALID_INVITE", "This order has no invitation to accept", 404);
    return this.acceptWithInvite(invite, actor, input, false);
  }

  async cancelInvite(orderId: string, actor: Actor): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    await this.requireInitiatorAuthority(order, actor, "Only the company that issued the order can cancel an invitation");
    if (!["awaiting_supplier", "awaiting_buyer"].includes(order.status)) throw new DomainError("INVALID_STATE", "This order is no longer waiting for confirmation");
    const invite = await this.store.getInviteByOrderId(orderId);
    const now = this.ctx.now();
    if (!invite || invite.acceptedBy || new Date(invite.expiresAt).getTime() <= now.getTime())
      throw new DomainError("NO_PENDING_INVITATION", "There is no pending invitation to cancel", 409);
    await this.store.saveInvite({ ...invite, expiresAt: now.toISOString() });
    const updated: TradeOrder = {
      ...order, inviteId: undefined, inviteExpiresAt: undefined,
      updatedAt: now.toISOString(), version: order.version + 1,
    };
    await this.store.saveOrder(updated, order.version);
    return structuredClone(updated);
  }

  private async acceptWithInvite(invite: TradeInvite, actor: Actor, input: AcceptInvitationInput, tokenPresented: boolean): Promise<TradeOrder> {
    if (new Date(invite.expiresAt).getTime() <= this.ctx.now().getTime()) throw new DomainError("INVITE_EXPIRED", "This invitation has expired", 410);
    const order = await this.store.getOrder(invite.orderId);
    if (!order) throw new DomainError("NOT_FOUND", "The invited order no longer exists", 404);
    const side = pendingSide(order) ?? (order.initiatorRole === "supplier" ? "buyer" : "supplier");
    const acceptedId = side === "buyer" ? order.buyerId : order.supplierId;
    if (acceptedId && acceptedId !== actor.id) throw new DomainError("INVITE_ALREADY_ACCEPTED", "This order has already been accepted by another company", 409);
    if (invite.acceptedBy && invite.acceptedBy !== actor.id) throw new DomainError("INVITE_ALREADY_ACCEPTED", "This invitation has already been accepted", 409);
    const initiatorId = side === "buyer" ? order.supplierId : order.buyerId;
    if (actor.id === initiatorId || actor.id === order.arbitratorId) throw new DomainError("INVALID_PARTY", "The issuing company and the arbitrator cannot confirm the order", 400);
    const verifiedEmail = actor.email?.trim().toLowerCase();
    const submittedEmail = input.email?.trim().toLowerCase();
    if (verifiedEmail && submittedEmail && verifiedEmail !== submittedEmail) throw new DomainError("INVITE_EMAIL_MISMATCH", "The submitted supplier email does not match the authenticated account", 403);
    // Without the emailed token, nothing but a verified email proves the actor
    // is the invited party, so a self-declared address cannot stand in for one.
    const candidateEmail = verifiedEmail ?? (tokenPresented ? submittedEmail : undefined);
    if (!candidateEmail) throw new DomainError("INVITE_EMAIL_REQUIRED", "A verified supplier email is required to accept this invitation", 403);
    if (candidateEmail !== invite.invitedEmail) throw new DomainError("INVITE_EMAIL_MISMATCH", "This invitation was issued to a different supplier account", 403);
    const membership = this.organizations
      ? await this.organizations.requireCapability(actor, side === "buyer" ? "buy" : "supply")
      : undefined;
    const now = this.ctx.now().toISOString();
    const confirmation = {
      confirmedBy: actor.id, confirmedRole: side, email: candidateEmail, organizationName: membership?.organizationName ?? input.name ?? actor.name,
      orderVersion: order.version, termsVersion: TERMS_VERSION, confirmedAt: now,
    };
    let updated: TradeOrder;
    if (side === "buyer") {
      updated = {
        ...order, buyerId: actor.id, buyerOrganizationId: membership?.organizationId,
        buyerEmail: ensureEmail(input.email ?? actor.email ?? order.buyerEmail, "buyer"),
        buyerName: (membership?.organizationName ?? input.name ?? actor.name ?? order.buyerName ?? "Buyer").trim(),
        status: "supplier_confirmed", confirmation, updatedAt: now, version: order.version + 1,
      };
    } else {
      if (order.supplierWalletAddress && input.supplierWalletAddress && !sameAddress(order.supplierWalletAddress, input.supplierWalletAddress)) throw new DomainError("SUPPLIER_WALLET_MISMATCH", "The supplier wallet does not match the wallet recorded on the order", 409);
      updated = {
        ...order, supplierId: actor.id, supplierOrganizationId: membership?.organizationId,
        supplierEmail: ensureEmail(input.email ?? actor.email ?? order.supplierEmail),
        supplierName: (membership?.organizationName ?? input.name ?? actor.name ?? order.supplierName).trim(), supplierWalletAddress: order.supplierWalletAddress ?? input.supplierWalletAddress?.trim(), status: "supplier_confirmed",
        confirmation, updatedAt: now, version: order.version + 1,
      };
    }
    await this.store.saveOrder(updated, order.version);
    await this.store.saveInvite({ ...invite, acceptedBy: actor.id, acceptedAt: now });
    return updated;
  }

  async previewInvite(rawToken: string, actor: Actor): Promise<TradeOrder> {
    if (!rawToken.trim()) throw new DomainError("INVALID_INVITE", "Invitation token is required", 400);
    const invite = await this.store.getInviteByTokenHash(tokenHash(rawToken.trim()));
    if (!invite) throw new DomainError("INVALID_INVITE", "This invitation is invalid or has expired", 404);
    if (new Date(invite.expiresAt).getTime() <= this.ctx.now().getTime()) throw new DomainError("INVITE_EXPIRED", "This invitation has expired", 410);
    const verifiedEmail = actor.email?.trim().toLowerCase();
    if (!verifiedEmail || verifiedEmail !== invite.invitedEmail) throw new DomainError("INVITE_EMAIL_MISMATCH", "Sign in with the supplier email that received this invitation", 403);
    const order = await this.store.getOrder(invite.orderId);
    if (!order) throw new DomainError("NOT_FOUND", "The invited order no longer exists", 404);
    const side = pendingSide(order) ?? (order.initiatorRole === "supplier" ? "buyer" : "supplier");
    const acceptedId = side === "buyer" ? order.buyerId : order.supplierId;
    if (acceptedId && acceptedId !== actor.id) throw new DomainError("INVITE_ALREADY_ACCEPTED", "This order has already been accepted by another company", 409);
    return structuredClone(order);
  }

  async recordFunding(orderId: string, actor: Actor, input: FundingInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    await this.requireBuyerAuthority(order, actor, "Only an authorized buyer can fund an order");
    if (!order.supplierId || !order.buyerId) throw new DomainError("SUPPLIER_REQUIRED", "Both parties must confirm the order before funding", 409);
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
    let deadlines = { deliveryDeadlineMs: input.deliveryDeadlineMs, inspectionWindowMs: input.inspectionWindowMs };
    if (this.fundingVerifier) {
      const verified = await this.fundingVerifier.verify(order, input);
      verificationStatus = "verified_on_chain";
      // The escrow's own deadlines win over anything the client sent.
      deadlines = { deliveryDeadlineMs: verified.deliveryDeadlineMs ?? input.deliveryDeadlineMs, inspectionWindowMs: verified.inspectionWindowMs ?? input.inspectionWindowMs };
    }
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = {
      ...order, status: "funded", updatedAt: now, version: order.version + 1,
      funding: { ...input, ...deadlines, verificationStatus, fundedAt: now },
      releaseRecords: BigInt(order.releasePlan?.depositUnits ?? "0") > 0n ? [{
        stage: "deposit", amountUnits: order.releasePlan!.depositUnits,
        transactionDigest: input.transactionDigest, verificationStatus, releasedAt: now,
      }] : [],
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
  }

  async markShipment(orderId: string, actor: Actor, input: ShipmentInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    await this.requireSupplierAuthority(order, actor, "Only an authorized supplier can mark shipment");
    if (order.status !== "funded") throw new DomainError("INVALID_STATE", "The order must be funded before shipment");
    const now = this.ctx.now().toISOString();
    if (!order.funding) throw new DomainError("FUNDING_REQUIRED", "Shipment can only be signed against a funded escrow", 409);
    const transactionDigest = input.transactionDigest.trim();
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyShipment) {
      await this.fundingVerifier.verifyShipment(order, transactionDigest, input.evidenceSha256);
      verificationStatus = "verified_on_chain";
    }
    const dispatchUnits = order.releasePlan?.dispatchUnits ?? "0";
    const shipment = {
      carrier: input.carrier.trim(), trackingNumber: input.trackingNumber.trim(), dispatchedAt: input.dispatchedAt.trim(),
      expectedAt: input.expectedAt?.trim() || undefined, recordedBy: actor.id, transactionDigest, verificationStatus,
    };
    const releaseRecords = [...(order.releaseRecords ?? [])];
    releaseRecords.push({ stage: "dispatch", amountUnits: dispatchUnits,
      transactionDigest, verificationStatus, releasedAt: now, evidenceSha256: input.evidenceSha256 });
    const next: TradeOrder = { ...order, status: "in_transit", shipment, releaseRecords, updatedAt: now, version: order.version + 1 };
    await this.store.saveOrder(next, order.version);
    return next;
  }

  async markDelivered(orderId: string, actor: Actor, input?: { reference?: string }): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    const memberships = this.organizations ? (await this.organizations.workspace(actor)).organizations : [];
    const isParty = order.buyerId === actor.id || order.supplierId === actor.id
      || memberships.some((item) => item.organizationId === order.buyerOrganizationId || item.organizationId === order.supplierOrganizationId);
    if (!isParty) throw new DomainError("FORBIDDEN", "Only a trade party can record delivery", 403);
    if (order.status !== "in_transit") throw new DomainError("INVALID_STATE", "The order must be in transit before delivery");
    const now = this.ctx.now().toISOString();
    const next: TradeOrder = { ...order, status: "delivered", deliveryRecord: { reference: input?.reference?.trim() || undefined, recordedBy: actor.id, recordedAt: now }, updatedAt: now, version: order.version + 1 };
    await this.store.saveOrder(next, order.version);
    return next;
  }

  /**
   * A deadline path closed the escrow without the counterparty: the buyer reclaimed an order the
   * supplier never shipped, or the supplier claimed a delivery the buyer never inspected. The
   * contract enforces the deadline; this records the receipt against the order.
   */
  async settleByDeadline(orderId: string, actor: Actor, input: DeadlineSettlementInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    if (!order.funding || !order.supplierId || !order.buyerId) throw new DomainError("FUNDING_REQUIRED", "Only a funded order can be settled by deadline", 409);
    if (!input.transactionDigest?.trim()) throw new DomainError("INVALID_RELEASE", "A settlement transaction digest is required", 400);
    const refund = input.kind === "refund_unshipped";
    const nowMs = this.ctx.now().getTime();
    if (refund) {
      await this.requireBuyerAuthority(order, actor, "Only an authorized buyer can reclaim an unshipped order");
      if (order.status !== "funded" || order.shipment?.transactionDigest) throw new DomainError("INVALID_STATE", "Only a funded order that has not been shipped can be reclaimed");
      if (order.funding.deliveryDeadlineMs !== undefined && nowMs <= order.funding.deliveryDeadlineMs) throw new DomainError("DEADLINE_NOT_REACHED", "The delivery deadline has not passed yet", 409);
    } else {
      await this.requireSupplierAuthority(order, actor, "Only an authorized supplier can claim an uninspected delivery");
      if (!["in_transit", "delivered"].includes(order.status)) throw new DomainError("INVALID_STATE", "Only a shipped order awaiting inspection can be claimed");
      const { deliveryDeadlineMs, inspectionWindowMs } = order.funding;
      if (deliveryDeadlineMs !== undefined && inspectionWindowMs !== undefined) {
        const shippedAt = order.shipment ? new Date(order.shipment.dispatchedAt).getTime() : 0;
        const closesAt = Math.max(deliveryDeadlineMs, Number.isFinite(shippedAt) ? shippedAt : 0) + inspectionWindowMs;
        if (nowMs <= closesAt) throw new DomainError("DEADLINE_NOT_REACHED", "The inspection window has not closed yet", 409);
      }
    }
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyDeadlineSettlement) {
      await this.fundingVerifier.verifyDeadlineSettlement(order, input);
      verificationStatus = "verified_on_chain";
    }
    const now = this.ctx.now().toISOString();
    const depositUnits = BigInt(order.releasePlan?.depositUnits ?? "0");
    const deliveryUnits = BigInt(order.releasePlan?.deliveryUnits ?? order.amountUnits);
    const remainingUnits = refund ? BigInt(order.amountUnits) - depositUnits : deliveryUnits;
    const updated: TradeOrder = {
      ...order, status: "settled", updatedAt: now, version: order.version + 1,
      settlement: {
        buyerUnits: refund ? remainingUnits.toString() : "0", supplierUnits: refund ? depositUnits.toString() : order.amountUnits,
        transactionDigest: input.transactionDigest.trim(), receiptObjectId: input.receiptObjectId?.trim(),
        verifiedOnChain: verificationStatus === "verified_on_chain", source: input.kind,
      },
      // A reclaim returns the balance to the buyer, so only the claim path releases a further
      // tranche to the supplier. Recording it keeps the release trail complete either way.
      releaseRecords: refund ? order.releaseRecords ?? [] : [...(order.releaseRecords ?? []), {
        stage: "delivery", amountUnits: deliveryUnits.toString(),
        transactionDigest: input.transactionDigest.trim(), verificationStatus, releasedAt: now,
      }],
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
  }

  async openDispute(orderId: string, actor: Actor, input: OpenTradeDisputeInput) {
    const order = await this.getOrder(orderId, actor);
    await this.requireBuyerAuthority(order, actor, "Only an authorized buyer can open a dispute");
    if (!order.supplierId || !order.buyerId || !order.funding) throw new DomainError("FUNDING_REQUIRED", "A funded order with a supplier is required before opening a dispute", 409);
    const allowedStates = order.releasePlan ? ["delivered"] : ["funded", "in_transit", "delivered"];
    if (!allowedStates.includes(order.status)) throw new DomainError("INVALID_STATE", "This order cannot be disputed at its current stage");
    // The claim transaction pays the undisputed value to the supplier itself, so the release is
    // recorded here rather than as a separate supplier step.
    let releaseStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyDisputeOpened) {
      await this.fundingVerifier.verifyDisputeOpened(order, { disputeTransactionDigest: input.disputeTransactionDigest, disputedUnits: input.disputedUnits, requestedBuyerUnits: input.requestedBuyerUnits });
      releaseStatus = "verified_on_chain";
    }
    const dispute = await this.disputes.open({
      orderId: order.id, buyerId: order.buyerId, supplierId: order.supplierId, arbitratorId: order.arbitratorId,
      assetType: order.assetType, totalEscrowUnits: order.releasePlan?.deliveryUnits ?? order.amountUnits, disputedUnits: input.disputedUnits,
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
    // open_dispute pays the supplier everything it is not being asked to give back, in the same
    // transaction. Only the disputed amount stays in escrow for the settlement to split.
    const undisputedUnits = BigInt(order.releasePlan?.deliveryUnits ?? order.amountUnits) - BigInt(input.disputedUnits);
    const updated: TradeOrder = {
      ...order, disputeId: dispute.id, status: "dispute_open", updatedAt: now, version: order.version + 1,
      inspection: input.inspection ? { lines: structuredClone(input.inspection.lines), note: input.inspection.note?.trim(), recordedBy: actor.id, recordedAt: now } : order.inspection,
      undisputedRelease: { transactionDigest: input.disputeTransactionDigest, verificationStatus: releaseStatus, releasedAt: now },
      releaseRecords: undisputedUnits > 0n ? [...(order.releaseRecords ?? []), {
        stage: "undisputed", amountUnits: undisputedUnits.toString(),
        transactionDigest: input.disputeTransactionDigest, verificationStatus: releaseStatus, releasedAt: now,
      }] : order.releaseRecords,
    };
    await this.store.saveOrder(updated, order.version);
    return { order: updated, dispute };
  }

  /**
   * The buyer accepted the whole delivery. The escrow contract's release_full
   * pays the supplier in one transaction; this records the inspection counts
   * and the settlement against that transaction.
   */
  async acceptDelivery(orderId: string, actor: Actor, input: AcceptDeliveryInput): Promise<TradeOrder> {
    const order = await this.getOrder(orderId, actor);
    await this.requireBuyerAuthority(order, actor, "Only an authorized buyer can accept a delivery");
    if (!order.funding || !order.supplierId) throw new DomainError("FUNDING_REQUIRED", "Only a funded order can be accepted", 409);
    if (order.status !== "delivered") throw new DomainError("INVALID_STATE", "The delivery must be recorded before it can be accepted");
    if (!input.transactionDigest?.trim()) throw new DomainError("INVALID_RELEASE", "A release transaction digest is required", 400);
    if (input.inspection) {
      for (const line of input.inspection.lines) {
        const item = order.lineItems.find((candidate) => candidate.id === line.lineId);
        if (!item) throw new DomainError("INVALID_INSPECTION", `Unknown order line ${line.lineId}`, 400);
        if (BigInt(line.accepted) !== BigInt(item.quantity) || BigInt(line.missing) !== 0n || BigInt(line.damaged) !== 0n) {
          throw new DomainError("INVALID_INSPECTION", "Full acceptance requires every line to be accepted in full. Open a claim for exceptions.", 400);
        }
      }
    }
    let verificationStatus: "verified_on_chain" | "external_reference" = "external_reference";
    if (this.fundingVerifier?.verifyFullRelease) {
      await this.fundingVerifier.verifyFullRelease(order, input);
      verificationStatus = "verified_on_chain";
    }
    const now = this.ctx.now().toISOString();
    const updated: TradeOrder = {
      ...order, status: "settled", updatedAt: now, version: order.version + 1,
      inspection: {
        lines: input.inspection ? structuredClone(input.inspection.lines) : order.lineItems.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: "0", damaged: "0" })),
        note: input.inspection?.note?.trim(), recordedBy: actor.id, recordedAt: now,
      },
      settlement: {
        buyerUnits: "0", supplierUnits: order.amountUnits, transactionDigest: input.transactionDigest.trim(),
        receiptObjectId: input.receiptObjectId?.trim(), verifiedOnChain: verificationStatus === "verified_on_chain", source: "full_acceptance",
      },
      releaseRecords: [...(order.releaseRecords ?? []), {
        stage: "delivery", amountUnits: order.releasePlan?.deliveryUnits ?? order.amountUnits,
        transactionDigest: input.transactionDigest.trim(), verificationStatus, releasedAt: now,
      }],
    };
    await this.store.saveOrder(updated, order.version);
    return updated;
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
    if (dispute.settlement) {
      next.settlement = { buyerUnits: dispute.settlement.buyerUnits,
        supplierUnits: (BigInt(order.amountUnits) - BigInt(dispute.settlement.buyerUnits)).toString(),
        verifiedOnChain: dispute.settlement.executionStatus === "verified_on_chain", transactionDigest: dispute.settlement.execution?.transactionDigest,
        receiptObjectId: dispute.settlement.execution?.receiptObjectId, source: "dispute" };
      // The undisputed value was already released when the claim opened, so the settlement only
      // pays the supplier its share of the amount that stayed in escrow.
      if (dispute.settlement.executionStatus === "verified_on_chain" && dispute.settlement.execution?.transactionDigest
        && !(next.releaseRecords ?? []).some((record) => record.stage === "delivery")) {
        const supplierShare = BigInt(dispute.disputedUnits) - BigInt(dispute.settlement.buyerUnits);
        if (supplierShare > 0n) {
          next.releaseRecords = [...(next.releaseRecords ?? []), { stage: "delivery", amountUnits: supplierShare.toString(),
            transactionDigest: dispute.settlement.execution.transactionDigest,
            verificationStatus: "verified_on_chain", releasedAt: this.ctx.now().toISOString() }];
        }
      }
    }
    await this.store.saveOrder(next, order.version);
    return next;
  }

  private async saveStatus(order: TradeOrder, status: TradeOrderStatus): Promise<TradeOrder> {
    const next = { ...order, status, updatedAt: this.ctx.now().toISOString(), version: order.version + 1 };
    await this.store.saveOrder(next, order.version);
    return next;
  }

  private async pendingInviteFor(order: TradeOrder, actor: Actor): Promise<TradeInvite | undefined> {
    const email = actor.email?.trim().toLowerCase();
    if (!email || !pendingSide(order)) return undefined;
    const invite = await this.store.getInviteByOrderId(order.id);
    if (!invite || invite.acceptedBy || invite.invitedEmail !== email) return undefined;
    return new Date(invite.expiresAt).getTime() > this.ctx.now().getTime() ? invite : undefined;
  }

  private async requireInitiatorAuthority(order: TradeOrder, actor: Actor, message: string): Promise<void> {
    return order.initiatorRole === "supplier"
      ? this.requireSupplierAuthority(order, actor, message)
      : this.requireBuyerAuthority(order, actor, message);
  }

  private async requireBuyerAuthority(order: TradeOrder, actor: Actor, message: string): Promise<void> {
    if (order.buyerId && order.buyerId === actor.id) return;
    if (this.organizations && order.buyerOrganizationId) {
      await this.organizations.requireCapability(actor, "buy", order.buyerOrganizationId);
      return;
    }
    throw new DomainError("FORBIDDEN", message, 403);
  }

  private async requireSupplierAuthority(order: TradeOrder, actor: Actor, message: string): Promise<void> {
    if (order.supplierId === actor.id) return;
    if (this.organizations && order.supplierOrganizationId) {
      await this.organizations.requireCapability(actor, "supply", order.supplierOrganizationId);
      return;
    }
    throw new DomainError("FORBIDDEN", message, 403);
  }
}

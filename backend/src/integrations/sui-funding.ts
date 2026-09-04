import { SuiGrpcClient } from "@mysten/sui/grpc";
import { isValidStructTag, isValidSuiAddress, isValidSuiObjectId, isValidTransactionDigest, normalizeStructTag, normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";
import { DomainError } from "../domain/types.js";
import type { AcceptDeliveryInput, DeadlineSettlementInput, FundingInput, TradeOrder } from "../domain/trade-types.js";

export interface SuiFundingReader {
  getTransaction(input: { digest: string; include: Record<string, boolean> }): Promise<any>;
}

export interface DisputeOpenedInput {
  disputeTransactionDigest: string;
  disputedUnits: string;
  requestedBuyerUnits: string;
}

export interface FundingVerification {
  checkpoint?: string;
  deliveryDeadlineMs?: number;
  inspectionWindowMs?: number;
}

/** Receipt approval modes written by the escrow contract. */
const MODE_REFUND_UNSHIPPED = 3;
const MODE_CLAIM_UNINSPECTED = 4;

export interface SuiFundingVerifier {
  verify(order: TradeOrder, funding: FundingInput): Promise<FundingVerification>;
  /** Confirms the supplier's mark_shipped transaction on the order's escrow. */
  verifyShipment?(order: TradeOrder, transactionDigest: string): Promise<{ checkpoint?: string }>;
  /** Confirms an anchor_evidence transaction carrying exactly this file hash. */
  verifyEvidenceAnchor?(order: TradeOrder, transactionDigest: string, sha256Hex: string): Promise<{ checkpoint?: string }>;
  /** Confirms the buyer's open_dispute transaction, including the undisputed value it paid out. */
  verifyDisputeOpened?(order: TradeOrder, input: DisputeOpenedInput): Promise<{ checkpoint?: string; undisputedUnits: string }>;
  /** Confirms a release_full transaction paid the whole escrow to the supplier. */
  verifyFullRelease?(order: TradeOrder, acceptance: AcceptDeliveryInput): Promise<{ checkpoint?: string }>;
  /** Confirms a refund_unshipped or claim_uninspected transaction closed the escrow. */
  verifyDeadlineSettlement?(order: TradeOrder, input: DeadlineSettlementInput): Promise<{ checkpoint?: string }>;
}

function fail(message: string, status = 422): never {
  throw new DomainError("SUI_FUNDING_VERIFICATION_FAILED", message, status);
}

function objectId(value: string, field: string): string {
  if (!isValidSuiObjectId(value)) fail(`${field} is not a valid Sui object ID`, 400);
  return normalizeSuiObjectId(value);
}

function address(value: string, field: string): string {
  if (!isValidSuiAddress(value)) fail(`${field} is not a valid Sui address`, 400);
  return normalizeSuiAddress(value);
}

function digest(value: string, field: string): string {
  if (!isValidTransactionDigest(value)) fail(`${field} is not a valid Sui transaction digest`, 400);
  return value;
}

function bytes(value: unknown): string {
  if (Array.isArray(value)) return Buffer.from(value.map((item) => Number(item))).toString("hex");
  if (typeof value === "string") {
    try {
      return Buffer.from(value, "base64").toString("hex");
    } catch {
      return value.replace(/^0x/, "").toLowerCase();
    }
  }
  return "";
}

function eventData(event: any, name: string): Record<string, unknown> {
  const value = event?.json ?? event?.parsedJson;
  if (!value || typeof value !== "object") fail(`${name} event has no parsed data`);
  return value as Record<string, unknown>;
}

function assetType(order: TradeOrder): string {
  if (!isValidStructTag(order.assetType)) fail("The order asset type is not a valid Move type", 400);
  return normalizeStructTag(order.assetType);
}

export class GrpcSuiFundingVerifier implements SuiFundingVerifier {
  private readonly client: SuiFundingReader;
  private readonly packageId: string;

  constructor(options: { packageId: string; network?: string; baseUrl?: string; client?: SuiFundingReader }) {
    this.packageId = objectId(options.packageId, "packageId");
    this.client = options.client ?? new SuiGrpcClient({ network: options.network ?? "testnet", baseUrl: options.baseUrl ?? "https://fullnode.testnet.sui.io:443" });
  }

  private async read(txDigest: string, what: string): Promise<any> {
    let response: any;
    try {
      response = await this.client.getTransaction({ digest: txDigest, include: { effects: true, events: true, objectTypes: true, transaction: true } });
    } catch {
      throw new DomainError("SUI_FUNDING_UNAVAILABLE", `Unable to read the Sui ${what} transaction`, 502);
    }
    const tx = response?.Transaction;
    if (!tx || tx.digest !== txDigest || tx.status?.success !== true) fail(`The Sui ${what} transaction was not successful`);
    return tx;
  }

  private event(tx: any, name: string, order: TradeOrder): any {
    const expectedType = `${this.packageId}::escrow::${name}<${assetType(order)}>`;
    const event = (tx.events ?? []).find((candidate: any) => {
      try {
        return normalizeStructTag(String(candidate.eventType ?? candidate.type)) === expectedType && objectId(String(candidate.packageId), "event package ID") === this.packageId;
      } catch {
        return false;
      }
    });
    if (!event) fail(`${name} event is missing from the transaction`);
    return event;
  }

  private funded(order: TradeOrder) {
    if (!order.funding) fail("The order has no verified escrow funding", 409);
    return {
      escrowId: objectId(order.funding.escrowObjectId, "escrowObjectId"),
      buyer: address(order.funding.buyerAddress, "buyerAddress"),
      supplier: address(order.funding.supplierAddress, "supplierAddress"),
      fundingDigest: order.funding.transactionDigest,
    };
  }

  private checkpoint(tx: any): { checkpoint?: string } {
    return { checkpoint: tx.checkpoint ? String(tx.checkpoint) : undefined };
  }

  async verify(order: TradeOrder, funding: FundingInput): Promise<FundingVerification> {
    const txDigest = digest(funding.transactionDigest, "transactionDigest");
    const escrowId = objectId(funding.escrowObjectId, "escrowObjectId");
    const buyer = address(funding.buyerAddress, "buyerAddress");
    const supplier = address(funding.supplierAddress, "supplierAddress");
    const arbitrator = address(funding.arbitratorAddress, "arbitratorAddress");
    const tx = await this.read(txDigest, "funding");
    const event = this.event(tx, "EscrowCreated", order);
    const data = eventData(event, "EscrowCreated");
    if (event.sender && address(String(event.sender), "event sender") !== buyer) fail("Funding sender does not match the buyer wallet");
    if (objectId(String(data.escrow_id), "EscrowCreated.escrow_id") !== escrowId || address(String(data.buyer), "EscrowCreated.buyer") !== buyer || address(String(data.supplier), "EscrowCreated.supplier") !== supplier || address(String(data.arbitrator), "EscrowCreated.arbitrator") !== arbitrator) {
      fail("EscrowCreated parties or object do not match the order");
    }
    if (String(data.amount) !== order.amountUnits || String(data.order_reference) !== order.reference || bytes(data.order_hash) !== order.orderHash.toLowerCase().replace(/^0x/, "")) {
      fail("EscrowCreated amount, order reference, or order hash does not match the order");
    }
    const deliveryDeadlineMs = data.delivery_deadline_ms === undefined ? undefined : Number(data.delivery_deadline_ms);
    const inspectionWindowMs = data.inspection_window_ms === undefined ? undefined : Number(data.inspection_window_ms);
    if (funding.deliveryDeadlineMs !== undefined && deliveryDeadlineMs !== funding.deliveryDeadlineMs) fail("EscrowCreated delivery deadline does not match the recorded deadline");
    if (funding.inspectionWindowMs !== undefined && inspectionWindowMs !== funding.inspectionWindowMs) fail("EscrowCreated inspection window does not match the recorded window");
    const created = (tx.effects?.changedObjects ?? []).find((change: any) => change.objectId === escrowId && change.idOperation === "Created");
    const expectedEscrowType = `${this.packageId}::escrow::Escrow<${assetType(order)}>`;
    if (!created || normalizeStructTag(String(tx.objectTypes?.[escrowId] ?? "")) !== expectedEscrowType) fail("Funding transaction did not create the expected shared escrow object");
    return { ...this.checkpoint(tx), deliveryDeadlineMs, inspectionWindowMs };
  }

  async verifyShipment(order: TradeOrder, transactionDigest: string): Promise<{ checkpoint?: string }> {
    const { escrowId, supplier, fundingDigest } = this.funded(order);
    const txDigest = digest(transactionDigest, "transactionDigest");
    if (txDigest === fundingDigest) fail("The shipment transaction must be distinct from the funding transaction");
    const tx = await this.read(txDigest, "shipment");
    const event = this.event(tx, "Shipped", order);
    const data = eventData(event, "Shipped");
    if (event.sender && address(String(event.sender), "event sender") !== supplier) fail("Shipment was not signed by the supplier wallet");
    if (objectId(String(data.escrow_id), "Shipped.escrow_id") !== escrowId || address(String(data.supplier), "Shipped.supplier") !== supplier) fail("Shipped event does not match the order's escrow");
    return this.checkpoint(tx);
  }

  async verifyEvidenceAnchor(order: TradeOrder, transactionDigest: string, sha256Hex: string): Promise<{ checkpoint?: string }> {
    const { escrowId, buyer, supplier } = this.funded(order);
    const txDigest = digest(transactionDigest, "anchorTransactionDigest");
    const tx = await this.read(txDigest, "evidence anchor");
    const expectedType = `${this.packageId}::escrow::EvidenceAnchored<${assetType(order)}>`;
    const expectedHash = sha256Hex.toLowerCase().replace(/^0x/, "");
    const match = (tx.events ?? []).find((candidate: any) => {
      try {
        if (normalizeStructTag(String(candidate.eventType ?? candidate.type)) !== expectedType || objectId(String(candidate.packageId), "event package ID") !== this.packageId) return false;
        const data = eventData(candidate, "EvidenceAnchored");
        return objectId(String(data.escrow_id), "EvidenceAnchored.escrow_id") === escrowId && bytes(data.evidence_hash) === expectedHash;
      } catch {
        return false;
      }
    });
    if (!match) fail("No EvidenceAnchored event in that transaction carries this file's hash for the order's escrow");
    const party = address(String(eventData(match, "EvidenceAnchored").party), "EvidenceAnchored.party");
    if (party !== buyer && party !== supplier) fail("The evidence was not anchored by a party to the escrow");
    return this.checkpoint(tx);
  }

  async verifyDisputeOpened(order: TradeOrder, input: DisputeOpenedInput): Promise<{ checkpoint?: string; undisputedUnits: string }> {
    const { escrowId, buyer, supplier, fundingDigest } = this.funded(order);
    const txDigest = digest(input.disputeTransactionDigest, "disputeTransactionDigest");
    if (txDigest === fundingDigest) fail("The dispute transaction must be distinct from the funding transaction");
    const tx = await this.read(txDigest, "dispute");
    const opened = this.event(tx, "DisputeOpened", order);
    const openedData = eventData(opened, "DisputeOpened");
    if (opened.sender && address(String(opened.sender), "event sender") !== buyer) fail("The dispute was not signed by the buyer wallet");
    if (objectId(String(openedData.escrow_id), "DisputeOpened.escrow_id") !== escrowId || String(openedData.disputed_amount) !== input.disputedUnits || String(openedData.requested_buyer_refund) !== input.requestedBuyerUnits) {
      fail("DisputeOpened amounts do not match the claim");
    }
    const released = this.event(tx, "UndisputedReleased", order);
    const releasedData = eventData(released, "UndisputedReleased");
    const expected = (BigInt(order.amountUnits) - BigInt(input.disputedUnits)).toString();
    if (objectId(String(releasedData.escrow_id), "UndisputedReleased.escrow_id") !== escrowId || address(String(releasedData.supplier), "UndisputedReleased.supplier") !== supplier || String(releasedData.amount) !== expected) {
      fail("The claim transaction did not release the undisputed value to the supplier");
    }
    return { ...this.checkpoint(tx), undisputedUnits: expected };
  }

  async verifyFullRelease(order: TradeOrder, acceptance: AcceptDeliveryInput): Promise<{ checkpoint?: string }> {
    const { escrowId, buyer, fundingDigest } = this.funded(order);
    const txDigest = digest(acceptance.transactionDigest, "transactionDigest");
    if (txDigest === fundingDigest) fail("The release transaction must be distinct from the funding transaction");
    const tx = await this.read(txDigest, "release");
    const sender = tx.transaction?.sender ?? tx.sender;
    if (sender && address(String(sender), "release sender") !== buyer) fail("The release was not signed by the buyer wallet");
    this.closed(tx, order, escrowId, acceptance.receiptObjectId);
    return this.checkpoint(tx);
  }

  async verifyDeadlineSettlement(order: TradeOrder, input: DeadlineSettlementInput): Promise<{ checkpoint?: string }> {
    const { escrowId, buyer, supplier, fundingDigest } = this.funded(order);
    const txDigest = digest(input.transactionDigest, "transactionDigest");
    if (txDigest === fundingDigest) fail("The settlement transaction must be distinct from the funding transaction");
    const tx = await this.read(txDigest, "deadline settlement");
    const event = this.event(tx, "SettlementExecuted", order);
    const data = eventData(event, "SettlementExecuted");
    const refund = input.kind === "refund_unshipped";
    const expectedMode = refund ? MODE_REFUND_UNSHIPPED : MODE_CLAIM_UNINSPECTED;
    const expectedSigner = refund ? buyer : supplier;
    if (event.sender && address(String(event.sender), "event sender") !== expectedSigner) fail(`The ${input.kind} transaction was not signed by the ${refund ? "buyer" : "supplier"} wallet`);
    if (objectId(String(data.escrow_id), "SettlementExecuted.escrow_id") !== escrowId || Number(data.approval_mode) !== expectedMode) fail("SettlementExecuted does not describe this deadline settlement");
    const total = order.amountUnits;
    const wholeToEntitled = refund
      ? String(data.buyer_refund) === total && String(data.supplier_release) === "0"
      : String(data.supplier_release) === total && String(data.buyer_refund) === "0";
    if (!wholeToEntitled) fail("The deadline settlement did not move the whole escrow to the entitled party");
    this.closed(tx, order, escrowId, input.receiptObjectId, String(data.receipt_id));
    return this.checkpoint(tx);
  }

  /** The escrow object is gone and a settlement receipt exists. */
  private closed(tx: any, order: TradeOrder, escrowId: string, receiptObjectId?: string, eventReceiptId?: string): void {
    const changes: any[] = tx.effects?.changedObjects ?? [];
    const deleted = changes.some((change) => { try { return objectId(String(change.objectId), "changed object") === escrowId && change.idOperation === "Deleted"; } catch { return false; } });
    if (!deleted) fail("The transaction did not close the order's escrow");
    const receiptType = `${this.packageId}::escrow::SettlementReceipt<${assetType(order)}>`;
    const receipt = changes.find((change) => change.idOperation === "Created" && change.objectType && normalizeStructTag(String(change.objectType)) === receiptType);
    if (!receipt) fail("The transaction did not create a settlement receipt");
    const created = objectId(String(receipt.objectId), "receipt object");
    if (receiptObjectId && objectId(receiptObjectId, "receiptObjectId") !== created) fail("The receipt object does not match the transaction");
    if (eventReceiptId && objectId(eventReceiptId, "SettlementExecuted.receipt_id") !== created) fail("The receipt object does not match the settlement event");
  }
}

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { isValidStructTag, isValidSuiAddress, isValidSuiObjectId, isValidTransactionDigest, normalizeStructTag, normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";
import { DomainError } from "../domain/types.js";
import type { FundingInput, TradeOrder, UndisputedReleaseInput } from "../domain/trade-types.js";
import type { DisputeAggregate } from "../domain/types.js";

export interface SuiFundingReader {
  getTransaction(input: { digest: string; include: Record<string, boolean> }): Promise<any>;
}

export interface SuiFundingVerifier {
  verify(order: TradeOrder, funding: FundingInput): Promise<{ checkpoint?: string }>;
  verifyUndisputedRelease?(order: TradeOrder, dispute: DisputeAggregate, release: UndisputedReleaseInput): Promise<{ checkpoint?: string }>;
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

function eventData(event: any): Record<string, unknown> {
  const value = event?.json ?? event?.parsedJson;
  if (!value || typeof value !== "object") fail("EscrowCreated event has no parsed data");
  return value as Record<string, unknown>;
}

export class GrpcSuiFundingVerifier implements SuiFundingVerifier {
  private readonly client: SuiFundingReader;
  private readonly packageId: string;

  constructor(options: { packageId: string; network?: string; baseUrl?: string; client?: SuiFundingReader }) {
    this.packageId = objectId(options.packageId, "packageId");
    this.client = options.client ?? new SuiGrpcClient({ network: options.network ?? "testnet", baseUrl: options.baseUrl ?? "https://fullnode.testnet.sui.io:443" });
  }

  async verify(order: TradeOrder, funding: FundingInput): Promise<{ checkpoint?: string }> {
    const txDigest = digest(funding.transactionDigest, "transactionDigest");
    const escrowId = objectId(funding.escrowObjectId, "escrowObjectId");
    const buyer = address(funding.buyerAddress, "buyerAddress");
    const supplier = address(funding.supplierAddress, "supplierAddress");
    const arbitrator = address(funding.arbitratorAddress, "arbitratorAddress");
    if (!isValidStructTag(order.assetType)) fail("The order asset type is not a valid Move type", 400);
    const expectedType = `${this.packageId}::escrow::EscrowCreated<${normalizeStructTag(order.assetType)}>`;
    let response: any;
    try {
      response = await this.client.getTransaction({ digest: txDigest, include: { effects: true, events: true, objectTypes: true, transaction: true } });
    } catch {
      throw new DomainError("SUI_FUNDING_UNAVAILABLE", "Unable to read the Sui funding transaction", 502);
    }
    const tx = response?.Transaction;
    if (!tx || tx.digest !== txDigest || tx.status?.success !== true) fail("The Sui funding transaction was not successful");
    const event = (tx.events ?? []).find((candidate: any) => {
      try {
        return normalizeStructTag(String(candidate.eventType ?? candidate.type)) === expectedType && objectId(String(candidate.packageId), "event package ID") === this.packageId;
      } catch {
        return false;
      }
    });
    if (!event) fail("EscrowCreated event is missing from the funding transaction");
    const data = eventData(event);
    if (event.sender && address(String(event.sender), "event sender") !== buyer) fail("Funding sender does not match the buyer wallet");
    if (objectId(String(data.escrow_id), "EscrowCreated.escrow_id") !== escrowId || address(String(data.buyer), "EscrowCreated.buyer") !== buyer || address(String(data.supplier), "EscrowCreated.supplier") !== supplier || address(String(data.arbitrator), "EscrowCreated.arbitrator") !== arbitrator) {
      fail("EscrowCreated parties or object do not match the order");
    }
    if (String(data.amount) !== order.amountUnits || String(data.order_reference) !== order.reference || bytes(data.order_hash) !== order.orderHash.toLowerCase().replace(/^0x/, "")) {
      fail("EscrowCreated amount, order reference, or order hash does not match the order");
    }
    const created = (tx.effects?.changedObjects ?? []).find((change: any) => change.objectId === escrowId && change.idOperation === "Created");
    const expectedEscrowType = `${this.packageId}::escrow::Escrow<${normalizeStructTag(order.assetType)}>`;
    if (!created || normalizeStructTag(String(tx.objectTypes?.[escrowId] ?? "")) !== expectedEscrowType) fail("Funding transaction did not create the expected shared escrow object");
    return { checkpoint: tx.checkpoint ? String(tx.checkpoint) : undefined };
  }

  async verifyUndisputedRelease(order: TradeOrder, dispute: DisputeAggregate, release: UndisputedReleaseInput): Promise<{ checkpoint?: string }> {
    if (!order.funding) fail("The order has no verified escrow funding", 409);
    const txDigest = digest(release.transactionDigest, "transactionDigest");
    if (txDigest === order.funding.transactionDigest || txDigest === dispute.onchainEscrow?.disputeTransactionDigest) fail("The undisputed release transaction must be distinct from funding and dispute transactions");
    const escrowId = objectId(order.funding.escrowObjectId, "escrowObjectId");
    const supplier = address(order.funding.supplierAddress, "supplierAddress");
    if (!isValidStructTag(order.assetType)) fail("The order asset type is not a valid Move type", 400);
    const expectedType = `${this.packageId}::escrow::UndisputedReleased<${normalizeStructTag(order.assetType)}>`;
    let response: any;
    try {
      response = await this.client.getTransaction({ digest: txDigest, include: { effects: true, events: true, objectTypes: true, transaction: true } });
    } catch {
      throw new DomainError("SUI_FUNDING_UNAVAILABLE", "Unable to read the Sui undisputed release transaction", 502);
    }
    const tx = response?.Transaction;
    if (!tx || tx.digest !== txDigest || tx.status?.success !== true) fail("The Sui undisputed release transaction was not successful");
    const event = (tx.events ?? []).find((candidate: any) => {
      try {
        return normalizeStructTag(String(candidate.eventType ?? candidate.type)) === expectedType && objectId(String(candidate.packageId), "event package ID") === this.packageId;
      } catch {
        return false;
      }
    });
    if (!event) fail("UndisputedReleased event is missing from the release transaction");
    const data = eventData(event);
    const total = BigInt(order.amountUnits);
    const disputed = BigInt(dispute.disputedUnits);
    const expectedAmount = total - disputed;
    if (event.sender && address(String(event.sender), "event sender") !== supplier) fail("Release sender does not match the supplier wallet");
    if (objectId(String(data.escrow_id), "UndisputedReleased.escrow_id") !== escrowId || address(String(data.supplier), "UndisputedReleased.supplier") !== supplier || String(data.amount) !== expectedAmount.toString()) {
      fail("UndisputedReleased fields do not match the order and dispute");
    }
    return { checkpoint: tx.checkpoint ? String(tx.checkpoint) : undefined };
  }
}

import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  isValidStructTag,
  isValidSuiAddress,
  isValidSuiObjectId,
  isValidTransactionDigest,
  normalizeStructTag,
  normalizeSuiAddress,
  normalizeSuiObjectId,
} from "@mysten/sui/utils";
import { DomainError, type DisputeAggregate, type SettlementExecution } from "../domain/types.js";

export interface SettlementExecutionProof {
  transactionDigest: string;
  packageId: string;
  escrowObjectId: string;
  receiptObjectId: string;
}

/**
 * A deliberately narrow read-only surface keeps the verifier easy to test and
 * prevents the backend from ever holding a signing key.
 */
export interface SuiSettlementReader {
  getTransaction(input: { digest: string; include: Record<string, boolean> }): Promise<any>;
  getObject(input: { objectId: string; include: Record<string, boolean> }): Promise<any>;
}

export interface SuiSettlementVerifier {
  verify(
    dispute: DisputeAggregate,
    proof: SettlementExecutionProof,
  ): Promise<Omit<SettlementExecution, "verifiedAt">>;
}

export interface GrpcSuiSettlementVerifierOptions {
  packageId: string;
  legacyPackageIds?: string[];
  network?: string;
  baseUrl?: string;
  client?: SuiSettlementReader;
}

const TRANSACTION_INCLUDE = {
  effects: true,
  events: true,
  objectTypes: true,
  transaction: true,
};

const OBJECT_INCLUDE = { json: true, previousTransaction: true };

function fail(code: string, message: string, status = 422): never {
  throw new DomainError(code, message, status);
}

function objectId(value: string, field: string): string {
  if (!isValidSuiObjectId(value)) fail("INVALID_SETTLEMENT_EXECUTION", `${field} is not a valid Sui object ID`, 400);
  return normalizeSuiObjectId(value);
}

function address(value: string, field: string): string {
  if (!isValidSuiAddress(value)) fail("INVALID_SETTLEMENT_EXECUTION", `${field} is not a valid Sui address`, 400);
  return normalizeSuiAddress(value);
}

function digest(value: string, field: string): string {
  if (!isValidTransactionDigest(value)) fail("INVALID_SETTLEMENT_EXECUTION", `${field} is not a valid transaction digest`, 400);
  return value;
}

function moveType(value: string, field: string): string {
  if (!isValidStructTag(value)) fail("SUI_VERIFICATION_FAILED", `${field} is not a valid Move type`);
  return normalizeStructTag(value);
}

function units(value: unknown, field: string): bigint {
  const text = String(value ?? "");
  if (!/^(0|[1-9]\d*)$/.test(text)) fail("SUI_VERIFICATION_FAILED", `${field} is not a non-negative integer`);
  return BigInt(text);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("SUI_VERIFICATION_FAILED", `${field} is missing parsed Move data`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail("SUI_VERIFICATION_FAILED", `${field} is missing`);
  return value;
}

function vectorBytes(value: unknown): string {
  if (Array.isArray(value)) return Buffer.from(value.map((item) => Number(item))).toString("hex");
  if (typeof value === "string") {
    try { return Buffer.from(value, "base64").toString("hex"); } catch { return value.replace(/^0x/, "").toLowerCase(); }
  }
  return "";
}

function eventData(event: any, field: string): Record<string, unknown> {
  return record(event?.json ?? event?.parsedJson, field);
}

function sameAddress(left: unknown, right: string): boolean {
  try {
    return address(String(left), "event address") === right;
  } catch {
    return false;
  }
}

function sameObjectId(left: unknown, right: string): boolean {
  try {
    return objectId(String(left), "event object ID") === right;
  } catch {
    return false;
  }
}

function ownerIsShared(owner: unknown): boolean {
  if (!owner || typeof owner !== "object") return false;
  const candidate = owner as Record<string, unknown>;
  return candidate.$kind === "Shared" || Object.prototype.hasOwnProperty.call(candidate, "Shared");
}

function transactionResult(response: any, digestValue: string): any {
  if (!response?.Transaction) {
    if (response?.FailedTransaction) fail("SUI_VERIFICATION_FAILED", `Sui transaction ${digestValue} failed`);
    fail("SUI_VERIFICATION_FAILED", `Sui transaction ${digestValue} was not found`);
  }
  const tx = response.Transaction;
  if (tx.digest !== digestValue || tx.status?.success !== true) {
    fail("SUI_VERIFICATION_FAILED", `Sui transaction ${digestValue} did not succeed`);
  }
  if (!tx.effects) fail("SUI_VERIFICATION_FAILED", `Sui transaction ${digestValue} has no effects`);
  return tx;
}

function findEvent(tx: any, type: string, label: string, packageId: string): any {
  const event = (tx.events ?? []).find((candidate: any) => {
    try {
      return (
        normalizeStructTag(String(candidate.eventType ?? candidate.type)) === type &&
        typeof candidate.packageId === "string" &&
        objectId(candidate.packageId, "event package ID") === packageId
      );
    } catch {
      return false;
    }
  });
  if (!event) fail("SUI_VERIFICATION_FAILED", `${label} event is missing from the verified transaction`);
  return event;
}

function createdObjectHasType(tx: any, id: string, type: string): boolean {
  const change = (tx.effects?.changedObjects ?? []).find((candidate: any) => candidate.objectId === id);
  if (!change || change.idOperation !== "Created") return false;
  const objectType = tx.objectTypes?.[id];
  return typeof objectType === "string" && normalizeStructTag(objectType) === type;
}

function deletedObject(tx: any, id: string): boolean {
  return (tx.effects?.changedObjects ?? []).some(
    (candidate: any) => candidate.objectId === id && candidate.idOperation === "Deleted",
  );
}

/**
 * Verifies the funding, dispute, and settlement events plus the final receipt.
 * A client-supplied digest is only an index: all security decisions are based
 * on fresh reads from the configured Sui gRPC endpoint.
 */
export class GrpcSuiSettlementVerifier implements SuiSettlementVerifier {
  private readonly client: SuiSettlementReader;
  private readonly packageId: string;
  private readonly allowedPackages: Set<string>;

  constructor(options: GrpcSuiSettlementVerifierOptions) {
    this.packageId = objectId(options.packageId, "packageId");
    this.allowedPackages = new Set([this.packageId, ...(options.legacyPackageIds ?? []).map((value) => objectId(value, "legacyPackageId"))]);
    this.client = options.client ?? new SuiGrpcClient({
      network: options.network ?? "testnet",
      baseUrl: options.baseUrl ?? "https://fullnode.testnet.sui.io:443",
    });
  }

  private async readTransaction(transactionDigest: string): Promise<any> {
    try {
      return transactionResult(
        await this.client.getTransaction({ digest: transactionDigest, include: TRANSACTION_INCLUDE }),
        transactionDigest,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("SUI_VERIFICATION_UNAVAILABLE", "Unable to read the Sui transaction", 502);
    }
  }

  private async readObject(objectIdValue: string): Promise<any> {
    try {
      const response = await this.client.getObject({ objectId: objectIdValue, include: OBJECT_INCLUDE });
      if (!response?.object) fail("SUI_VERIFICATION_FAILED", "The settlement receipt object was not found");
      return response.object;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("SUI_VERIFICATION_UNAVAILABLE", "Unable to read the Sui receipt object", 502);
    }
  }

  async verify(
    dispute: DisputeAggregate,
    proof: SettlementExecutionProof,
  ): Promise<Omit<SettlementExecution, "verifiedAt">> {
    const binding = dispute.onchainEscrow;
    if (!binding) {
      fail("ONCHAIN_BINDING_REQUIRED", "The dispute is not bound to a verified Sui escrow", 409);
    }
    const agreement = dispute.settlement;
    if (!agreement || agreement.executionStatus !== "pending_on_chain") {
      fail("SUI_VERIFICATION_FAILED", "The dispute has no pending off-chain settlement agreement");
    }

    const packageId = objectId(proof.packageId, "packageId");
    const bindingPackageId = objectId(binding.packageId, "onchainEscrow.packageId");
    const escrowObjectId = objectId(proof.escrowObjectId, "escrowObjectId");
    const bindingEscrowObjectId = objectId(binding.escrowObjectId, "onchainEscrow.escrowObjectId");
    const receiptObjectId = objectId(proof.receiptObjectId, "receiptObjectId");
    const settlementDigest = digest(proof.transactionDigest, "transactionDigest");
    const fundingDigest = digest(binding.fundingTransactionDigest, "fundingTransactionDigest");
    const disputeDigest = digest(binding.disputeTransactionDigest, "disputeTransactionDigest");
    if (packageId !== bindingPackageId || !this.allowedPackages.has(packageId)) {
      fail("SUI_VERIFICATION_FAILED", "The proof references a package outside the configured escrow deployment");
    }
    if (escrowObjectId !== bindingEscrowObjectId) {
      fail("SUI_VERIFICATION_FAILED", "The proof escrow does not match the dispute binding");
    }
    if (new Set([fundingDigest, disputeDigest, settlementDigest]).size !== 3) {
      fail("SUI_VERIFICATION_FAILED", "Funding, dispute, and settlement transactions must be distinct");
    }

    const buyerAddress = address(binding.buyerAddress, "onchainEscrow.buyerAddress");
    const supplierAddress = address(binding.supplierAddress, "onchainEscrow.supplierAddress");
    const arbitratorAddress = address(binding.arbitratorAddress, "onchainEscrow.arbitratorAddress");
    if (new Set([buyerAddress, supplierAddress, arbitratorAddress]).size !== 3) {
      fail("SUI_VERIFICATION_FAILED", "The bound Sui parties must be distinct");
    }
    const assetType = moveType(dispute.assetType, "assetType");
    const escrowCreatedType = `${packageId}::escrow::EscrowCreated<${assetType}>`;
    const disputeOpenedType = `${packageId}::escrow::DisputeOpened<${assetType}>`;
    const settlementExecutedType = `${packageId}::escrow::SettlementExecuted<${assetType}>`;
    const receiptType = `${packageId}::escrow::SettlementReceipt<${assetType}>`;

    const fundingTx = await this.readTransaction(fundingDigest);
    const fundingEvent = findEvent(fundingTx, escrowCreatedType, "EscrowCreated", packageId);
    const fundingData = eventData(fundingEvent, "EscrowCreated");
    if (
      !sameObjectId(fundingData.escrow_id, escrowObjectId) ||
      !sameAddress(fundingData.buyer, buyerAddress) ||
      !sameAddress(fundingData.supplier, supplierAddress) ||
      !sameAddress(fundingData.arbitrator, arbitratorAddress) ||
      !sameAddress(fundingEvent.sender, buyerAddress) ||
      fundingData.order_reference !== dispute.tradeTerms.orderReference ||
      units(fundingData.amount, "EscrowCreated.amount") !== units(dispute.totalEscrowUnits, "totalEscrowUnits") ||
      !createdObjectHasType(fundingTx, escrowObjectId, `${packageId}::escrow::Escrow<${assetType}>`)
    ) {
      fail("SUI_VERIFICATION_FAILED", "The funding transaction does not match the dispute escrow binding");
    }

    const disputeTx = await this.readTransaction(disputeDigest);
    const disputeEvent = findEvent(disputeTx, disputeOpenedType, "DisputeOpened", packageId);
    const disputeData = eventData(disputeEvent, "DisputeOpened");
    if (
      !sameObjectId(disputeData.escrow_id, escrowObjectId) ||
      !sameAddress(disputeEvent.sender, buyerAddress) ||
      units(disputeData.disputed_amount, "DisputeOpened.disputed_amount") !== units(dispute.disputedUnits, "disputedUnits") ||
      units(disputeData.requested_buyer_refund, "DisputeOpened.requested_buyer_refund") !== units(dispute.requestedBuyerUnits, "requestedBuyerUnits")
    ) {
      fail("SUI_VERIFICATION_FAILED", "The dispute transaction does not match the off-chain dispute");
    }

    const settlementTx = await this.readTransaction(settlementDigest);
    const settlementEvent = findEvent(settlementTx, settlementExecutedType, "SettlementExecuted", packageId);
    const settlementData = eventData(settlementEvent, "SettlementExecuted");
    const buyerRefund = units(settlementData.buyer_refund, "SettlementExecuted.buyer_refund");
    const supplierRelease = units(settlementData.supplier_release, "SettlementExecuted.supplier_release");
    const disputedUnits = units(dispute.disputedUnits, "disputedUnits");
    const requestedBuyerUnits = units(dispute.requestedBuyerUnits, "requestedBuyerUnits");
    const agreedBuyerRefund = units(agreement.buyerUnits, "settlement.buyerUnits");
    const agreedSupplierRelease = units(agreement.supplierUnits, "settlement.supplierUnits");
    const expectedProposalHash = agreement.proposalHash?.toLowerCase();
    if (
      !sameObjectId(settlementData.escrow_id, escrowObjectId) ||
      !sameObjectId(settlementData.receipt_id, receiptObjectId) ||
      !sameAddress(settlementData.buyer, buyerAddress) ||
      !sameAddress(settlementData.supplier, supplierAddress) ||
      buyerRefund !== agreedBuyerRefund ||
      supplierRelease !== agreedSupplierRelease ||
      buyerRefund > requestedBuyerUnits ||
      buyerRefund + supplierRelease !== disputedUnits ||
      (expectedProposalHash && vectorBytes(settlementData.proposal_hash) !== expectedProposalHash) ||
      !deletedObject(settlementTx, escrowObjectId) ||
      !createdObjectHasType(settlementTx, receiptObjectId, receiptType)
    ) {
      fail("SUI_VERIFICATION_FAILED", "The settlement transaction does not conserve or bind the disputed funds");
    }

    const receipt = await this.readObject(receiptObjectId);
    if (
      !receipt.type ||
      normalizeStructTag(receipt.type) !== receiptType ||
      !ownerIsShared(receipt.owner) ||
      receipt.previousTransaction !== settlementDigest
    ) {
      fail("SUI_VERIFICATION_FAILED", "The receipt object is not the immutable result of this settlement");
    }
    const receiptData = record(receipt.json, "SettlementReceipt");
    if (
      !sameObjectId(receiptData.id, receiptObjectId) ||
      !sameObjectId(receiptData.escrow_id, escrowObjectId) ||
      !sameAddress(receiptData.buyer, buyerAddress) ||
      !sameAddress(receiptData.supplier, supplierAddress) ||
      units(receiptData.buyer_refund, "SettlementReceipt.buyer_refund") !== buyerRefund ||
      units(receiptData.supplier_release, "SettlementReceipt.supplier_release") !== supplierRelease ||
      text(receiptData.order_hash, "SettlementReceipt.order_hash") !== text(fundingData.order_hash, "EscrowCreated.order_hash") ||
      text(receiptData.proposal_hash, "SettlementReceipt.proposal_hash") !== text(settlementData.proposal_hash, "SettlementExecuted.proposal_hash") ||
      (expectedProposalHash && vectorBytes(receiptData.proposal_hash) !== expectedProposalHash)
    ) {
      fail("SUI_VERIFICATION_FAILED", "The receipt fields do not match the verified settlement event");
    }

    return {
      transactionDigest: settlementDigest,
      packageId,
      escrowObjectId,
      receiptObjectId,
      checkpoint: settlementTx.checkpoint ?? undefined,
    };
  }
}

export function createSuiSettlementVerifier(options: GrpcSuiSettlementVerifierOptions): SuiSettlementVerifier {
  return new GrpcSuiSettlementVerifier(options);
}

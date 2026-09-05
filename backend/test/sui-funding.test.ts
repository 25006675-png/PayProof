import { describe, expect, it } from "vitest";
import { GrpcSuiFundingVerifier, type SuiFundingReader } from "../src/integrations/sui-funding.js";
import type { TradeOrder } from "../src/domain/trade-types.js";

const PACKAGE = "0x132dda3d655724c5a667a4454baef3db3f6529ecf42ddb65132e1d9d14fd6f30";
const ASSET = "0x2::sui::SUI";
const BUYER = `0x${"a".repeat(64)}`;
const SUPPLIER = `0x${"b".repeat(64)}`;
const ARBITRATOR = `0x${"c".repeat(64)}`;
const ESCROW = `0x${"d".repeat(64)}`;
const RECEIPT = `0x${"e".repeat(64)}`;
const DIGEST = "c9ddWRcRLnGNA7rXX9cTNsDBnDfURTj1QAb88Qrpmnt";
const OTHER_DIGEST = "7h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ";
const HASH = "07".repeat(32);
const FILE_HASH = "03".repeat(32);
const DEADLINE = 1_800_000_000_000;
const WINDOW = 7 * 24 * 60 * 60 * 1000;

function order(): TradeOrder {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "ORDER-100", buyerId: "11111111-1111-4111-8111-111111111111",
    supplierId: "22222222-2222-4222-8222-222222222222", arbitratorId: "33333333-3333-4333-8333-333333333333", supplierEmail: "s@example.com", supplierName: "Supplier",
    assetType: ASSET, amountUnits: "100000", orderHash: HASH, description: "Industrial pump", deliveryDate: "2026-09-04", deliveryLocation: "PJ",
    lineItems: [{ id: "1", description: "Pump", quantity: "1", unit: "unit", unitPriceUnits: "100000" }], status: "supplier_confirmed", version: 0,
    createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function fundedOrder(): TradeOrder {
  return { ...order(), status: "funded", funding: { packageId: PACKAGE, escrowObjectId: ESCROW, transactionDigest: DIGEST, buyerAddress: BUYER, supplierAddress: SUPPLIER, arbitratorAddress: ARBITRATOR, verificationStatus: "verified_on_chain", fundedAt: "2026-08-31T00:00:00.000Z", deliveryDeadlineMs: DEADLINE, inspectionWindowMs: WINDOW } };
}

const event = (name: string, sender: string, json: Record<string, unknown>) => ({ packageId: PACKAGE, eventType: `${PACKAGE}::escrow::${name}<${ASSET}>`, sender, json });

function transaction(digest: string, events: unknown[], effects: Record<string, unknown> = { changedObjects: [] }, objectTypes: Record<string, string> = {}) {
  return { Transaction: { digest, status: { success: true }, checkpoint: "42", events, effects, objectTypes } };
}

function readerOf(response: unknown): SuiFundingReader {
  return { getTransaction: async () => structuredClone(response) };
}

function fundingReader(): SuiFundingReader {
  return readerOf(transaction(DIGEST,
    [event("EscrowCreated", BUYER, { escrow_id: ESCROW, buyer: BUYER, supplier: SUPPLIER, arbitrator: ARBITRATOR, amount: "100000", order_hash: Array.from({ length: 32 }, () => 7), order_reference: "ORDER-100", delivery_deadline_ms: String(DEADLINE), inspection_window_ms: String(WINDOW) })],
    { changedObjects: [{ objectId: ESCROW, idOperation: "Created" }] }, { [ESCROW]: `${PACKAGE}::escrow::Escrow<${ASSET}>` }));
}

const funding = { packageId: PACKAGE, escrowObjectId: ESCROW, transactionDigest: DIGEST, buyerAddress: BUYER, supplierAddress: SUPPLIER, arbitratorAddress: ARBITRATOR };
const closed = (receiptType = `${PACKAGE}::escrow::SettlementReceipt<${ASSET}>`) => ({ changedObjects: [{ objectId: ESCROW, idOperation: "Deleted" }, { objectId: RECEIPT, idOperation: "Created", objectType: receiptType }] });

describe("Sui funding verifier", () => {
  it("verifies EscrowCreated against the order and reads the escrow deadlines", async () => {
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: fundingReader() }).verify(order(), funding))
      .resolves.toMatchObject({ checkpoint: "42", deliveryDeadlineMs: DEADLINE, inspectionWindowMs: WINDOW });
  });

  it("rejects a mismatched order hash", async () => {
    const client = fundingReader();
    const original = client.getTransaction;
    client.getTransaction = async (input) => { const response = await original(input); response.Transaction.events[0].json.order_hash[0] = 8; return response; };
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client }).verify(order(), funding)).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("rejects a deadline that differs from what the client recorded", async () => {
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: fundingReader() }).verify(order(), { ...funding, deliveryDeadlineMs: DEADLINE + 1 }))
      .rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies the supplier's Shipped event", async () => {
    const shipment = { escrow_id: ESCROW, supplier: SUPPLIER, shipped_at_ms: "1", evidence_hash: Array.from({ length: 32 }, () => 3), released_amount: "0", remaining_amount: "100000" };
    const verifier = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(transaction(OTHER_DIGEST, [event("Shipped", SUPPLIER, shipment)])) });
    await expect(verifier.verifyShipment(fundedOrder(), OTHER_DIGEST, FILE_HASH)).resolves.toMatchObject({ checkpoint: "42", releasedUnits: "0", remainingUnits: "100000" });
    const wrongSigner = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(transaction(OTHER_DIGEST, [event("Shipped", BUYER, shipment)])) });
    await expect(wrongSigner.verifyShipment(fundedOrder(), OTHER_DIGEST, FILE_HASH)).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies an evidence anchor only when the on-chain hash matches the file", async () => {
    const anchored = transaction(OTHER_DIGEST, [event("EvidenceAnchored", SUPPLIER, { escrow_id: ESCROW, party: SUPPLIER, kind: 2, evidence_hash: Array.from({ length: 32 }, () => 3), anchored_at_ms: "1" })]);
    const verifier = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(anchored) });
    await expect(verifier.verifyEvidenceAnchor(fundedOrder(), OTHER_DIGEST, FILE_HASH)).resolves.toMatchObject({ checkpoint: "42" });
    await expect(verifier.verifyEvidenceAnchor(fundedOrder(), OTHER_DIGEST, "04".repeat(32))).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies that the claim transaction paid the undisputed value to the supplier", async () => {
    const opened = transaction(OTHER_DIGEST, [
      event("DisputeOpened", BUYER, { escrow_id: ESCROW, disputed_amount: "30000", requested_buyer_refund: "20000", opened_at_ms: "1" }),
      event("UndisputedReleased", BUYER, { escrow_id: ESCROW, supplier: SUPPLIER, amount: "70000" }),
    ]);
    const verifier = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(opened) });
    await expect(verifier.verifyDisputeOpened(fundedOrder(), { disputeTransactionDigest: OTHER_DIGEST, disputedUnits: "30000", requestedBuyerUnits: "20000" })).resolves.toMatchObject({ undisputedUnits: "70000" });
    await expect(verifier.verifyDisputeOpened(fundedOrder(), { disputeTransactionDigest: OTHER_DIGEST, disputedUnits: "40000", requestedBuyerUnits: "20000" })).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies a buyer refund after the delivery deadline", async () => {
    const refund = transaction(OTHER_DIGEST, [event("SettlementExecuted", BUYER, { escrow_id: ESCROW, receipt_id: RECEIPT, buyer: BUYER, supplier: SUPPLIER, buyer_refund: "100000", supplier_release: "0", approval_mode: 3, settled_at_ms: "1" })], closed());
    const verifier = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(refund) });
    await expect(verifier.verifyDeadlineSettlement(fundedOrder(), { kind: "refund_unshipped", transactionDigest: OTHER_DIGEST, receiptObjectId: RECEIPT })).resolves.toMatchObject({ checkpoint: "42" });
    await expect(verifier.verifyDeadlineSettlement(fundedOrder(), { kind: "claim_uninspected", transactionDigest: OTHER_DIGEST })).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies a supplier claim after the inspection window", async () => {
    const claim = transaction(OTHER_DIGEST, [event("SettlementExecuted", SUPPLIER, { escrow_id: ESCROW, receipt_id: RECEIPT, buyer: BUYER, supplier: SUPPLIER, buyer_refund: "0", supplier_release: "100000", approval_mode: 4, settled_at_ms: "1" })], closed());
    const verifier = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(claim) });
    await expect(verifier.verifyDeadlineSettlement(fundedOrder(), { kind: "claim_uninspected", transactionDigest: OTHER_DIGEST })).resolves.toMatchObject({ checkpoint: "42" });
    const stillOpen = new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: readerOf(transaction(OTHER_DIGEST, claim.Transaction.events)) });
    await expect(stillOpen.verifyDeadlineSettlement(fundedOrder(), { kind: "claim_uninspected", transactionDigest: OTHER_DIGEST })).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });
});

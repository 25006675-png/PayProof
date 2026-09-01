import { describe, expect, it } from "vitest";
import { GrpcSuiFundingVerifier, type SuiFundingReader } from "../src/integrations/sui-funding.js";
import type { TradeOrder } from "../src/domain/trade-types.js";

const PACKAGE = "0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535";
const ASSET = "0x2::sui::SUI";
const BUYER = `0x${"a".repeat(64)}`;
const SUPPLIER = `0x${"b".repeat(64)}`;
const ARBITRATOR = `0x${"c".repeat(64)}`;
const ESCROW = `0x${"d".repeat(64)}`;
const DIGEST = "c9ddWRcRLnGNA7rXX9cTNsDBnDfURTj1QAb88Qrpmnt";
const RELEASE_DIGEST = "7h6Qw7kqQn8tT7mM9nV3aX2pL4rS5dF6gH8jK9mN2pQ";
const HASH = "07".repeat(32);

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
  return { ...order(), status: "funded", funding: { packageId: PACKAGE, escrowObjectId: ESCROW, transactionDigest: DIGEST, buyerAddress: BUYER, supplierAddress: SUPPLIER, arbitratorAddress: ARBITRATOR, verificationStatus: "verified_on_chain", fundedAt: "2026-08-31T00:00:00.000Z" } };
}

function reader(): SuiFundingReader {
  const eventType = `${PACKAGE}::escrow::EscrowCreated<${ASSET}>`;
  return { getTransaction: async () => ({ Transaction: {
    digest: DIGEST, status: { success: true }, checkpoint: "42",
    events: [{ packageId: PACKAGE, eventType, sender: BUYER, json: { escrow_id: ESCROW, buyer: BUYER, supplier: SUPPLIER, arbitrator: ARBITRATOR, amount: "100000", order_hash: Array.from({ length: 32 }, () => 7), order_reference: "ORDER-100" } }],
    effects: { changedObjects: [{ objectId: ESCROW, idOperation: "Created" }] }, objectTypes: { [ESCROW]: `${PACKAGE}::escrow::Escrow<${ASSET}>` },
  } }) };
}

const funding = { packageId: PACKAGE, escrowObjectId: ESCROW, transactionDigest: DIGEST, buyerAddress: BUYER, supplierAddress: SUPPLIER, arbitratorAddress: ARBITRATOR };

describe("Sui funding verifier", () => {
  it("verifies EscrowCreated against the order", async () => {
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client: reader() }).verify(order(), funding)).resolves.toMatchObject({ checkpoint: "42" });
  });

  it("rejects a mismatched order hash", async () => {
    const client = reader();
    const original = client.getTransaction;
    client.getTransaction = async (input) => { const response = await original(input); response.Transaction.events[0].json.order_hash[0] = 8; return response; };
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client }).verify(order(), funding)).rejects.toMatchObject({ code: "SUI_FUNDING_VERIFICATION_FAILED" });
  });

  it("verifies the supplier's undisputed release event against the dispute", async () => {
    const eventType = `${PACKAGE}::escrow::UndisputedReleased<${ASSET}>`;
    const client: SuiFundingReader = { getTransaction: async () => ({ Transaction: {
      digest: RELEASE_DIGEST, status: { success: true }, checkpoint: "43",
      events: [{ packageId: PACKAGE, eventType, sender: SUPPLIER, json: { escrow_id: ESCROW, supplier: SUPPLIER, amount: "70000" } }],
      effects: { changedObjects: [] }, objectTypes: {},
    } }) };
    const dispute = { disputedUnits: "30000" } as any;
    await expect(new GrpcSuiFundingVerifier({ packageId: PACKAGE, client }).verifyUndisputedRelease(fundedOrder(), dispute, { transactionDigest: RELEASE_DIGEST })).resolves.toMatchObject({ checkpoint: "43" });
  });
});

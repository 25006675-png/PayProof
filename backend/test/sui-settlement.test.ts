import { describe, expect, it } from "vitest";
import { openDispute } from "../src/domain/dispute-machine.js";
import { GrpcSuiSettlementVerifier, type SuiSettlementReader } from "../src/integrations/sui-settlement.js";
import { BUYER, buyer, controlledContext, openInput } from "./fixtures.js";

const PACKAGE = "0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535";
const ASSET = "0x2::sui::SUI";
const BUYER_ADDRESS = "0x97244cf38ff9fd4da3cd8a64723d0733e446f58363a6ead150813f08b7dabc65";
const SUPPLIER_ADDRESS = "0xe54741e0417504b880ad218135d34b43b741f6a817afdbc56aef9b60c77648d4";
const ARBITRATOR_ADDRESS = "0x271479c44c572cf0027f02bea2fb566fd82986805ff1eb7d9d5788189b36a304";
const ESCROW = "0xdb20447fa02e9d6d80f02d69eaf0d01872f7ee6b35dc1eb0abe3b294b24e1708";
const FUNDING = "c9ddWRcRLnGNA7rXX9cTNsDBnDfURTj1QAb88Qrpmnt";
const DISPUTE = "GGrWRR4PRvpbXDkMV73EihnmcJffcqHGwgbYHDgjDxCN";
const SETTLEMENT = "DAgsvXPwdpMuLjPwJ3aWFRJ2pRtRLhpvvv7RAC7MBkwv";
const RECEIPT = "0x98a1ad775d3ffa34cc90d9541bfd6f69a4d29bb16e2b8ea7298de66b5eac7775";
const ORDER_HASH = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const PROPOSAL_HASH = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=";

function tx(digest: string, events: any[], changedObjects: any[], objectTypes: Record<string, string> = {}) {
  return {
    Transaction: {
      digest,
      status: { success: true, error: null },
      checkpoint: "42",
      effects: { changedObjects },
      events,
      objectTypes,
    },
  };
}

function event(type: string, sender: string, json: Record<string, unknown>) {
  return { packageId: PACKAGE, eventType: type, sender, json };
}

function validFixture() {
  const escrowType = `${PACKAGE}::escrow::Escrow<${ASSET}>`;
  const receiptType = `${PACKAGE}::escrow::SettlementReceipt<${ASSET}>`;
  const createdType = `${PACKAGE}::escrow::EscrowCreated<${ASSET}>`;
  const openedType = `${PACKAGE}::escrow::DisputeOpened<${ASSET}>`;
  const executedType = `${PACKAGE}::escrow::SettlementExecuted<${ASSET}>`;
  const fundingTx = tx(FUNDING, [event(createdType, BUYER_ADDRESS, {
    escrow_id: ESCROW, buyer: BUYER_ADDRESS, supplier: SUPPLIER_ADDRESS, arbitrator: ARBITRATOR_ADDRESS,
    amount: "100000", order_hash: ORDER_HASH, order_reference: "ORDER-100",
  })], [{ objectId: ESCROW, idOperation: "Created" }], { [ESCROW]: escrowType });
  const disputeTx = tx(DISPUTE, [event(openedType, BUYER_ADDRESS, {
    escrow_id: ESCROW, disputed_amount: "30000", requested_buyer_refund: "20000",
  })], []);
  const settlementTx = tx(SETTLEMENT, [event(executedType, ARBITRATOR_ADDRESS, {
    escrow_id: ESCROW, receipt_id: RECEIPT, buyer: BUYER_ADDRESS, supplier: SUPPLIER_ADDRESS,
    buyer_refund: "12000", supplier_release: "18000", proposal_hash: PROPOSAL_HASH,
  })], [
    { objectId: ESCROW, idOperation: "Deleted" },
    { objectId: RECEIPT, idOperation: "Created" },
  ], { [RECEIPT]: receiptType });
  const receipt = {
    object: {
      objectId: RECEIPT,
      type: receiptType,
      owner: { $kind: "Shared", Shared: { initialSharedVersion: "7" } },
      previousTransaction: SETTLEMENT,
      json: {
        id: RECEIPT, escrow_id: ESCROW, buyer: BUYER_ADDRESS, supplier: SUPPLIER_ADDRESS,
        buyer_refund: "12000", supplier_release: "18000", order_hash: ORDER_HASH,
        proposal_hash: PROPOSAL_HASH,
      },
    },
  };
  const responses = new Map([[FUNDING, fundingTx], [DISPUTE, disputeTx], [SETTLEMENT, settlementTx]]);
  const reader: SuiSettlementReader = {
    getTransaction: async ({ digest }) => responses.get(digest),
    getObject: async () => receipt,
  };
  const dispute = openDispute(openInput({
    assetType: ASSET,
    onchainEscrow: {
      packageId: PACKAGE, escrowObjectId: ESCROW, fundingTransactionDigest: FUNDING,
      disputeTransactionDigest: DISPUTE, buyerAddress: BUYER_ADDRESS,
      supplierAddress: SUPPLIER_ADDRESS, arbitratorAddress: ARBITRATOR_ADDRESS,
    },
  }), buyer, controlledContext().ctx);
  dispute.status = "settlement_pending";
  dispute.settlement = {
    buyerUnits: "12000",
    supplierUnits: "18000",
    source: "mutual_proposal",
    proposalId: "00000000-0000-4000-8000-000000000099",
    agreementId: "00000000-0000-4000-8000-000000000098",
    evidenceBundleHash: "a".repeat(64),
    agreedAt: "2026-08-31T00:00:00.000Z",
    executionStatus: "pending_on_chain",
  };
  return { reader, dispute, proof: { transactionDigest: SETTLEMENT, packageId: PACKAGE, escrowObjectId: ESCROW, receiptObjectId: RECEIPT } };
}

describe("Sui settlement verifier", () => {
  it("verifies the complete escrow lifecycle and exact allocation", async () => {
    const fixture = validFixture();
    const verifier = new GrpcSuiSettlementVerifier({ packageId: PACKAGE, client: fixture.reader });
    await expect(verifier.verify(fixture.dispute, fixture.proof)).resolves.toMatchObject({
      transactionDigest: SETTLEMENT, packageId: PACKAGE, escrowObjectId: ESCROW, receiptObjectId: RECEIPT, checkpoint: "42",
    });
  });

  it("rejects a proof whose escrow is not bound to the dispute", async () => {
    const fixture = validFixture();
    const verifier = new GrpcSuiSettlementVerifier({ packageId: PACKAGE, client: fixture.reader });
    await expect(verifier.verify(fixture.dispute, { ...fixture.proof, escrowObjectId: "0x9999999999999999999999999999999999999999999999999999999999999999" })).rejects.toMatchObject({ code: "SUI_VERIFICATION_FAILED" });
  });

  it("rejects a receipt changed by a different transaction", async () => {
    const fixture = validFixture();
    const verifier = new GrpcSuiSettlementVerifier({
      packageId: PACKAGE,
      client: { ...fixture.reader, getObject: async () => ({ object: { ...(await fixture.reader.getObject({ objectId: RECEIPT, include: {} })).object, previousTransaction: "other" } }) },
    });
    await expect(verifier.verify(fixture.dispute, fixture.proof)).rejects.toMatchObject({ code: "SUI_VERIFICATION_FAILED" });
  });

  it("rejects a valid on-chain split that differs from the off-chain agreement", async () => {
    const fixture = validFixture();
    fixture.dispute.settlement = {
      ...fixture.dispute.settlement!,
      buyerUnits: "11000",
      supplierUnits: "19000",
    };
    const verifier = new GrpcSuiSettlementVerifier({ packageId: PACKAGE, client: fixture.reader });
    await expect(verifier.verify(fixture.dispute, fixture.proof)).rejects.toMatchObject({ code: "SUI_VERIFICATION_FAILED" });
  });

  it("requires an on-chain binding before allowing settlement confirmation", async () => {
    const fixture = validFixture();
    const noBinding = { ...fixture.dispute, onchainEscrow: undefined };
    const verifier = new GrpcSuiSettlementVerifier({ packageId: PACKAGE, client: fixture.reader });
    await expect(verifier.verify(noBinding, fixture.proof)).rejects.toMatchObject({ code: "ONCHAIN_BINDING_REQUIRED" });
  });
});

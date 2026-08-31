import { randomUUID } from "node:crypto";
import { createApp, type TokenVerifier } from "../src/api/app.js";
import { openDispute } from "../src/domain/dispute-machine.js";
import type { Actor, DomainContext } from "../src/domain/types.js";
import { config } from "../src/config.js";
import { createSuiSettlementVerifier } from "../src/integrations/sui-settlement.js";
import { DisputeService } from "../src/service/dispute-service.js";
import { MemoryDisputeStore } from "../src/store/store.js";

const PACKAGE = process.env.SUI_LIVE_PACKAGE_ID ?? config.suiEscrowPackageId;
const ESCROW = process.env.SUI_LIVE_ESCROW_OBJECT_ID ?? "0xdb20447fa02e9d6d80f02d69eaf0d01872f7ee6b35dc1eb0abe3b294b24e1708";
const FUNDING = process.env.SUI_LIVE_FUNDING_DIGEST ?? "c9ddWRcRLnGNA7rXX9cTNsDBnDfURTj1QAb88Qrpmnt";
const DISPUTE = process.env.SUI_LIVE_DISPUTE_DIGEST ?? "GGrWRR4PRvpbXDkMV73EihnmcJffcqHGwgbYHDgjDxCN";
const SETTLEMENT = process.env.SUI_LIVE_SETTLEMENT_DIGEST ?? "DAgsvXPwdpMuLjPwJ3aWFRJ2pRtRLhpvvv7RAC7MBkwv";
const RECEIPT = process.env.SUI_LIVE_RECEIPT_OBJECT_ID ?? "0x98a1ad775d3ffa34cc90d9541bfd6f69a4d29bb16e2b8ea7298de66b5eac7775";
const BUYER_ADDRESS = process.env.SUI_LIVE_BUYER_ADDRESS ?? "0x97244cf38ff9fd4da3cd8a64723d0733e446f58363a6ead150813f08b7dabc65";
const SUPPLIER_ADDRESS = process.env.SUI_LIVE_SUPPLIER_ADDRESS ?? "0xe54741e0417504b880ad218135d34b43b741f6a817afdbc56aef9b60c77648d4";
const ARBITRATOR_ADDRESS = process.env.SUI_LIVE_ARBITRATOR_ADDRESS ?? "0x271479c44c572cf0027f02bea2fb566fd82986805ff1eb7d9d5788189b36a304";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const ARBITRATOR_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_REFERENCE = "ORDER-LIVE-1";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function jsonRequest(app: ReturnType<typeof createApp>, path: string, token: string, body?: unknown) {
  const response = await app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, any>;
  return { response, payload };
}

if (config.suiNetwork !== "testnet") {
  throw new Error(`Live Sui smoke test is pinned to testnet; SUI_NETWORK is ${config.suiNetwork}`);
}

const ctx: DomainContext = { now: () => new Date(), id: randomUUID };
const tokenVerifier: TokenVerifier = { verify: async (token): Promise<Actor> => ({ id: token }) };
const service = new DisputeService(new MemoryDisputeStore(), ctx);
const settlementVerifier = createSuiSettlementVerifier({
  packageId: PACKAGE,
  network: config.suiNetwork,
  baseUrl: config.suiRpcUrl,
});
const app = createApp(service, tokenVerifier, undefined, undefined, settlementVerifier);
const disputeId = randomUUID();

const opened = await jsonRequest(app, "/v1/disputes", BUYER_ID, {
  id: disputeId,
  orderId: ORDER_REFERENCE,
  buyerId: BUYER_ID,
  supplierId: SUPPLIER_ID,
  arbitratorId: ARBITRATOR_ID,
  assetType: "0x2::sui::SUI",
  totalEscrowUnits: "10000000",
  disputedUnits: "3000000",
  requestedBuyerUnits: "2000000",
  claim: "Live testnet escrow lifecycle",
  tradeTerms: { orderReference: ORDER_REFERENCE, description: "Testnet industrial pump", governingLaw: "Malaysia" },
  negotiationDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  evidenceStatement: "Buyer evidence statement",
  onchainEscrow: {
    packageId: PACKAGE,
    escrowObjectId: ESCROW,
    fundingTransactionDigest: FUNDING,
    disputeTransactionDigest: DISPUTE,
    buyerAddress: BUYER_ADDRESS,
    supplierAddress: SUPPLIER_ADDRESS,
    arbitratorAddress: ARBITRATOR_ADDRESS,
  },
});
assert(opened.response.status === 201, `Opening dispute failed (${opened.response.status})`);

const responded = await jsonRequest(app, `/v1/disputes/${disputeId}/supplier-response`, SUPPLIER_ID, {
  agrees: false,
  statement: "Supplier counter-evidence for the live testnet case",
});
assert(responded.response.status === 200, `Supplier response failed (${responded.response.status})`);

const proposed = await jsonRequest(app, `/v1/disputes/${disputeId}/proposals`, BUYER_ID, {
  buyerUnits: "1200000",
  supplierUnits: "1800000",
  summary: "Proportionate live testnet allocation",
});
assert(proposed.response.status === 200, `Proposal failed (${proposed.response.status})`);
const proposalId = proposed.payload.proposals?.at(-1)?.id;
assert(typeof proposalId === "string", "The live proposal ID was not returned");

const buyerAccepted = await jsonRequest(app, `/v1/disputes/${disputeId}/proposals/${proposalId}/accept`, BUYER_ID);
assert(buyerAccepted.response.status === 200, `Buyer acceptance failed (${buyerAccepted.response.status})`);
const supplierAccepted = await jsonRequest(app, `/v1/disputes/${disputeId}/proposals/${proposalId}/accept`, SUPPLIER_ID);
assert(supplierAccepted.response.status === 200, `Supplier acceptance failed (${supplierAccepted.response.status})`);
assert(supplierAccepted.payload.status === "settlement_pending", "The agreement did not enter settlement_pending");

const executed = await jsonRequest(app, `/v1/disputes/${disputeId}/settlement-execution`, BUYER_ID, {
  transactionDigest: SETTLEMENT,
  packageId: PACKAGE,
  escrowObjectId: ESCROW,
  receiptObjectId: RECEIPT,
});
assert(executed.response.status === 200, `Settlement verification failed (${executed.response.status})`);
assert(executed.payload.status === "settled", "Verified execution did not settle the dispute");
assert(executed.payload.settlement?.executionStatus === "verified_on_chain", "Execution was not marked verified_on_chain");

console.log(JSON.stringify({
  route: "settlement-execution",
  status: executed.payload.status,
  executionStatus: executed.payload.settlement.executionStatus,
  transactionDigest: executed.payload.settlement.execution.transactionDigest,
  receiptObjectId: executed.payload.settlement.execution.receiptObjectId,
  checkpoint: executed.payload.settlement.execution.checkpoint,
}));

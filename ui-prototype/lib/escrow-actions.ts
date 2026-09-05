"use client";

import { CurrentAccountSigner, useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { useEffect, useState } from "react";
import { clearZkLoginSession, loadZkLoginSession, zkLoginSessionExpired, zkLoginSigner, type ZkLoginSession } from "@/lib/auth";
import type { DocumentKind, InspectionLine } from "@/lib/demo-orders";
import { confirmClaimExecution, disputeToClaim, type DisputeRecord, type EvidenceFileInput } from "@/lib/dispute-actions";
import { acceptLiveDelivery, settleLiveDeadline, toUnits, viewLiveOrder } from "@/lib/live-orders";
import { apiRequest, type TradeOrder } from "@/lib/payproof-api";
import { DEFAULT_ARBITRATOR_ADDRESS, ESCROW_PACKAGE_ID } from "@/lib/sui-dapp-kit";

/** Inspection window written into every escrow, matching DP-2.1 of the Dispute Resolution Policy. */
export const INSPECTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Evidence kinds as the contract records them. */
const EVIDENCE_KIND: Record<DocumentKind, number> = {
  internal_agreement: 0, purchase_order: 1, dispatch_evidence: 2, delivery_evidence: 3, inspection_evidence: 4, claim_evidence: 5,
};

function hexBytes(value: string, what = "The order hash"): number[] {
  const clean = value.replace(/^0x/, "");
  if (!/^[a-f\d]{64}$/i.test(clean)) throw new Error(`${what} must contain 32 bytes`);
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16));
}

function eventJson(value: unknown): Record<string, unknown> {
  const event = value as { json?: Record<string, unknown>; parsedJson?: Record<string, unknown> } | undefined;
  return event?.json ?? event?.parsedJson ?? {};
}

const packageOf = (order: TradeOrder) => order.funding?.packageId || ESCROW_PACKAGE_ID;

async function proposalHashBytes(proposalId: string): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proposalId));
  return Array.from(new Uint8Array(digest));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failed(result: any, fallback: string): void {
  if (result.FailedTransaction) throw new Error(result.FailedTransaction.status?.error?.message ?? fallback);
}

/** The delivery deadline the escrow enforces: end of the agreed delivery date in Malaysia, and
 *  never less than a day away so a same-day order can still be funded. */
export function deliveryDeadlineMs(deliveryDate: string, now = Date.now()): number {
  const endOfDay = Date.parse(`${deliveryDate}T23:59:59+08:00`);
  const floor = now + 24 * 60 * 60 * 1000;
  return Number.isFinite(endOfDay) && endOfDay > floor ? endOfDay : floor;
}

export type ClaimInput = {
  disputedValue: number; requestedValue: number; claim: string; evidence: string; files?: EvidenceFileInput[];
  inspection?: { lines: InspectionLine[]; note?: string };
};

/** A payment request as encoded in a merchant's QR code. */
export type PaymentRequest = {
  v: 1;
  network: "sui:testnet";
  to: string;
  merchant: string;
  amount: string;
  currency: string;
  coinType: string;
  reference: string;
  session: string;
};

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

/** Parses the text behind a payment QR and rejects anything that is not a well-formed request. */
export function parsePaymentRequest(text: string): PaymentRequest {
  let raw: Partial<PaymentRequest>;
  try { raw = JSON.parse(text.trim()) as Partial<PaymentRequest>; } catch { throw new Error("That is not a PayProof payment request."); }
  if (raw.v !== 1 || raw.network !== "sui:testnet") throw new Error("This payment request is for a different network or version.");
  if (typeof raw.to !== "string" || !SUI_ADDRESS.test(raw.to)) throw new Error("The payment request has no valid recipient address.");
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("The payment request has no valid amount.");
  if (typeof raw.coinType !== "string" || !raw.coinType.includes("::")) throw new Error("The payment request has no valid coin type.");
  const reference = String(raw.reference ?? "").trim();
  if (!reference || new TextEncoder().encode(reference).length > 128) throw new Error("The payment reference must be between 1 and 128 bytes.");
  return {
    v: 1, network: "sui:testnet", to: raw.to, merchant: String(raw.merchant ?? "").slice(0, 120), amount: String(raw.amount), currency: String(raw.currency ?? ""),
    coinType: raw.coinType, reference, session: String(raw.session ?? "").slice(0, 64),
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Every escrow action that needs a Sui signature. Uses the zkLogin session
 * when present, otherwise the connected wallet.
 */
export function useEscrowActions() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const [zkSession, setZkSession] = useState<ZkLoginSession | null>(null);
  useEffect(() => { setZkSession(loadZkLoginSession()); }, []);
  const signingAddress = zkSession?.address ?? account?.address;

  const ABORTS: Array<{ fn: string; code: number; message: string }> = [
    { fn: "open_dispute", code: 5, message: "Sui already has a dispute on this escrow, but its transaction could not be read back, so the claim was not recorded. Refresh and try again." },
    { fn: "release_full", code: 5, message: "This escrow was already released on Sui, so the delivery cannot be accepted again. This order is behind the chain." },
    { fn: "mark_shipped", code: 8, message: "Shipment was already marked on Sui for this order. This order is behind the chain." },
    { fn: "refund_unshipped", code: 8, message: "The supplier has marked shipment on Sui, so the escrow can no longer be reclaimed as unshipped." },
    { fn: "refund_unshipped", code: 16, message: "The delivery deadline written into the escrow has not passed yet." },
    { fn: "claim_uninspected", code: 16, message: "The inspection window written into the escrow has not closed yet." },
    { fn: "claim_uninspected", code: 17, message: "Shipment was never marked on Sui, so the escrow cannot be claimed as uninspected." },
    { fn: "execute_settlement", code: 5, message: "This settlement was already executed on Sui. This order is behind the chain." },
  ];

  /** The dispute already on chain, when an earlier attempt committed but was never recorded here.
   *  Returns the real transaction digest so the claim is recorded against a signature that exists,
   *  never a fabricated one. Undefined when the chain does not actually show a dispute. */
  async function disputeAlreadyOnChain(escrowObjectId: string): Promise<string | undefined> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const object = (await (client as any).core.getObject({ objectId: escrowObjectId, include: { previousTransaction: true } })) as any;
      const digest = object?.object?.previousTransaction as string | undefined;
      if (!digest) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const indexed = (await (client as any).core.getTransaction({ digest, include: { events: true, effects: true } })) as any;
      const tx = indexed?.Transaction;
      if (tx?.status?.success !== true) return undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opened = (tx.events ?? []).find((event: any) =>
        String(event.eventType ?? "").includes("::escrow::DisputeOpened")
        && String(eventJson(event).escrow_id ?? "") === escrowObjectId);
      return opened ? digest : undefined;
    } catch {
      return undefined;
    }
  }

  /** Signs, and turns a known Move abort into something a person can act on. */
  async function sign(transaction: Transaction) {
    try {
      return await signAndExecute(transaction);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      const known = ABORTS.find((entry) => text.includes(entry.fn) && new RegExp(`abort code: ${entry.code}\\b`).test(text));
      throw known ? new Error(known.message) : cause;
    }
  }

  /** Every transaction is sponsored. Enoki pays the gas from the app's allowance and the user
   *  only signs, so no party ever needs SUI of their own. There is no unsponsored path. */
  async function signAndExecute(transaction: Transaction) {
    if (!signingAddress) throw new Error("Sign in before signing a transaction.");
    if (zkSession && await zkLoginSessionExpired(zkSession)) {
      clearZkLoginSession();
      setZkSession(null);
      throw new Error("Your Google sign-in has expired. Sign in again, then retry this step.");
    }
    // coinWithBalance resolves the payment from the signer's coins, so it needs the sender
    // before the build. Sponsorship still sets the real sender on the server side.
    transaction.setSenderIfNotSet(signingAddress);
    const kind = await transaction.build({ client, onlyTransactionKind: true });
    const sponsored = await apiRequest<{ bytes: string; digest: string }>("/v1/sui/sponsor", {
      method: "POST",
      body: JSON.stringify({ transactionKindBytes: toBase64(kind), sender: signingAddress }),
    });
    // The kit's generic network typing does not match the signer's, but the instance is the same.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = zkSession ? zkLoginSigner(zkSession) : new CurrentAccountSigner(dAppKit as any);
    const { signature } = await signer.signTransaction(fromBase64(sponsored.bytes));
    await apiRequest(`/v1/sui/sponsor/${encodeURIComponent(sponsored.digest)}/execute`, {
      method: "POST",
      body: JSON.stringify({ signature }),
    });
    return await wait(sponsored.digest);
  }

  async function wait(digest: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await client.waitForTransaction({ digest, include: { events: true, effects: true, objectTypes: true }, timeout: 60_000, pollSchedule: [0, 500, 1_000, 2_000] })) as any;
  }

  function requireSigner(message: string) {
    if (!signingAddress) throw new Error(message);
  }

  /** Signs a transaction and returns its digest once indexed. */
  async function signed(tx: Transaction, fallback: string): Promise<{ digest: string; indexed: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, fallback);
    const digest = result.Transaction.digest as string;
    const indexed = await wait(digest);
    return { digest, indexed };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function receiptIdOf(indexed: any): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executed = (indexed.Transaction?.events ?? []).find((event: any) => String(event.eventType ?? "").includes("::escrow::SettlementExecuted"));
    const fromEvent = String(eventJson(executed).receipt_id ?? "");
    if (fromEvent && fromEvent !== "undefined") return fromEvent;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt = (indexed.Transaction?.effects?.changedObjects ?? []).find((change: any) => change.idOperation === "Created" && String(change.objectType ?? "").includes("::escrow::SettlementReceipt"));
    return receipt?.objectId ? String(receipt.objectId) : undefined;
  }

  async function fundEscrow(order: TradeOrder): Promise<TradeOrder> {
    requireSigner("Sign in with Google or connect a Sui wallet before funding escrow.");
    if (!order.supplierId || !order.buyerId) throw new Error("Both parties must confirm the order before it can be funded.");
    if (!order.supplierWalletAddress) throw new Error("The supplier has not attached a payout address yet.");
    // Orders created before the arbitrator wallet was recorded fall back to the configured arbitrator.
    const arbitrator = order.arbitratorWalletAddress || DEFAULT_ARBITRATOR_ADDRESS;
    const deadline = deliveryDeadlineMs(order.deliveryDate);
    const tx = new Transaction();
    // Enoki owns the gas coin, so the payment must come from the buyer's own coins.
    const paymentCoin = tx.coin({ balance: BigInt(order.amountUnits), type: order.assetType, useGasCoin: false });
    const releasePlan = order.releasePlan;
    const packageId = ESCROW_PACKAGE_ID;
    tx.moveCall({
      target: `${packageId}::escrow::${releasePlan ? "create_with_milestones" : "create"}`,
      typeArguments: [order.assetType],
      arguments: [
        paymentCoin, tx.pure.address(order.supplierWalletAddress), tx.pure.address(arbitrator), tx.pure.vector("u8", hexBytes(order.orderHash)), tx.pure.string(order.reference),
        ...(releasePlan ? [tx.pure.u64(releasePlan.depositUnits), tx.pure.u64(releasePlan.dispatchUnits), tx.pure.u64(releasePlan.deliveryUnits)] : []),
        tx.pure.u64(deadline), tx.pure.u64(INSPECTION_WINDOW_MS), tx.object.clock(),
      ],
    });
    const { digest, indexed } = await signed(tx, "The escrow funding transaction failed.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (indexed.Transaction?.events ?? []).find((event: any) => String(event.eventType ?? "").includes("::escrow::EscrowCreated"));
    const objectId = String(eventJson(created).escrow_id ?? "");
    if (!objectId || objectId === "undefined") throw new Error("Escrow funded, but the EscrowCreated event was not indexed yet. Refresh and try again.");
    try {
      return await apiRequest<TradeOrder>(`/v1/orders/${order.id}/funding`, {
        method: "POST",
        body: JSON.stringify({
          packageId, escrowObjectId: objectId, transactionDigest: digest, buyerAddress: signingAddress, supplierAddress: order.supplierWalletAddress, arbitratorAddress: arbitrator,
          deliveryDeadlineMs: deadline, inspectionWindowMs: INSPECTION_WINDOW_MS,
        }),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Your funds are secured on Sui in escrow ${objectId}, transaction ${digest}, but recording it here failed: ${reason}. Do not fund again, that would lock a second payment. Keep these two references.`);
    }
  }

  /** Supplier marks shipment on the escrow. A dispatch document's hash rides in the same transaction. */
  async function markShipped(order: TradeOrder, evidenceSha256?: string): Promise<string> {
    requireSigner("Sign in with Google or connect the supplier wallet before marking shipment.");
    if (!order.funding) throw new Error("Only a funded order can be shipped.");
    if (!evidenceSha256) throw new Error("Attach a carrier receipt or dispatch note before releasing the dispatch payment.");
    const tx = new Transaction();
    if (order.releasePlan) {
      tx.moveCall({
        target: `${packageOf(order)}::escrow::mark_shipped_and_release`, typeArguments: [order.assetType],
        arguments: [tx.object(order.funding.escrowObjectId), tx.pure.vector("u8", hexBytes(evidenceSha256, "The evidence hash")), tx.object.clock()],
      });
    } else {
      tx.moveCall({ target: `${packageOf(order)}::escrow::mark_shipped`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
      tx.moveCall({ target: `${packageOf(order)}::escrow::anchor_evidence`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u8(EVIDENCE_KIND.dispatch_evidence), tx.pure.vector("u8", hexBytes(evidenceSha256, "The evidence hash")), tx.object.clock()] });
    }
    const { digest } = await signed(tx, "The shipment transaction failed.");
    return digest;
  }

  /** Either party binds a file's SHA-256 to the escrow. Returns the transaction to record with the upload. */
  async function anchorEvidence(order: TradeOrder, kind: DocumentKind, sha256Hex: string): Promise<string> {
    requireSigner("Sign in before anchoring evidence.");
    if (!order.funding) throw new Error("Evidence can only be anchored to a funded order.");
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageOf(order)}::escrow::anchor_evidence`, typeArguments: [order.assetType],
      arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u8(EVIDENCE_KIND[kind] ?? 5), tx.pure.vector("u8", hexBytes(sha256Hex, "The evidence hash")), tx.object.clock()],
    });
    const { digest } = await signed(tx, "The evidence anchoring transaction failed.");
    return digest;
  }

  /** Buyer releases the whole escrow to the supplier after accepting the delivery in full. */
  async function acceptDelivery(order: TradeOrder, inspection?: { lines: InspectionLine[]; note?: string }) {
    requireSigner("Sign in with Google or connect the buyer wallet before releasing payment.");
    if (!order.funding) throw new Error("Only a funded order can be accepted.");
    const tx = new Transaction();
    tx.moveCall({ target: `${packageOf(order)}::escrow::release_full`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    const { digest, indexed } = await signed(tx, "The release transaction failed.");
    return acceptLiveDelivery(order.id, { transactionDigest: digest, receiptObjectId: receiptIdOf(indexed), inspection });
  }

  /** The claim transaction locks only the disputed value; the contract pays the rest to the supplier in the same call. */
  async function openClaim(order: TradeOrder, input: ClaimInput) {
    requireSigner("Sign in with Google or connect the buyer wallet before opening a claim.");
    if (!order.funding) throw new Error("Only a funded order can be disputed.");
    const disputedUnits = toUnits(input.disputedValue, order.assetType);
    const requestedUnits = toUnits(input.requestedValue, order.assetType);
    const tx = new Transaction();
    tx.moveCall({ target: `${packageOf(order)}::escrow::open_dispute`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u64(disputedUnits), tx.pure.u64(requestedUnits), tx.object.clock()] });
    let digest: string;
    try {
      digest = (await signed(tx, "The claim transaction failed.")).digest;
    } catch (cause) {
      // The escrow may already be disputed because an earlier attempt committed on Sui and then
      // failed to record here. That signature is valid, so record it rather than asking for another.
      const existing = await disputeAlreadyOnChain(order.funding.escrowObjectId);
      if (!existing) throw cause;
      digest = existing;
    }
    const response = await apiRequest<{ order: TradeOrder; dispute: DisputeRecord }>(`/v1/orders/${order.id}/dispute`, {
      method: "POST",
      body: JSON.stringify({
        disputeTransactionDigest: digest, disputedUnits, requestedBuyerUnits: requestedUnits,
        claim: input.claim, evidenceStatement: input.evidence, evidenceFiles: input.files,
        negotiationDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), maxHumanRounds: 3,
        inspection: input.inspection ? { lines: input.inspection.lines.map((line) => ({ lineId: line.lineId, accepted: String(line.accepted), missing: String(line.missing), damaged: String(line.damaged) })), note: input.inspection.note } : undefined,
      }),
    });
    return { order: await viewLiveOrder(response.order), claim: disputeToClaim(response.dispute) };
  }

  /** Buyer takes the whole escrow back: the supplier never marked shipment and the delivery deadline passed. */
  async function refundUnshipped(order: TradeOrder) {
    requireSigner("Sign in with Google or connect the buyer wallet before reclaiming the escrow.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({ target: `${packageOf(order)}::escrow::refund_unshipped`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    const { digest, indexed } = await signed(tx, "The refund transaction failed.");
    return settleLiveDeadline(order.id, { kind: "refund_unshipped", transactionDigest: digest, receiptObjectId: receiptIdOf(indexed) });
  }

  /** Supplier claims the whole escrow: shipment was marked and the buyer let the inspection window close. */
  async function claimUninspected(order: TradeOrder) {
    requireSigner("Sign in with Google or connect the supplier wallet before claiming the escrow.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({ target: `${packageOf(order)}::escrow::claim_uninspected`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    const { digest, indexed } = await signed(tx, "The claim transaction failed.");
    return settleLiveDeadline(order.id, { kind: "claim_uninspected", transactionDigest: digest, receiptObjectId: receiptIdOf(indexed) });
  }

  /** One party signs the agreed allocation on Sui. */
  async function approveSettlement(order: TradeOrder, side: "buyer" | "supplier", allocation: { buyerValue: number; supplierValue: number; proposalId: string }): Promise<string> {
    requireSigner("Connect the wallet for the approving party first.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageOf(order)}::escrow::approve_${side}`, typeArguments: [order.assetType],
      arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u64(toUnits(allocation.buyerValue, order.assetType)), tx.pure.u64(toUnits(allocation.supplierValue, order.assetType)), tx.pure.vector("u8", await proposalHashBytes(allocation.proposalId))],
    });
    const { digest } = await signed(tx, "The approval transaction failed.");
    return digest;
  }

  async function executeSettlement(order: TradeOrder, disputeId: string) {
    requireSigner("Connect a wallet before executing the settlement.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({ target: `${packageOf(order)}::escrow::execute_settlement`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    const { digest, indexed } = await signed(tx, "The settlement transaction failed.");
    const receipt = receiptIdOf(indexed);
    if (!receipt) throw new Error("Settlement executed, but its receipt event was not indexed yet. Refresh and try again.");
    return confirmClaimExecution(disputeId, { transactionDigest: digest, packageId: packageOf(order), escrowObjectId: order.funding.escrowObjectId, receiptObjectId: receipt });
  }

  /** Pays a merchant's request directly, outside any escrow, and keeps an on-chain receipt bound to
   *  the request's hash. The merchant can recompute the hash from the same request to match it. */
  async function payRequest(request: PaymentRequest): Promise<{ digest: string; receiptObjectId?: string; requestHash: string }> {
    requireSigner("Sign in with Google or connect a Sui wallet before paying.");
    if (request.to.toLowerCase() === signingAddress?.toLowerCase()) throw new Error("This request is addressed to your own wallet.");
    const canonical = JSON.stringify({ v: request.v, network: request.network, to: request.to, merchant: request.merchant, amount: request.amount, currency: request.currency, coinType: request.coinType, reference: request.reference, session: request.session });
    const requestHash = await sha256Hex(canonical);
    const units = toUnits(Number(request.amount), request.coinType);
    if (BigInt(units) <= 0n) throw new Error("The amount is below the smallest unit of this coin.");
    const tx = new Transaction();
    const payment = tx.coin({ balance: BigInt(units), type: request.coinType, useGasCoin: false });
    tx.moveCall({
      target: `${ESCROW_PACKAGE_ID}::payproof::pay`, typeArguments: [request.coinType],
      arguments: [payment, tx.pure.address(request.to), tx.pure.vector("u8", hexBytes(requestHash, "The request hash")), tx.pure.string(request.reference), tx.object.clock()],
    });
    const { digest, indexed } = await signed(tx, "The payment failed.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt = (indexed.Transaction?.effects?.changedObjects ?? []).find((change: any) => change.idOperation === "Created" && String(change.objectType ?? "").includes("::payproof::PaymentReceipt"));
    return { digest, receiptObjectId: receipt?.objectId ? String(receipt.objectId) : undefined, requestHash };
  }

  return { signingAddress, hasZkLogin: Boolean(zkSession), fundEscrow, markShipped, anchorEvidence, acceptDelivery, openClaim, refundUnshipped, claimUninspected, approveSettlement, executeSettlement, payRequest };
}

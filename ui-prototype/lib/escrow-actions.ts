"use client";

import { CurrentAccountSigner, useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { useEffect, useState } from "react";
import { clearZkLoginSession, loadZkLoginSession, zkLoginSessionExpired, zkLoginSigner, type ZkLoginSession } from "@/lib/auth";
import type { InspectionLine } from "@/lib/demo-orders";
import { confirmClaimExecution, disputeToClaim, type DisputeRecord, type EvidenceFileInput } from "@/lib/dispute-actions";
import { acceptLiveDelivery, toUnits, viewLiveOrder } from "@/lib/live-orders";
import { apiRequest, type TradeOrder } from "@/lib/payproof-api";
import { DEFAULT_ARBITRATOR_ADDRESS, ESCROW_PACKAGE_ID } from "@/lib/sui-dapp-kit";

function hexBytes(value: string): number[] {
  const clean = value.replace(/^0x/, "");
  if (!/^[a-f\d]{64}$/i.test(clean)) throw new Error("The order hash must contain 32 bytes");
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16));
}

function eventJson(value: unknown): Record<string, unknown> {
  const event = value as { json?: Record<string, unknown>; parsedJson?: Record<string, unknown> } | undefined;
  return event?.json ?? event?.parsedJson ?? {};
}

async function proposalHashBytes(proposalId: string): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proposalId));
  return Array.from(new Uint8Array(digest));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failed(result: any, fallback: string): void {
  if (result.FailedTransaction) throw new Error(result.FailedTransaction.status?.error?.message ?? fallback);
}

export type ClaimInput = {
  disputedValue: number; requestedValue: number; claim: string; evidence: string; files?: EvidenceFileInput[];
  inspection?: { lines: InspectionLine[]; note?: string };
};

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
    { fn: "release_undisputed", code: 8, message: "The undisputed amount was already released on Sui. This order is behind the chain." },
    { fn: "release_undisputed", code: 5, message: "Sui does not have this escrow in a disputed state, so there is no undisputed amount to release." },
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
      const known = ABORTS.find((entry) => text.includes(entry.fn) && new RegExp(`abort code: ${entry.code}\b`).test(text));
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

  async function fundEscrow(order: TradeOrder): Promise<TradeOrder> {
    requireSigner("Sign in with Google or connect a Sui wallet before funding escrow.");
    if (!order.supplierId || !order.buyerId) throw new Error("Both parties must confirm the order before it can be funded.");
    if (!order.supplierWalletAddress) throw new Error("The supplier has not attached a payout address yet.");
    // Orders created before the arbitrator wallet was recorded fall back to the configured arbitrator.
    const arbitrator = order.arbitratorWalletAddress || DEFAULT_ARBITRATOR_ADDRESS;
    const tx = new Transaction();
    const paymentCoin = tx.coin({ balance: BigInt(order.amountUnits), type: order.assetType });
    tx.moveCall({
      target: `${ESCROW_PACKAGE_ID}::escrow::create`,
      typeArguments: [order.assetType],
      arguments: [paymentCoin, tx.pure.address(order.supplierWalletAddress), tx.pure.address(arbitrator), tx.pure.vector("u8", hexBytes(order.orderHash)), tx.pure.string(order.reference), tx.object.clock()],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, "The escrow funding transaction failed.");
    const digest = result.Transaction.digest as string;
    const indexed = await wait(digest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (indexed.Transaction?.events ?? []).find((event: any) => String(event.eventType ?? "").includes("::escrow::EscrowCreated"));
    const objectId = String(eventJson(created).escrow_id ?? "");
    if (!objectId || objectId === "undefined") throw new Error("Escrow funded, but the EscrowCreated event was not indexed yet. Refresh and try again.");
    try {
      return await apiRequest<TradeOrder>(`/v1/orders/${order.id}/funding`, {
        method: "POST",
        body: JSON.stringify({ packageId: ESCROW_PACKAGE_ID, escrowObjectId: objectId, transactionDigest: digest, buyerAddress: signingAddress, supplierAddress: order.supplierWalletAddress, arbitratorAddress: arbitrator }),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Your funds are secured on Sui in escrow ${objectId}, transaction ${digest}, but recording it here failed: ${reason}. Do not fund again, that would lock a second payment. Keep these two references.`);
    }
  }

  /** Buyer releases the whole escrow to the supplier after accepting the delivery in full. */
  async function acceptDelivery(order: TradeOrder, inspection?: { lines: InspectionLine[]; note?: string }) {
    requireSigner("Sign in with Google or connect the buyer wallet before releasing payment.");
    if (!order.funding) throw new Error("Only a funded order can be accepted.");
    const tx = new Transaction();
    tx.moveCall({ target: `${ESCROW_PACKAGE_ID}::escrow::release_full`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, "The release transaction failed.");
    const digest = result.Transaction.digest as string;
    const indexed = await wait(digest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receipt = (indexed.Transaction?.effects?.changedObjects ?? []).find((change: any) => change.idOperation === "Created" && String(change.objectType ?? "").includes("::escrow::SettlementReceipt"));
    return acceptLiveDelivery(order.id, { transactionDigest: digest, receiptObjectId: receipt?.objectId ? String(receipt.objectId) : undefined, inspection });
  }

  async function openClaim(order: TradeOrder, input: ClaimInput) {
    requireSigner("Sign in with Google or connect the buyer wallet before opening a claim.");
    if (!order.funding) throw new Error("Only a funded order can be disputed.");
    const disputedUnits = toUnits(input.disputedValue);
    const requestedUnits = toUnits(input.requestedValue);
    const tx = new Transaction();
    tx.moveCall({ target: `${ESCROW_PACKAGE_ID}::escrow::open_dispute`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u64(disputedUnits), tx.pure.u64(requestedUnits), tx.object.clock()] });
    let digest: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await sign(tx)) as any;
      failed(result, "The claim transaction failed.");
      digest = result.Transaction.digest as string;
      await wait(digest);
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

  /** Supplier takes the accepted value out of escrow while the claim continues. */
  async function releaseUndisputed(order: TradeOrder): Promise<TradeOrder> {
    requireSigner("Connect the supplier wallet before releasing the undisputed amount.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({ target: `${ESCROW_PACKAGE_ID}::escrow::release_undisputed`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId)] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, "The undisputed release transaction failed.");
    const digest = result.Transaction.digest as string;
    await wait(digest);
    return apiRequest<TradeOrder>(`/v1/orders/${order.id}/undisputed-release`, { method: "POST", body: JSON.stringify({ transactionDigest: digest }) });
  }

  /** One party signs the agreed allocation on Sui. */
  async function approveSettlement(order: TradeOrder, side: "buyer" | "supplier", allocation: { buyerValue: number; supplierValue: number; proposalId: string }): Promise<string> {
    requireSigner("Connect the wallet for the approving party first.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({
      target: `${ESCROW_PACKAGE_ID}::escrow::approve_${side}`, typeArguments: [order.assetType],
      arguments: [tx.object(order.funding.escrowObjectId), tx.pure.u64(toUnits(allocation.buyerValue)), tx.pure.u64(toUnits(allocation.supplierValue)), tx.pure.vector("u8", await proposalHashBytes(allocation.proposalId))],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, "The approval transaction failed.");
    await wait(result.Transaction.digest);
    return result.Transaction.digest as string;
  }

  async function executeSettlement(order: TradeOrder, disputeId: string) {
    requireSigner("Connect a wallet before executing the settlement.");
    if (!order.funding) throw new Error("The order has no escrow funding.");
    const tx = new Transaction();
    tx.moveCall({ target: `${ESCROW_PACKAGE_ID}::escrow::execute_settlement`, typeArguments: [order.assetType], arguments: [tx.object(order.funding.escrowObjectId), tx.object.clock()] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await sign(tx)) as any;
    failed(result, "The settlement transaction failed.");
    const digest = result.Transaction.digest as string;
    const indexed = await wait(digest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executed = (indexed.Transaction?.events ?? []).find((event: any) => String(event.eventType ?? "").includes("::escrow::SettlementExecuted"));
    const receipt = String(eventJson(executed).receipt_id ?? "");
    if (!receipt) throw new Error("Settlement executed, but its receipt event was not indexed yet. Refresh and try again.");
    return confirmClaimExecution(disputeId, { transactionDigest: digest, packageId: ESCROW_PACKAGE_ID, escrowObjectId: order.funding.escrowObjectId, receiptObjectId: receipt });
  }

  return { signingAddress, hasZkLogin: Boolean(zkSession), fundEscrow, acceptDelivery, openClaim, releaseUndisputed, approveSettlement, executeSettlement };
}

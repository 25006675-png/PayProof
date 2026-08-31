import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  ASSETS,
  isPayProofPaymentRecordedType,
  isTrustedPayProofPackageId,
  NETWORK,
  PAYPROOF_PACKAGE_ID,
  explorerObjectUrl,
  explorerTransactionUrl,
  type AssetSymbol,
} from "../config";
import {
  calculateTotals,
  createProofPayload,
  downloadReceipt,
  eventBytesToHex,
  formatUnits,
  formatUsd,
  hashProofPayload,
  loadReceipts,
  newLineItem,
  parseUnits,
  saveReceipt,
  validateOrderDraft,
} from "../lib/order";
import type { OrderDraft, PayProofReceipt, ProofPayload } from "../types";

type Stage = "edit" | "review" | "signing" | "success";

const DEFAULT_ORDER: OrderDraft = {
  orderReference: `ORD-${new Date().getFullYear()}-`,
  recipient: "",
  customerName: "",
  lineItems: [newLineItem()],
  discount: "",
  taxRate: "",
  notes: "",
  asset: "USDC",
  settlementAmount: "0.00",
};

interface PaymentEventJson {
  receipt_id?: string;
  payer?: string;
  recipient?: string;
  amount?: string;
  paid_at_ms?: string;
  order_hash?: number[] | string;
  order_reference?: string;
}

interface PendingPayment {
  digest: string;
  amountUnits: bigint;
  proofPayload: ProofPayload;
  orderHash: { bytes: number[]; hex: string };
}

function shorten(value: string, lead = 6, tail = 4) {
  if (!value) return "Not connected";
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The payment could not be completed.";
  if (/rejected|denied|cancel/i.test(error.message)) {
    return "The wallet request was cancelled. No funds moved.";
  }
  if (/insufficient|balance/i.test(error.message)) {
    return "The wallet does not have enough funds for this payment and gas.";
  }
  return error.message;
}

export function PaymentWorkspace() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<OrderDraft>(DEFAULT_ORDER);
  const [stage, setStage] = useState<Stage>("edit");
  const [formError, setFormError] = useState("");
  const [receipt, setReceipt] = useState<PayProofReceipt | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [receipts, setReceipts] = useState<PayProofReceipt[]>(() =>
    loadReceipts(),
  );

  const totals = useMemo(() => calculateTotals(order), [order]);
  const asset = ASSETS[order.asset];

  useEffect(() => {
    if (order.asset === "USDC") {
      setOrder((current) => ({
        ...current,
        settlementAmount: (totals.totalCents / 100).toFixed(2),
      }));
    }
  }, [order.asset, totals.totalCents]);

  const balanceQuery = useQuery({
    queryKey: ["balance", NETWORK, account?.address, asset.coinType],
    enabled: Boolean(account),
    queryFn: () =>
      client.getBalance({
        owner: account!.address,
        coinType: asset.coinType,
      }),
    refetchInterval: 15_000,
  });

  const balance = balanceQuery.data
    ? formatUnits(balanceQuery.data.balance.balance, asset.decimals)
    : "0";

  function updateOrder<K extends keyof OrderDraft>(
    key: K,
    value: OrderDraft[K],
  ) {
    setOrder((current) => ({ ...current, [key]: value }));
    setFormError("");
  }

  function updateLineItem(
    id: string,
    key: "description" | "quantity" | "unitPrice",
    value: string | number,
  ) {
    updateOrder(
      "lineItems",
      order.lineItems.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    );
  }

  function validateOrder(): string | null {
    if (!account) return "Connect a wallet before reviewing the payment.";
    if (!PAYPROOF_PACKAGE_ID)
      return "The PayProof contract has not been published in this build.";
    const draftError = validateOrderDraft(order, totals);
    if (draftError) return draftError;
    if (balanceQuery.isLoading)
      return "Wait for the wallet balance check to finish.";
    if (balanceQuery.isError || !balanceQuery.data)
      return "The wallet balance could not be checked. Refresh it before continuing.";
    try {
      const units = parseUnits(order.settlementAmount, asset.decimals);
      if (units <= 0n) return "The settlement amount must be greater than zero.";
      if (balanceQuery.data && units > BigInt(balanceQuery.data.balance.balance)) {
        return `Your wallet needs more ${asset.symbol} for this payment.`;
      }
    } catch (error) {
      return errorMessage(error);
    }
    return null;
  }

  function reviewPayment() {
    const validationError = validateOrder();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setStage("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function executePayment() {
    if (pendingPayment) {
      await finalizePayment(pendingPayment);
      return;
    }
    const validationError = validateOrder();
    if (validationError || !account) {
      setFormError(validationError ?? "Connect a wallet to continue.");
      setStage("edit");
      return;
    }

    setStage("signing");
    setFormError("");
    try {
      const amountUnits = parseUnits(order.settlementAmount, asset.decimals);
      const proofPayload = createProofPayload(order, totals);
      const orderHash = await hashProofPayload(proofPayload);
      const tx = new Transaction();
      const paymentCoin = tx.coin({
        balance: amountUnits,
        type: asset.coinType,
      });

      tx.moveCall({
        target: `${PAYPROOF_PACKAGE_ID}::payproof::pay`,
        typeArguments: [asset.coinType],
        arguments: [
          paymentCoin,
          tx.pure.address(order.recipient.trim()),
          tx.pure.vector("u8", orderHash.bytes),
          tx.pure.string(order.orderReference.trim()),
          tx.object.clock(),
        ],
      });

      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (result.FailedTransaction) {
        throw new Error(
          result.FailedTransaction.status.error?.message ??
            "The transaction failed on Sui.",
        );
      }

      const digest = result.Transaction.digest;
      const submitted: PendingPayment = {
        digest,
        amountUnits,
        proofPayload,
        orderHash,
      };
      setPendingPayment(submitted);
      await finalizePayment(submitted);
    } catch (error) {
      setFormError(errorMessage(error));
      setStage("review");
    }
  }

  async function finalizePayment(submitted: PendingPayment) {
    if (!account) return;
    setStage("signing");
    setFormError("");
    try {
      const indexed = await client.waitForTransaction({
        digest: submitted.digest,
        include: { events: true },
        timeout: 60_000,
        pollSchedule: [0, 500, 1_000, 2_000],
      });
      if (indexed.FailedTransaction) {
        setPendingPayment(null);
        setFormError(
          indexed.FailedTransaction.status.error?.message ??
            "The transaction failed on Sui. No payment was finalized.",
        );
        setStage("review");
        return;
      }

      const event = indexed.Transaction.events?.find(
        (item) =>
          isPayProofPaymentRecordedType(item.eventType, asset.coinType) &&
          (!item.packageId || isTrustedPayProofPackageId(item.packageId)),
      );
      const eventJson = (event?.json ?? {}) as PaymentEventJson;
      if (!eventJson.receipt_id) {
        throw new Error("Payment finalized, but its receipt event was not indexed.");
      }
      const eventMatches =
        normalizeSuiAddress(eventJson.payer ?? "0x0") ===
          normalizeSuiAddress(account.address) &&
        normalizeSuiAddress(eventJson.recipient ?? "0x0") ===
          submitted.proofPayload.recipient &&
        String(eventJson.amount) === submitted.amountUnits.toString() &&
        eventBytesToHex(eventJson.order_hash) === submitted.orderHash.hex &&
        eventJson.order_reference === submitted.proofPayload.orderReference;
      if (!eventMatches) {
        throw new Error("The indexed receipt does not match the submitted payment.");
      }

      const completedReceipt: PayProofReceipt = {
        format: "payproof-receipt",
        version: 1,
        network: NETWORK,
        packageId: PAYPROOF_PACKAGE_ID,
        digest: submitted.digest,
        receiptId: eventJson.receipt_id,
        payer: normalizeSuiAddress(account.address),
        recipient: submitted.proofPayload.recipient,
        asset: submitted.proofPayload.settlementAsset,
        coinType: ASSETS[submitted.proofPayload.settlementAsset].coinType,
        amount: submitted.proofPayload.settlementAmount,
        amountUnits: submitted.amountUnits.toString(),
        orderHash: submitted.orderHash.hex,
        paidAtMs: Number(eventJson.paid_at_ms ?? Date.now()),
        order: submitted.proofPayload,
      };

      setReceipt(completedReceipt);
      setReceipts(saveReceipt(completedReceipt));
      setPendingPayment(null);
      setStage("success");
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
    } catch (error) {
      setFormError(
        `The payment was submitted as ${shorten(submitted.digest, 10, 8)}, but its receipt is still being checked. Do not pay again; retry the receipt check. ${errorMessage(error)}`,
      );
      setStage("review");
    }
  }

  function startAnotherPayment() {
    setOrder({
      ...DEFAULT_ORDER,
      orderReference: `ORD-${new Date().getFullYear()}-`,
      lineItems: [newLineItem()],
    });
    setReceipt(null);
    setPendingPayment(null);
    setFormError("");
    setStage("edit");
  }

  if (stage === "success" && receipt) {
    return (
      <section className="success-shell" aria-labelledby="payment-complete-title">
        <div className="success-mark" aria-hidden="true">
          <Check size={30} strokeWidth={2.4} />
        </div>
        <p className="section-label">Payment finalized</p>
        <h2 id="payment-complete-title">The order and payment now match.</h2>
        <p className="success-copy">
          {receipt.amount} {receipt.asset} reached {shorten(receipt.recipient)}.
          The receipt hash is final on Sui testnet.
        </p>

        <dl className="proof-ledger">
          <div>
            <dt>Order</dt>
            <dd>{receipt.order.orderReference}</dd>
          </div>
          <div>
            <dt>Order total</dt>
            <dd>{formatUsd(receipt.order.totalCents)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>
              {receipt.amount} {receipt.asset}
            </dd>
          </div>
          <div>
            <dt>Finalized</dt>
            <dd>{new Date(receipt.paidAtMs).toLocaleString()}</dd>
          </div>
          <div className="proof-ledger-wide">
            <dt>Order hash</dt>
            <dd className="mono-value">{receipt.orderHash}</dd>
          </div>
        </dl>

        <div className="success-actions">
          <button className="button button-primary" onClick={() => downloadReceipt(receipt)}>
            <Download size={18} /> Download receipt
          </button>
          <a
            className="button button-secondary"
            href={explorerTransactionUrl(receipt.digest)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction <ArrowUpRight size={17} />
          </a>
        </div>
        <button className="text-button" onClick={startAnotherPayment}>
          Create another payment <ChevronRight size={16} />
        </button>
      </section>
    );
  }

  const isReview = stage === "review" || stage === "signing";

  return (
    <>
      <section className="workspace" aria-label="Create payment proof">
        <div className="workspace-main">
          <div className="section-heading">
            <div>
              <p className="section-label">New payment</p>
              <h2>{isReview ? "Review before signing" : "Order details"}</h2>
            </div>
            {isReview && (
              <button
                className="button button-ghost"
                onClick={() => setStage("edit")}
                disabled={stage === "signing" || Boolean(pendingPayment)}
              >
                <ArrowLeft size={17} /> Edit order
              </button>
            )}
          </div>

          {isReview ? (
            <ReviewPanel order={order} totals={totals} payer={account?.address ?? ""} />
          ) : (
            <div className="order-form">
              <div className="field-row two-columns">
                <label className="field">
                  <span>Order or invoice number</span>
                  <input
                    value={order.orderReference}
                    onChange={(event) =>
                      updateOrder("orderReference", event.target.value)
                    }
                    placeholder="INV-2026-1042"
                    maxLength={128}
                    required
                  />
                </label>
                <label className="field">
                  <span>Customer name</span>
                  <input
                    value={order.customerName}
                    onChange={(event) =>
                      updateOrder("customerName", event.target.value)
                    }
                    placeholder="Optional, kept off-chain"
                    maxLength={160}
                  />
                </label>
              </div>

              <label className="field">
                <span>SME recipient wallet</span>
                <input
                  className="mono-input"
                  value={order.recipient}
                  onChange={(event) => updateOrder("recipient", event.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>Payment assets transfer directly to this Sui address.</small>
              </label>

              <div className="line-items-heading">
                <div>
                  <h3>Line items</h3>
                  <p>Prices are recorded in USD for the order document.</p>
                </div>
                <button
                  className="button button-secondary button-small"
                  onClick={() =>
                    updateOrder("lineItems", [...order.lineItems, newLineItem()])
                  }
                  disabled={order.lineItems.length >= 100}
                >
                  <Plus size={16} /> Add item
                </button>
              </div>

              <div className="line-items" role="group" aria-label="Order line items">
                {order.lineItems.map((item, index) => (
                  <div className="line-item" key={item.id}>
                    <span className="line-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <label className="field item-description">
                      <span>Description</span>
                      <input
                        value={item.description}
                        onChange={(event) =>
                          updateLineItem(item.id, "description", event.target.value)
                        }
                        placeholder="Product or service"
                        maxLength={240}
                        required
                      />
                    </label>
                    <label className="field item-quantity">
                      <span>Qty</span>
                      <input
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        value={item.quantity}
                        onChange={(event) =>
                          updateLineItem(
                            item.id,
                            "quantity",
                            event.target.valueAsNumber,
                          )
                        }
                      />
                    </label>
                    <label className="field item-price">
                      <span>Unit price</span>
                      <div className="money-input">
                        <span>$</span>
                        <input
                          inputMode="decimal"
                          value={item.unitPrice}
                          onChange={(event) =>
                            updateLineItem(item.id, "unitPrice", event.target.value)
                          }
                          placeholder="0.00"
                          required
                        />
                      </div>
                    </label>
                    <button
                      className="icon-button"
                      aria-label={`Remove line item ${index + 1}`}
                      onClick={() =>
                        updateOrder(
                          "lineItems",
                          order.lineItems.filter((line) => line.id !== item.id),
                        )
                      }
                      disabled={order.lineItems.length === 1}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="order-lower-grid">
                <label className="field">
                  <span>Order notes</span>
                  <textarea
                    value={order.notes}
                    onChange={(event) => updateOrder("notes", event.target.value)}
                    placeholder="Delivery details, terms, or internal context"
                    rows={5}
                    maxLength={2000}
                  />
                </label>
                <div className="totals-editor">
                  <label>
                    <span>Discount</span>
                    <div className="compact-money-input">
                      <span>$</span>
                      <input
                        inputMode="decimal"
                        value={order.discount}
                        onChange={(event) =>
                          updateOrder("discount", event.target.value)
                        }
                        placeholder="0.00"
                      />
                    </div>
                  </label>
                  <label>
                    <span>Tax rate</span>
                    <div className="compact-money-input suffix">
                      <input
                        inputMode="decimal"
                        value={order.taxRate}
                        onChange={(event) =>
                          updateOrder("taxRate", event.target.value)
                        }
                        placeholder="0"
                        min="0"
                        max="100"
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="payment-panel" aria-label="Payment summary">
          <div className="payment-panel-top">
            <p className="section-label">Settlement</p>
            <div className="asset-toggle" role="radiogroup" aria-label="Payment asset">
              {(Object.keys(ASSETS) as AssetSymbol[]).map((symbol) => (
                <button
                  key={symbol}
                  role="radio"
                  aria-checked={order.asset === symbol}
                  className={order.asset === symbol ? "selected" : ""}
                  onClick={() => updateOrder("asset", symbol)}
                  disabled={isReview}
                >
                  <span
                    className={`asset-dot asset-${symbol.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {symbol[0]}
                  </span>
                  {symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="amount-block">
            <span>Order total</span>
            <strong>{formatUsd(totals.totalCents)}</strong>
          </div>

          <label className="field settlement-field">
            <span>Amount to pay in {asset.symbol}</span>
            <div className="settlement-input">
              <input
                inputMode="decimal"
                value={order.settlementAmount}
                onChange={(event) =>
                  updateOrder("settlementAmount", event.target.value)
                }
                readOnly={order.asset === "USDC"}
                aria-describedby="settlement-help"
              />
              <span>{asset.symbol}</span>
            </div>
            <small id="settlement-help">
              {order.asset === "USDC"
                ? "USDC follows the USD order total."
                : "Enter the SUI amount agreed with the merchant."}
            </small>
          </label>

          <div className="wallet-balance">
            <div>
              <span>Wallet balance</span>
              <strong>
                {balanceQuery.isLoading ? "Checking…" : `${balance} ${asset.symbol}`}
              </strong>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh wallet balance"
              onClick={() => balanceQuery.refetch()}
              disabled={!account || balanceQuery.isFetching}
            >
              <RefreshCw size={16} className={balanceQuery.isFetching ? "spin" : ""} />
            </button>
          </div>

          <a
            className="top-up-link"
            href={asset.faucetUrl}
            target="_blank"
            rel="noreferrer"
          >
            <CircleDollarSign size={19} />
            <span>
              <strong>Get test {asset.symbol}</strong>
              <small>Card purchases activate on mainnet only.</small>
            </span>
            <ArrowUpRight size={17} />
          </a>

          <dl className="summary-lines">
            <div>
              <dt>From</dt>
              <dd className="mono-value">{shorten(account?.address ?? "")}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd className="mono-value">{shorten(order.recipient)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>Sui testnet</dd>
            </div>
          </dl>

          <div className="privacy-note">
            <LockKeyhole size={18} />
            <p>
              Customer and line-item details stay in the receipt file. Only their
              SHA-256 hash and payment facts are public.
            </p>
          </div>

          {formError && (
            <div className="inline-error" role="alert">
              <AlertCircle size={18} />
              <span>{formError}</span>
            </div>
          )}

          {isReview ? (
            <button
              className="button button-primary button-wide"
              onClick={executePayment}
              disabled={stage === "signing"}
            >
              {stage === "signing" ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  {pendingPayment ? "Checking receipt" : "Waiting for wallet"}
                </>
              ) : pendingPayment ? (
                <>
                  Retry receipt check <RefreshCw size={18} />
                </>
              ) : (
                <>
                  Pay {order.settlementAmount || "0"} {asset.symbol}
                  <ShieldCheck size={18} />
                </>
              )}
            </button>
          ) : (
            <button className="button button-primary button-wide" onClick={reviewPayment}>
              Review payment <ChevronRight size={18} />
            </button>
          )}
          <p className="signature-copy">
            {pendingPayment
              ? "The payment is already submitted. This action only checks its receipt."
              : "Your wallet shows the final transaction before anything moves."}
          </p>
        </aside>
      </section>

      {receipts.length > 0 && (
        <section className="recent-section" aria-labelledby="recent-receipts-heading">
          <div className="section-heading">
            <div>
              <p className="section-label">This browser</p>
              <h2 id="recent-receipts-heading">Recent receipts</h2>
            </div>
          </div>
          <div className="receipt-list">
            {receipts.slice(0, 5).map((item) => (
              <article className="receipt-row" key={item.digest}>
                <FileCheck2 size={20} aria-hidden="true" />
                <div>
                  <strong>{item.order.orderReference}</strong>
                  <span>{new Date(item.paidAtMs).toLocaleDateString()}</span>
                </div>
                <div className="receipt-amount">
                  <strong>
                    {item.amount} {item.asset}
                  </strong>
                  <span>{formatUsd(item.order.totalCents)}</span>
                </div>
                <div className="receipt-row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Download receipt ${item.order.orderReference}`}
                    onClick={() => downloadReceipt(item)}
                  >
                    <Download size={17} />
                  </button>
                  <a
                    className="icon-button"
                    href={explorerObjectUrl(item.receiptId)}
                    aria-label={`View receipt ${item.order.orderReference} on Sui`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowUpRight size={17} />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ReviewPanel({
  order,
  totals,
  payer,
}: {
  order: OrderDraft;
  totals: ReturnType<typeof calculateTotals>;
  payer: string;
}) {
  return (
    <div className="review-panel">
      <div className="review-status">
        <ShieldCheck size={22} />
        <div>
          <strong>One transaction, two results</strong>
          <p>The payment and proof either both finalize or neither does.</p>
        </div>
      </div>
      <dl className="review-ledger">
        <div>
          <dt>Order</dt>
          <dd>{order.orderReference}</dd>
        </div>
        <div>
          <dt>Payer</dt>
          <dd className="mono-value">{payer}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd className="mono-value">{order.recipient}</dd>
        </div>
      </dl>
      <div className="review-items">
        <div className="review-items-head">
          <span>Description</span>
          <span>Qty</span>
          <span>Amount</span>
        </div>
        {order.lineItems.map((item) => (
          <div className="review-item" key={item.id}>
            <strong>{item.description}</strong>
            <span>{item.quantity}</span>
            <span>{formatUsd(Math.round(Number(item.unitPrice || 0) * 100 * item.quantity))}</span>
          </div>
        ))}
      </div>
      <dl className="review-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatUsd(totals.subtotalCents)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>−{formatUsd(totals.discountCents)}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>{formatUsd(totals.taxCents)}</dd>
        </div>
        <div className="review-total-final">
          <dt>Order total</dt>
          <dd>{formatUsd(totals.totalCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

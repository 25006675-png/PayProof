import { useCurrentClient } from "@mysten/dapp-kit-react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  FileJson,
  LoaderCircle,
  SearchCheck,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  normalizeStructTag,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { explorerTransactionUrl } from "../config";
import {
  eventBytesToHex,
  hashProofPayload,
  parseReceiptFile,
} from "../lib/order";
import type { PayProofReceipt } from "../types";

type VerifyState =
  | { kind: "idle"; message: string }
  | { kind: "checking"; message: string }
  | { kind: "valid"; message: string }
  | { kind: "invalid"; message: string };

interface PaymentEventJson {
  receipt_id?: string;
  payer?: string;
  recipient?: string;
  amount?: string;
  order_hash?: number[] | string;
  order_reference?: string;
  paid_at_ms?: string;
}

export function VerifyReceipt() {
  const client = useCurrentClient();
  const [receipt, setReceipt] = useState<PayProofReceipt | null>(null);
  const [state, setState] = useState<VerifyState>({
    kind: "idle",
    message: "Choose a PayProof JSON receipt to begin.",
  });

  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseReceiptFile(await file.text());
      const localHash = await hashProofPayload(parsed.order);
      if (localHash.hex !== parsed.orderHash) {
        setReceipt(parsed);
        setState({
          kind: "invalid",
          message: "The order details were changed after this receipt was created.",
        });
        return;
      }
      setReceipt(parsed);
      setState({
        kind: "idle",
        message: "Order details match the saved hash. Check Sui to verify settlement.",
      });
    } catch (error) {
      setReceipt(null);
      setState({
        kind: "invalid",
        message: error instanceof Error ? error.message : "The file could not be read.",
      });
    }
  }

  async function verifyOnChain() {
    if (!receipt) return;
    setState({ kind: "checking", message: "Checking the Sui transaction…" });
    try {
      const result = await client.getTransaction({
        digest: receipt.digest,
        include: { events: true },
      });
      if (result.FailedTransaction) {
        throw new Error("The referenced Sui transaction did not succeed.");
      }
      const expectedEventType = normalizeStructTag(
        `${receipt.packageId}::payproof::PaymentRecorded<${receipt.coinType}>`,
      );
      const event = result.Transaction.events?.find(
        (item) => normalizeStructTag(item.eventType) === expectedEventType,
      );
      if (!event) throw new Error("No matching PayProof event exists in this transaction.");

      const data = (event.json ?? {}) as PaymentEventJson;
      const chainHash = eventBytesToHex(data.order_hash);
      const matches =
        chainHash === receipt.orderHash &&
        normalizeSuiAddress(data.receipt_id ?? "0x0") ===
          normalizeSuiAddress(receipt.receiptId) &&
        normalizeSuiAddress(data.payer ?? "0x0") ===
          normalizeSuiAddress(receipt.payer) &&
        normalizeSuiAddress(data.recipient ?? "0x0") ===
          normalizeSuiAddress(receipt.recipient) &&
        String(data.amount) === receipt.amountUnits &&
        data.order_reference === receipt.order.orderReference &&
        Number(data.paid_at_ms) === receipt.paidAtMs;

      if (!matches) {
        throw new Error("The file does not match the payment facts recorded on Sui.");
      }
      setState({
        kind: "valid",
        message: "Verified. The order file and Sui payment record match exactly.",
      });
    } catch (error) {
      setState({
        kind: "invalid",
        message: error instanceof Error ? error.message : "Verification failed.",
      });
    }
  }

  return (
    <section className="verify-shell" aria-labelledby="verify-heading">
      <div className="verify-intro">
        <p className="section-label">Independent check</p>
        <h2 id="verify-heading">Verify a receipt</h2>
        <p>
          PayProof recalculates the private order hash locally, then compares the
          payment facts with Sui testnet. The order file is never uploaded.
        </p>
        <div className="verify-steps" aria-label="Verification process">
          <div>
            <span>1</span>
            <p>Read the receipt in this browser</p>
          </div>
          <div>
            <span>2</span>
            <p>Recalculate its SHA-256 order hash</p>
          </div>
          <div>
            <span>3</span>
            <p>Match the hash and payment on Sui</p>
          </div>
        </div>
      </div>

      <div className="verify-tool">
        <label className="file-drop">
          <Upload size={25} />
          <strong>Choose receipt file</strong>
          <span>JSON files created by PayProof</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
        </label>

        {receipt && (
          <dl className="verify-facts">
            <div>
              <dt>Order</dt>
              <dd>{receipt.order.orderReference}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>
                {receipt.amount} {receipt.asset}
              </dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd className="mono-value">{receipt.digest}</dd>
            </div>
          </dl>
        )}

        <div className={`verify-status status-${state.kind}`} role="status" aria-live="polite">
          {state.kind === "valid" ? (
            <CheckCircle2 size={20} />
          ) : state.kind === "checking" ? (
            <LoaderCircle size={20} className="spin" />
          ) : state.kind === "invalid" ? (
            <AlertCircle size={20} />
          ) : (
            <FileJson size={20} />
          )}
          <span>{state.message}</span>
        </div>

        <button
          className="button button-primary button-wide"
          onClick={verifyOnChain}
          disabled={!receipt || state.kind === "checking" || state.kind === "invalid"}
        >
          <SearchCheck size={18} /> Verify on Sui
        </button>
        {receipt && (
          <a
            className="text-button centered-link"
            href={explorerTransactionUrl(receipt.digest)}
            target="_blank"
            rel="noreferrer"
          >
            Inspect transaction <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    </section>
  );
}

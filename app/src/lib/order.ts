import type {
  LineItem,
  OrderDraft,
  OrderTotals,
  PayProofReceipt,
  ProofPayload,
} from "../types";
import {
  fromBase64,
  isValidSuiAddress,
  isValidTransactionDigest,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import { ASSETS, NETWORK, PAYPROOF_PACKAGE_ID } from "../config";

const RECEIPT_STORAGE_KEY = "payproof.receipts.v1";

export const ORDER_LIMITS = {
  lineItems: 100,
  description: 240,
  customerName: 160,
  notes: 2_000,
  quantity: 1_000_000,
  amountCents: 100_000_000_000,
} as const;

const USD_INPUT = /^\d+(\.\d{1,2})?$/;
const RATE_INPUT = /^\d+(\.\d{1,2})?$/;

export function moneyToCents(value: string): number {
  const amount = Number(value || "0");
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

export function calculateTotals(order: OrderDraft): OrderTotals {
  const subtotalCents = order.lineItems.reduce((sum, item) => {
    const quantity = Number.isFinite(item.quantity)
      ? Math.max(0, item.quantity)
      : 0;
    return sum + Math.round(moneyToCents(item.unitPrice) * quantity);
  }, 0);
  const discountCents = Math.min(
    subtotalCents,
    moneyToCents(order.discount),
  );
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const rawTaxRate = Number(order.taxRate || "0");
  const taxRate = Number.isFinite(rawTaxRate)
    ? Math.min(100, Math.max(0, rawTaxRate))
    : 0;
  const taxCents = Math.round(taxableCents * (taxRate / 100));

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

export function validateOrderDraft(
  order: OrderDraft,
  totals: OrderTotals,
): string | null {
  if (!order.orderReference.trim()) return "Enter an order or invoice number.";
  if (new TextEncoder().encode(order.orderReference.trim()).length > 128)
    return "Keep the order number within 128 UTF-8 bytes.";
  if (order.customerName.length > ORDER_LIMITS.customerName)
    return `Keep the customer name within ${ORDER_LIMITS.customerName} characters.`;
  if (!isSuiAddress(order.recipient))
    return "Enter a valid Sui recipient address.";
  if (order.lineItems.length === 0) return "Add at least one item to the order.";
  if (order.lineItems.length > ORDER_LIMITS.lineItems)
    return `Keep the order within ${ORDER_LIMITS.lineItems} line items.`;
  if (order.lineItems.some((item) => !item.description.trim()))
    return "Add a description for every line item.";
  if (
    order.lineItems.some(
      (item) => item.description.length > ORDER_LIMITS.description,
    )
  )
    return `Keep each description within ${ORDER_LIMITS.description} characters.`;
  if (
    order.lineItems.some(
      (item) =>
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > ORDER_LIMITS.quantity,
    )
  )
    return `Each quantity must be between 0 and ${ORDER_LIMITS.quantity.toLocaleString("en-US")}.`;
  if (
    order.lineItems.some(
      (item) => !USD_INPUT.test(item.unitPrice.trim()) || moneyToCents(item.unitPrice) <= 0,
    )
  )
    return "Enter every unit price as a positive USD amount with up to 2 decimals.";
  if (order.discount && !USD_INPUT.test(order.discount.trim()))
    return "Enter the discount as a USD amount with up to 2 decimals.";
  if (moneyToCents(order.discount) > totals.subtotalCents)
    return "The discount cannot exceed the subtotal.";
  if (order.taxRate && !RATE_INPUT.test(order.taxRate.trim()))
    return "Enter a tax rate from 0 to 100 with up to 2 decimals.";
  if (Number(order.taxRate || 0) > 100)
    return "The tax rate cannot exceed 100%.";
  if (order.notes.length > ORDER_LIMITS.notes)
    return `Keep notes within ${ORDER_LIMITS.notes.toLocaleString("en-US")} characters.`;
  if (!Number.isSafeInteger(totals.totalCents) || totals.totalCents <= 0)
    return "The order total must be greater than zero.";
  if (totals.totalCents > ORDER_LIMITS.amountCents)
    return "The order total exceeds the supported limit.";
  return null;
}

export function createProofPayload(
  order: OrderDraft,
  totals: OrderTotals,
  commitmentNonce = newCommitmentNonce(),
): ProofPayload {
  return {
    schema: "payproof-order-v1",
    commitmentNonce,
    orderReference: order.orderReference.trim(),
    recipient: normalizeSuiAddress(order.recipient.trim()),
    customerName: order.customerName.trim(),
    lineItems: order.lineItems.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPriceCents: moneyToCents(item.unitPrice),
    })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxRateBasisPoints: Math.round(
      Math.max(0, Number(order.taxRate || "0")) * 100,
    ),
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    displayCurrency: "USD",
    settlementAsset: order.asset,
    settlementAmount: order.settlementAmount.trim(),
    notes: order.notes.trim(),
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Convert Sui event vector<u8> values from gRPC Base64 or test arrays. */
export function eventBytesToHex(value: unknown): string {
  if (
    Array.isArray(value) &&
    value.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    )
  ) {
    return value
      .map((byte) => Number(byte).toString(16).padStart(2, "0"))
      .join("");
  }
  if (typeof value !== "string") return "";
  if (/^[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  try {
    return Array.from(fromBase64(value), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return "";
  }
}

export async function hashProofPayload(payload: ProofPayload): Promise<{
  bytes: number[];
  hex: string;
}> {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    bytes: Array.from(digest),
    hex: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
  };
}

export function parseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid payment amount.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`This asset supports up to ${decimals} decimal places.`);
  }
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: string | bigint, decimals: number): string {
  const units = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function isSuiAddress(value: string): boolean {
  return isValidSuiAddress(value.trim());
}

export function newLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: 1,
    unitPrice: "",
  };
}

export function newCommitmentNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function downloadReceipt(receipt: PayProofReceipt): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeReference = receipt.order.orderReference
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  anchor.download = `payproof-${safeReference || "receipt"}.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function loadReceipts(): PayProofReceipt[] {
  try {
    const raw = localStorage.getItem(RECEIPT_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item) => {
      try {
        return [parseReceiptFile(JSON.stringify(item))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveReceipt(receipt: PayProofReceipt): PayProofReceipt[] {
  const receipts = [
    receipt,
    ...loadReceipts().filter((item) => item.digest !== receipt.digest),
  ].slice(0, 20);
  try {
    localStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(receipts));
  } catch {
    // The downloadable receipt remains available when storage is unavailable.
  }
  return receipts;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isValidProofPayload(value: unknown): value is ProofPayload {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<ProofPayload>;
  if (
    proof.schema !== "payproof-order-v1" ||
    typeof proof.commitmentNonce !== "string" ||
    !/^[a-f0-9]{32}$/.test(proof.commitmentNonce) ||
    typeof proof.orderReference !== "string" ||
    !proof.orderReference.trim() ||
    new TextEncoder().encode(proof.orderReference).length > 128 ||
    !isSuiAddress(proof.recipient ?? "") ||
    typeof proof.customerName !== "string" ||
    proof.customerName.length > ORDER_LIMITS.customerName ||
    !Array.isArray(proof.lineItems) ||
    proof.lineItems.length < 1 ||
    proof.lineItems.length > ORDER_LIMITS.lineItems ||
    proof.displayCurrency !== "USD" ||
    (proof.settlementAsset !== "SUI" && proof.settlementAsset !== "USDC") ||
    typeof proof.settlementAmount !== "string" ||
    typeof proof.notes !== "string" ||
    proof.notes.length > ORDER_LIMITS.notes ||
    !isFiniteInteger(proof.subtotalCents) ||
    !isFiniteInteger(proof.discountCents) ||
    !isFiniteInteger(proof.taxRateBasisPoints) ||
    !isFiniteInteger(proof.taxCents) ||
    !isFiniteInteger(proof.totalCents)
  ) {
    return false;
  }
  if (
    proof.lineItems.some(
      (item) =>
        !item ||
        typeof item.description !== "string" ||
        !item.description.trim() ||
        item.description.length > ORDER_LIMITS.description ||
        typeof item.quantity !== "number" ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > ORDER_LIMITS.quantity ||
        !isFiniteInteger(item.unitPriceCents) ||
        item.unitPriceCents <= 0,
    )
  ) {
    return false;
  }
  const subtotal = proof.lineItems.reduce(
    (sum, item) => sum + Math.round(item.unitPriceCents * item.quantity),
    0,
  );
  const taxable = subtotal - proof.discountCents;
  const tax = Math.round(taxable * (proof.taxRateBasisPoints / 10_000));
  return (
    Number.isSafeInteger(subtotal) &&
    subtotal === proof.subtotalCents &&
    proof.discountCents >= 0 &&
    proof.discountCents <= subtotal &&
    proof.taxRateBasisPoints >= 0 &&
    proof.taxRateBasisPoints <= 10_000 &&
    proof.taxCents === tax &&
    proof.totalCents === taxable + tax &&
    proof.totalCents > 0 &&
    proof.totalCents <= ORDER_LIMITS.amountCents
  );
}

export function parseReceiptFile(raw: string): PayProofReceipt {
  const receipt = JSON.parse(raw) as Partial<PayProofReceipt>;
  if (
    receipt.format !== "payproof-receipt" ||
    receipt.version !== 1 ||
    !receipt.digest ||
    !receipt.orderHash ||
    !isValidProofPayload(receipt.order) ||
    receipt.network !== NETWORK ||
    !isSuiAddress(receipt.packageId ?? "") ||
    normalizeSuiAddress(receipt.packageId ?? "0x0") !==
      normalizeSuiAddress(PAYPROOF_PACKAGE_ID || "0x0") ||
    !isValidTransactionDigest(receipt.digest) ||
    !isSuiAddress(receipt.receiptId ?? "") ||
    !isSuiAddress(receipt.payer ?? "") ||
    !isSuiAddress(receipt.recipient ?? "") ||
    (receipt.asset !== "SUI" && receipt.asset !== "USDC") ||
    receipt.coinType !== (receipt.asset ? ASSETS[receipt.asset].coinType : "") ||
    !/^([a-fA-F0-9]{64})$/.test(receipt.orderHash ?? "") ||
    !/^\d+$/.test(receipt.amountUnits ?? "") ||
    typeof receipt.amount !== "string" ||
    typeof receipt.paidAtMs !== "number" ||
    !Number.isSafeInteger(receipt.paidAtMs) ||
    receipt.paidAtMs < 0 ||
    receipt.order.recipient !== normalizeSuiAddress(receipt.recipient ?? "") ||
    receipt.order.settlementAsset !== receipt.asset ||
    receipt.order.settlementAmount !== receipt.amount
  ) {
    throw new Error("This is not a valid PayProof receipt file.");
  }

  const expectedUnits = parseUnits(
    receipt.amount,
    ASSETS[receipt.asset].decimals,
  );
  if (expectedUnits <= 0n || expectedUnits.toString() !== receipt.amountUnits) {
    throw new Error("The receipt amount and asset units do not match.");
  }
  return receipt as PayProofReceipt;
}

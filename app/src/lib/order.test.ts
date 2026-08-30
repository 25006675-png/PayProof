import { describe, expect, it } from "vitest";
import { toBase58 } from "@mysten/sui/utils";
import {
  calculateTotals,
  canonicalJson,
  createProofPayload,
  formatUnits,
  hashProofPayload,
  eventBytesToHex,
  loadReceipts,
  parseReceiptFile,
  parseUnits,
  saveReceipt,
  validateOrderDraft,
} from "./order";
import type { OrderDraft, PayProofReceipt } from "../types";
import { ASSETS, PAYPROOF_PACKAGE_ID } from "../config";

const PAYER = `0x${"a".repeat(64)}`;
const RECIPIENT = `0x${"b".repeat(64)}`;

const order: OrderDraft = {
  orderReference: "INV-1042",
  recipient: RECIPIENT,
  customerName: "Northwind Cafe",
  lineItems: [
    { id: "one", description: "Catering", quantity: 2, unitPrice: "45.50" },
    { id: "two", description: "Delivery", quantity: 1, unitPrice: "10.00" },
  ],
  discount: "5.00",
  taxRate: "8",
  notes: "Deliver before noon",
  asset: "USDC",
  settlementAmount: "103.68",
};

describe("order proof utilities", () => {
  it("calculates order totals in integer cents", () => {
    expect(calculateTotals(order)).toEqual({
      subtotalCents: 10_100,
      discountCents: 500,
      taxCents: 768,
      totalCents: 10_368,
    });
  });

  it("canonicalizes object keys without changing array order", () => {
    expect(canonicalJson({ z: 2, a: [3, { y: 1, x: 0 }] })).toBe(
      '{"a":[3,{"x":0,"y":1}],"z":2}',
    );
  });

  it("produces stable hashes and detects an order change", async () => {
    const payload = createProofPayload(order, calculateTotals(order));
    const first = await hashProofPayload(payload);
    const second = await hashProofPayload(payload);
    const changed = await hashProofPayload({ ...payload, notes: "Changed" });

    expect(first.bytes).toHaveLength(32);
    expect(payload.commitmentNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(first.hex).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hex).toBe(first.hex);
    expect(changed.hex).not.toBe(first.hex);
    expect(
      (
        await hashProofPayload({
          ...payload,
          commitmentNonce: "0".repeat(32),
        })
      ).hex,
    ).not.toBe(first.hex);
  });

  it("converts SUI and USDC decimal amounts without floating-point math", () => {
    expect(parseUnits("1.25", 9)).toBe(1_250_000_000n);
    expect(parseUnits("103.68", 6)).toBe(103_680_000n);
    expect(formatUnits(103_680_000n, 6)).toBe("103.68");
    expect(() => parseUnits("1.0000001", 6)).toThrow(/6 decimal places/);
    expect(() => parseUnits("1e6", 6)).toThrow(/valid payment amount/);
    expect(() => parseUnits("-1", 6)).toThrow(/valid payment amount/);
  });

  it("decodes the Base64 byte format returned by Sui gRPC events", () => {
    expect(eventBytesToHex("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=")).toBe(
      Array.from({ length: 32 }, (_, index) => (index + 1).toString(16).padStart(2, "0")).join(""),
    );
    expect(eventBytesToHex([1, 2, 255])).toBe("0102ff");
    expect(eventBytesToHex("not-base64***")).toBe("");
  });

  it.each([
    ["non-finite quantity", { lineItems: [{ ...order.lineItems[0], quantity: Number.NaN }] }],
    ["zero quantity", { lineItems: [{ ...order.lineItems[0], quantity: 0 }] }],
    ["over-precision price", { lineItems: [{ ...order.lineItems[0], unitPrice: "1.234" }] }],
    ["negative price", { lineItems: [{ ...order.lineItems[0], unitPrice: "-1" }] }],
    ["excessive tax", { taxRate: "101" }],
    ["oversized notes", { notes: "n".repeat(2_001) }],
    ["oversized Unicode reference", { orderReference: "📦".repeat(33) }],
  ])("rejects %s", (_label, change) => {
    const changed = { ...order, ...change } as OrderDraft;
    expect(validateOrderDraft(changed, calculateTotals(changed))).toBeTruthy();
  });

  it("rejects a discount larger than the subtotal", () => {
    const changed = { ...order, discount: "1000.00" };
    expect(validateOrderDraft(changed, calculateTotals(changed))).toMatch(
      /cannot exceed/,
    );
  });

  it("accepts Unicode order details without changing their meaning", async () => {
    const changed = {
      ...order,
      customerName: "شركة القهوة ☕",
      notes: "交付前に電話してください — livraison à 9 h",
    };
    const totals = calculateTotals(changed);
    expect(validateOrderDraft(changed, totals)).toBeNull();
    expect((await hashProofPayload(createProofPayload(changed, totals))).hex).toHaveLength(64);
  });

  it("strictly validates saved receipts and ignores corrupt local history", async () => {
    const payload = createProofPayload(order, calculateTotals(order));
    const hash = await hashProofPayload(payload);
    const receipt: PayProofReceipt = {
      format: "payproof-receipt",
      version: 1,
      network: "testnet",
      packageId: PAYPROOF_PACKAGE_ID,
      digest: toBase58(new Uint8Array(32).fill(7)),
      receiptId: `0x${"c".repeat(64)}`,
      payer: PAYER,
      recipient: RECIPIENT,
      asset: "USDC",
      coinType: ASSETS.USDC.coinType,
      amount: "103.68",
      amountUnits: "103680000",
      orderHash: hash.hex,
      paidAtMs: 1_800_000_000_000,
      order: payload,
    };

    expect(parseReceiptFile(JSON.stringify(receipt))).toEqual(receipt);
    expect(() =>
      parseReceiptFile(JSON.stringify({ ...receipt, packageId: PAYER })),
    ).toThrow(/not a valid/);
    expect(() =>
      parseReceiptFile(JSON.stringify({ ...receipt, amountUnits: "1" })),
    ).toThrow(/do not match/);
    expect(() =>
      parseReceiptFile(
        JSON.stringify({
          ...receipt,
          order: { ...payload, totalCents: payload.totalCents + 1 },
        }),
      ),
    ).toThrow(/not a valid/);

    localStorage.setItem("payproof.receipts.v1", "not-json");
    expect(loadReceipts()).toEqual([]);
    expect(saveReceipt(receipt)).toEqual([receipt]);
    expect(loadReceipts()).toEqual([receipt]);
  });
});

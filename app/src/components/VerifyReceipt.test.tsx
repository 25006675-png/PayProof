import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toBase58, toBase64 } from "@mysten/sui/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  client: { getTransaction: vi.fn() },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentClient: () => chain.client,
}));

import { VerifyReceipt } from "./VerifyReceipt";
import {
  ASSETS,
  PAYPROOF_PACKAGE_ID,
  PAYPROOF_TYPE_ORIGIN_PACKAGE_ID,
} from "../config";
import { calculateTotals, createProofPayload, hashProofPayload } from "../lib/order";
import type { OrderDraft, PayProofReceipt } from "../types";

const PAYER = `0x${"a".repeat(64)}`;
const RECIPIENT = `0x${"b".repeat(64)}`;
const RECEIPT_ID = `0x${"c".repeat(64)}`;
const DIGEST = toBase58(new Uint8Array(32).fill(8));

async function makeReceipt(): Promise<PayProofReceipt> {
  const draft: OrderDraft = {
    orderReference: "INV-VERIFY-1",
    recipient: RECIPIENT,
    customerName: "Acme Café",
    lineItems: [
      { id: "one", description: "Replacement parts", quantity: 2, unitPrice: "12.50" },
    ],
    discount: "",
    taxRate: "",
    notes: "箱を丁寧に扱ってください",
    asset: "USDC",
    settlementAmount: "25.00",
  };
  const order = createProofPayload(draft, calculateTotals(draft));
  const hash = await hashProofPayload(order);
  return {
    format: "payproof-receipt",
    version: 1,
    network: "testnet",
    packageId: PAYPROOF_PACKAGE_ID,
    digest: DIGEST,
    receiptId: RECEIPT_ID,
    payer: PAYER,
    recipient: RECIPIENT,
    asset: "USDC",
    coinType: ASSETS.USDC.coinType,
    amount: "25.00",
    amountUnits: "25000000",
    orderHash: hash.hex,
    paidAtMs: 1_800_000_000_000,
    order,
  };
}

function chainResult(receipt: PayProofReceipt, overrides: Record<string, unknown> = {}) {
  return {
    Transaction: {
      events: [
        {
          eventType: `${receipt.packageId}::payproof::PaymentRecorded<${receipt.coinType}>`,
          json: {
            receipt_id: receipt.receiptId,
            payer: receipt.payer,
            recipient: receipt.recipient,
            amount: receipt.amountUnits,
            order_hash: toBase64(
              Uint8Array.from(
                receipt.orderHash.match(/.{2}/g) ?? [],
                (byte) => Number.parseInt(byte, 16),
              ),
            ),
            order_reference: receipt.order.orderReference,
            paid_at_ms: String(receipt.paidAtMs),
            ...overrides,
          },
        },
      ],
    },
  };
}

async function upload(receipt: unknown) {
  const user = userEvent.setup();
  const file = new File([JSON.stringify(receipt)], "receipt.json", {
    type: "application/json",
  });
  await user.upload(screen.getByLabelText(/choose receipt file/i), file);
  return user;
}

beforeEach(() => {
  chain.client.getTransaction.mockReset();
});

describe("receipt verification actions", () => {
  it("detects local order tampering before making a network request", async () => {
    const receipt = await makeReceipt();
    receipt.order.notes = "Changed after payment";
    render(<VerifyReceipt />);
    await upload(receipt);

    expect(await screen.findByText(/order details were changed/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /verify on sui/i })).toBeDisabled();
    expect(chain.client.getTransaction).not.toHaveBeenCalled();
  });

  it("rejects receipts that claim an untrusted package", async () => {
    const receipt = { ...(await makeReceipt()), packageId: PAYER };
    render(<VerifyReceipt />);
    await upload(receipt);
    expect(await screen.findByText(/not a valid PayProof receipt/i)).toBeVisible();
  });

  it("matches a valid local receipt to its exact on-chain event", async () => {
    const receipt = await makeReceipt();
    chain.client.getTransaction.mockResolvedValue(chainResult(receipt));
    render(<VerifyReceipt />);
    const user = await upload(receipt);
    expect(await screen.findByText(/order details match/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /verify on sui/i }));

    expect(await screen.findByText(/match exactly/i)).toBeVisible();
    expect(chain.client.getTransaction).toHaveBeenCalledWith({
      digest: DIGEST,
      include: { events: true },
    });
  });

  it("accepts the original type-origin event after a package upgrade", async () => {
    const receipt = await makeReceipt();
    chain.client.getTransaction.mockResolvedValue({
      ...chainResult(receipt),
      Transaction: {
        ...chainResult(receipt).Transaction,
        events: [
          {
            ...chainResult(receipt).Transaction.events[0],
            eventType: `${PAYPROOF_TYPE_ORIGIN_PACKAGE_ID}::payproof::PaymentRecorded<${receipt.coinType}>`,
          },
        ],
      },
    });
    render(<VerifyReceipt />);
    const user = await upload(receipt);
    await user.click(screen.getByRole("button", { name: /verify on sui/i }));

    expect(await screen.findByText(/match exactly/i)).toBeVisible();
  });

  it("reports a mismatched on-chain payment amount", async () => {
    const receipt = await makeReceipt();
    chain.client.getTransaction.mockResolvedValue(
      chainResult(receipt, { amount: "24999999" }),
    );
    render(<VerifyReceipt />);
    const user = await upload(receipt);
    await user.click(screen.getByRole("button", { name: /verify on sui/i }));
    expect(await screen.findByText(/does not match the payment facts/i)).toBeVisible();
  });

  it("surfaces network failures and allows another verification attempt", async () => {
    const receipt = await makeReceipt();
    chain.client.getTransaction.mockRejectedValue(new Error("Network unavailable"));
    render(<VerifyReceipt />);
    const user = await upload(receipt);
    await user.click(screen.getByRole("button", { name: /verify on sui/i }));
    expect(await screen.findByText("Network unavailable")).toBeVisible();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toBase58, toBase64 } from "@mysten/sui/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  account: null as { address: string } | null,
  client: {
    getBalance: vi.fn(),
    waitForTransaction: vi.fn(),
  },
  dAppKit: {
    signAndExecuteTransaction: vi.fn(),
  },
}));

vi.mock("@mysten/dapp-kit-react", () => ({
  useCurrentAccount: () => wallet.account,
  useCurrentClient: () => wallet.client,
  useDAppKit: () => wallet.dAppKit,
}));

import { PaymentWorkspace } from "./PaymentWorkspace";
import { calculateTotals, createProofPayload, hashProofPayload } from "../lib/order";
import type { OrderDraft } from "../types";

const PAYER = `0x${"a".repeat(64)}`;
const RECIPIENT = `0x${"b".repeat(64)}`;
const RECEIPT_ID = `0x${"c".repeat(64)}`;
const DIGEST = toBase58(new Uint8Array(32).fill(5));

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentWorkspace />
    </QueryClientProvider>,
  );
}

async function fillValidOrder() {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Order or invoice number"));
  await user.type(screen.getByLabelText("Order or invoice number"), "INV-9001");
  await user.type(screen.getByLabelText(/^SME recipient wallet/), RECIPIENT);
  await user.type(screen.getByLabelText("Description"), "Consulting service");
  await user.type(screen.getByLabelText(/^Unit price/), "25.00");
  await waitFor(() =>
    expect(screen.getByLabelText(/^Amount to pay in USDC/)).toHaveValue("25.00"),
  );
  return user;
}

async function successfulEvent() {
  const draft: OrderDraft = {
    orderReference: "INV-9001",
    recipient: RECIPIENT,
    customerName: "",
    lineItems: [
      { id: "irrelevant", description: "Consulting service", quantity: 1, unitPrice: "25.00" },
    ],
    discount: "",
    taxRate: "",
    notes: "",
    asset: "USDC",
    settlementAmount: "25.00",
  };
  const payload = createProofPayload(draft, calculateTotals(draft));
  const hash = await hashProofPayload(payload);
  return {
    Transaction: {
      digest: DIGEST,
      events: [
        {
          eventType: "0x9::payproof::PaymentRecorded<0x2::sui::SUI>",
          json: {
            receipt_id: RECEIPT_ID,
            payer: PAYER,
            recipient: RECIPIENT,
            amount: "25000000",
            order_hash: toBase64(Uint8Array.from(hash.bytes)),
            order_reference: "INV-9001",
            paid_at_ms: "1800000000000",
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
    return array;
  });
  wallet.account = null;
  wallet.client.getBalance.mockResolvedValue({ balance: { balance: "1000000000" } });
  wallet.client.waitForTransaction.mockReset();
  wallet.dAppKit.signAndExecuteTransaction.mockReset();
});

describe("payment workspace actions", () => {
  it("requires a connected wallet before review", async () => {
    renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: /review payment/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/connect a wallet/i);
  });

  it("adds and removes line items and switches settlement assets", async () => {
    wallet.account = { address: PAYER };
    renderWorkspace();
    const user = await fillValidOrder();

    await user.click(screen.getByRole("button", { name: /add item/i }));
    expect(screen.getAllByLabelText("Description")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /remove line item 2/i }));
    expect(screen.getAllByLabelText("Description")).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "SUI" }));
    expect(screen.getByLabelText(/^Amount to pay in SUI/)).not.toHaveAttribute("readonly");
    await user.click(screen.getByRole("radio", { name: "USDC" }));
    expect(screen.getByLabelText(/^Amount to pay in USDC/)).toHaveAttribute("readonly");
  });

  it("blocks review when the wallet balance is insufficient", async () => {
    wallet.account = { address: PAYER };
    wallet.client.getBalance.mockResolvedValue({ balance: { balance: "1" } });
    renderWorkspace();
    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /review payment/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/needs more USDC/i);
  });

  it("reviews, signs once, indexes the event, and saves a receipt", async () => {
    wallet.account = { address: PAYER };
    wallet.dAppKit.signAndExecuteTransaction.mockResolvedValue({
      Transaction: { digest: DIGEST },
    });
    wallet.client.waitForTransaction.mockResolvedValue(await successfulEvent());
    renderWorkspace();
    const user = await fillValidOrder();

    await user.click(screen.getByRole("button", { name: /review payment/i }));
    expect(await screen.findByText("Review before signing")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /pay 25.00 USDC/i }));

    expect(await screen.findByText("The order and payment now match.")).toBeVisible();
    expect(wallet.dAppKit.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.client.waitForTransaction).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("payproof.receipts.v1")).toContain("INV-9001");
  });

  it("preserves a submitted digest and retries indexing without paying twice", async () => {
    wallet.account = { address: PAYER };
    wallet.dAppKit.signAndExecuteTransaction.mockResolvedValue({
      Transaction: { digest: DIGEST },
    });
    wallet.client.waitForTransaction
      .mockRejectedValueOnce(new Error("indexer timeout"))
      .mockResolvedValueOnce(await successfulEvent());
    renderWorkspace();
    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /review payment/i }));
    await user.click(screen.getByRole("button", { name: /pay 25.00 USDC/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not pay again/i);
    expect(screen.getByRole("button", { name: /edit order/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /retry receipt check/i }));

    expect(await screen.findByText("The order and payment now match.")).toBeVisible();
    expect(wallet.dAppKit.signAndExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.client.waitForTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns to review when the wallet request is rejected", async () => {
    wallet.account = { address: PAYER };
    wallet.dAppKit.signAndExecuteTransaction.mockRejectedValue(
      new Error("User rejected request"),
    );
    renderWorkspace();
    const user = await fillValidOrder();
    await user.click(screen.getByRole("button", { name: /review payment/i }));
    await user.click(screen.getByRole("button", { name: /pay 25.00 USDC/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled.*no funds moved/i);
    expect(wallet.client.waitForTransaction).not.toHaveBeenCalled();
  });
});

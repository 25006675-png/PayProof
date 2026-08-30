import type { AssetSymbol } from "./config";

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
}

export interface OrderDraft {
  orderReference: string;
  recipient: string;
  customerName: string;
  lineItems: LineItem[];
  discount: string;
  taxRate: string;
  notes: string;
  asset: AssetSymbol;
  settlementAmount: string;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface ProofPayload {
  schema: "payproof-order-v1";
  commitmentNonce: string;
  orderReference: string;
  recipient: string;
  customerName: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  subtotalCents: number;
  discountCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  displayCurrency: "USD";
  settlementAsset: AssetSymbol;
  settlementAmount: string;
  notes: string;
}

export interface PayProofReceipt {
  format: "payproof-receipt";
  version: 1;
  network: "testnet";
  packageId: string;
  digest: string;
  receiptId: string;
  payer: string;
  recipient: string;
  asset: AssetSymbol;
  coinType: string;
  amount: string;
  amountUnits: string;
  orderHash: string;
  paidAtMs: number;
  order: ProofPayload;
}

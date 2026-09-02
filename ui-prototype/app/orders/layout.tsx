import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orders | ProofPay",
  description: "Every purchase order where you are the buyer or the supplier.",
};

export default function OrdersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

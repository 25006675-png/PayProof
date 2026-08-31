import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orders | ProofPay",
  description: "Manage buying and supplying purchase orders from one role-aware register.",
};

export default function OrdersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

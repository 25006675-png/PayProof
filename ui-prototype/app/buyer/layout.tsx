import type { Metadata } from "next";

export const metadata: Metadata = { title: "Buyer Workspace | ProofPay", description: "Manage delivery-linked purchase orders and escrow settlement." };

export default function BuyerLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

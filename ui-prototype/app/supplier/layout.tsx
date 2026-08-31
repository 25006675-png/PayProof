import type { Metadata } from "next";

export const metadata: Metadata = { title: "Supplier Workspace | ProofPay", description: "Verify secured orders, submit delivery evidence and track settlement." };

export default function SupplierLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

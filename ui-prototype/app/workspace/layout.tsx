import type { Metadata } from "next";

export const metadata: Metadata = { title: "Overview | ProofPay", description: "Orders that need your action, and where your money is." };

export default function UnifiedLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

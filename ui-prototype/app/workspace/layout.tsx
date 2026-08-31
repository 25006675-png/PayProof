import type { Metadata } from "next";

export const metadata: Metadata = { title: "Unified Workspace | ProofPay", description: "Manage buying and supplying activity in one role-aware ProofPay workspace." };

export default function UnifiedLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

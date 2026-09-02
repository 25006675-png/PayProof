import type { Metadata } from "next";

export const metadata: Metadata = { title: "Wallet | ProofPay", description: "Available balance, secured funds and wallet activity." };

export default function WalletLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }

import type { Metadata } from "next";
import "./globals.css";
import { ClientShell } from "./client-shell";

export const metadata: Metadata = {
  title: "ProofPay Ledger Light",
  description:
    "Delivery-linked B2B settlement that releases accepted value and protects genuine disputes.",
  icons: {
    icon: "/proofpay-logo.png",
    shortcut: "/proofpay-logo.png",
    apple: "/proofpay-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}

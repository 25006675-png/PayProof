import type { Metadata } from "next";
import "./globals.css";
import "./app-shell.css";
import "./app-shell-2.css";
import "./app-shell-3.css";
import "./app-shell-4.css";
import "./app-shell-5.css";
import { ClientShell } from "./client-shell";

export const metadata: Metadata = {
  title: "ProofPay Ledger Light",
  description:
    "Delivery-linked B2B settlement that releases accepted value and protects genuine disputes.",
  icons: {
    icon: "/assets/proofpay-logo.jpg",
    shortcut: "/assets/proofpay-logo.jpg",
    apple: "/assets/proofpay-logo.jpg",
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

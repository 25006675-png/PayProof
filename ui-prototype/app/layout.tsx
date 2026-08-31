import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofPay Ledger Light",
  description: "Delivery-linked B2B settlement that releases accepted value and protects genuine disputes.",
  icons: { icon: "/proofpay-logo.png", shortcut: "/proofpay-logo.png", apple: "/proofpay-logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

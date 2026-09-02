"use client";

import { ArrowLeft } from "lucide-react";
import { LiveTradeConsole } from "@/app/components/LiveTradeConsole";

export default function ConsolePage() {
  return (
    <div className="console-shell">
      <a className="back-link console-back" href="/orders"><ArrowLeft size={14} aria-hidden="true" />Back to orders</a>
      <LiveTradeConsole />
    </div>
  );
}

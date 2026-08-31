"use client";

import { ArrowLeftRight, ArrowRight, BadgeCheck, Bell, Box, Building2, ChevronDown, CircleDollarSign, Plus, QrCode, ShieldCheck, Truck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";

function Logo() { return <a className="logo" href="/"><span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/proofpay-logo.png" alt="" width="40" height="40" /></span><span>ProofPay</span></a>; }

function NewTrade() {
  return <Button className="app-primary" asChild><a href="/orders?action=create"><Plus size={16} />New purchase order</a></Button>;
}

function RoleBadge({ role }: { role: "BUYER" | "SUPPLIER" }) {
  return <span className={role === "BUYER" ? "trade-role trade-role-buyer" : "trade-role trade-role-supplier"}>{role === "BUYER" ? <Building2 size={14} /> : <Box size={14} />}{role}</span>;
}

export default function UnifiedWorkspace() {
  return (
    <div className="buyer-shell unified-shell">
      <header className="app-header"><Logo /><nav><a className="nav-active" href="/workspace">Overview</a><a href="/orders">Orders</a><a href="/wallet">Wallet</a><a href="#deliveries">Activity</a></nav><div className="app-user"><button className="app-icon" aria-label="Notifications"><Bell size={17} /></button><button className="user-button"><span className="user-avatar unified-avatar"><ArrowLeftRight size={16} /></span><span><strong>GreenBite Trading</strong><small>Business workspace</small></span><ChevronDown size={14} /></button></div></header>
      <main className="buyer-main">
        <section className="unified-guardrail"><ShieldCheck size={17} /><p><strong>One organisation, two trading capabilities.</strong><span>Your role is fixed separately on every purchase order; the same organisation cannot be both sides of one trade.</span></p><BadgeCheck size={18} /></section>
        <section className="app-title unified-title"><div><span>BUYER & SUPPLIER WORKSPACE · SUI TESTNET</span><h1>See both sides. Never mix them.</h1><p>Inspect the goods you buy, fulfil the orders you supply and follow every protected settlement from one operating view.</p></div><NewTrade /></section>

        <a className="wallet-entry" href="/wallet" aria-label="Open ProofPay Wallet">
          <span className="wallet-entry-icon"><WalletCards size={22} /></span>
          <span className="wallet-entry-balance"><small>PROOFPAY WALLET · AVAILABLE BALANCE</small><strong>12,480 <em>USDC</em></strong><p>Spendable and withdrawable — always separate from escrow.</p></span>
          <span className="wallet-entry-actions"><i>TOP UP</i><i>WITHDRAW</i><i><QrCode size={13} />B2C QR</i></span>
          <ArrowRight size={19} />
        </a>

        <section className="summary-rule unified-summary"><article><span>BUYING · SECURED OUTGOING</span><strong>70,400 <small>USDC</small></strong><p>Protected across three purchase orders</p></article><article><span>SUPPLYING · SECURED INCOMING</span><strong>44,500 <small>USDC</small></strong><p>Backed by buyer escrow</p></article><article><span>RELEASE READY</span><strong>26,100 <small>USDC</small></strong><p>Accepted supplier value</p></article><article><span>ACTION NEEDED</span><strong>4</strong><p>Two to inspect · two to fulfil</p></article></section>

        <section id="deliveries" className="unified-lanes">
          <article className="work-panel trade-lane buyer-lane"><div className="lane-head"><div><span className="card-label">PURCHASING LANE · ORDERS TO INSPECT</span><h2>Your buying orders</h2></div><a className="lane-view-all" href="/orders?role=buyer">View buying <ArrowRight size={13} /></a></div><div className="lane-order lane-order-primary"><div className="lane-order-top"><RoleBadge role="BUYER" /><span className="status-chip">43h 12m left</span></div><h3>PO-2471 · Cooking oil</h3><p>FreshSource Foods · 100 cartons delivered</p><div className="lane-money"><span><small>ESCROWED</small><strong>30,000 USDC</strong></span><span><small>DELIVERY</small><strong>Ready to inspect</strong></span></div><a href="/orders?role=buyer&order=PO-2471">Review delivery <ArrowRight size={15} /></a></div><div className="lane-order"><div className="lane-order-top"><RoleBadge role="BUYER" /><span className="muted-time">Arrives tomorrow</span></div><h3>PO-2468 · Food-grade packaging</h3><p>Apex Packaging · Logistics evidence attached</p><div className="lane-compact"><Truck size={15} /><span>In transit</span><strong>18,400 USDC</strong></div></div></article>

          <article className="work-panel trade-lane supplier-lane"><div className="lane-head"><div><span className="card-label">SUPPLY LANE · ORDERS TO FULFIL</span><h2>Your supply orders</h2></div><a className="lane-view-all" href="/orders?role=supplier">View supplying <ArrowRight size={13} /></a></div><div className="lane-order lane-order-primary"><div className="lane-order-top"><RoleBadge role="SUPPLIER" /><span className="secured-chip"><i />Payment secured</span></div><h3>PO-2470 · Pantry essentials</h3><p>Kita Grocer · 14,500 USDC locked</p><div className="lane-money"><span><small>YOUR NEXT STEP</small><strong>Prepare shipment</strong></span><span><small>PAYOUT ADDRESS</small><strong>0x71F…9A2</strong></span></div><a href="/orders?role=supplier&order=PO-2470">Open supplier order <ArrowRight size={15} /></a></div><div className="lane-order"><div className="lane-order-top"><RoleBadge role="SUPPLIER" /><span className="muted-time">Accepted 12m ago</span></div><h3>PO-2463 · Cooking supplies</h3><p>Bowl & Co. · 87 units accepted</p><div className="lane-compact"><CircleDollarSign size={15} /><span>Release ready</span><strong>9,800 USDC</strong></div></div></article>
        </section>

        <a className="all-orders-entry" href="/orders"><span><small>COMPLETE ORDER REGISTER</small><strong>All buying and supplying orders now live in one filtered list.</strong></span><span>Open Orders <ArrowRight size={16} /></span></a>

        <footer className="app-footer"><span><ShieldCheck size={14} />Role permissions are enforced per order, not by a visual switch.</span><span>Demo Unified Workspace · Sui Testnet</span></footer>
      </main>
    </div>
  );
}

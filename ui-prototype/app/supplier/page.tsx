"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, BadgeCheck, Bell, Box, Building2, Camera, Check, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileCheck2, Link2, LockKeyhole, MessageSquareText, PackageCheck, QrCode, ShieldCheck, Truck, Upload, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const incomingOrders = [
  ["PO-2471", "GreenBite Foods", "Prepare shipment", "30,000"],
  ["PO-2470", "Kita Grocer", "Payment secured", "14,500"],
  ["PO-2463", "Bowl & Co.", "Buyer inspection", "9,800"],
  ["PO-2454", "Sunrise Mart", "Partially settled", "12,400"],
];

type PendingLineItem = { id: number; description: string; sku: string; quantity: number; unit: string; unitPrice: number };
type PendingOrder = { id: string; buyer: string; supplier: string; delivery: string; location: string; itemSummary: string; items: PendingLineItem[]; value: number; sentAt?: string };
type OrderResponse = "pending" | "confirmed" | "changes";

const defaultPendingOrder: PendingOrder = {
  id: "PO-2475",
  buyer: "GreenBite Foods",
  supplier: "FreshSource Foods Sdn. Bhd.",
  delivery: "08 Sep 2026",
  location: "GreenBite Receiving Bay · PJ",
  itemSummary: "Premium cooking oils · 3 line items",
  value: 23660,
  items: [
    { id: 1, description: "Premium sunflower cooking oil 20L", sku: "FS-SF20", quantity: 60, unit: "Carton", unitPrice: 282 },
    { id: 2, description: "Canola cooking oil 20L", sku: "FS-CA20", quantity: 20, unit: "Carton", unitPrice: 295 },
    { id: 3, description: "Reusable food-grade drum", sku: "FS-DRM", quantity: 4, unit: "Unit", unitPrice: 210 },
  ],
};

const money = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

function Logo() { return <a className="logo" href="/"><span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" /></span><span>ProofPay</span></a>; }

function ConfirmIncomingOrder({ order, response, onConfirm, onRequestChanges }: { order: PendingOrder; response: OrderResponse; onConfirm: () => void; onRequestChanges: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className={response === "pending" ? "incoming-review-button" : "incoming-status-button"}>{response === "confirmed" ? "View confirmed terms" : response === "changes" ? "Review requested changes" : "Review & confirm"}<ArrowRight size={15} /></Button></DialogTrigger>
      <DialogContent className="order-dialog supplier-confirm-dialog">
        <DialogHeader><span className="card-label">SUPPLIER CONFIRMATION · {order.id}</span><DialogTitle>Confirm the commercial terms</DialogTitle><DialogDescription>Check the buyer, products, pricing and delivery terms. Confirmation tells the buyer it is safe to fund escrow; it does not move money yet.</DialogDescription></DialogHeader>
        <div className="incoming-dialog-parties"><div><span><Building2 size={16} /></span><p><small>BUYER</small><strong>{order.buyer}</strong></p></div><ArrowRight size={16} /><div><span><Box size={16} /></span><p><small>SUPPLIER</small><strong>{order.supplier}</strong></p></div></div>
        <div className="incoming-dialog-facts"><div><span>EXPECTED DELIVERY</span><strong>{order.delivery}</strong></div><div><span>DELIVERY LOCATION</span><strong>{order.location}</strong></div><div><span>ORDER VALUE</span><strong>{money(order.value)} USDC</strong></div></div>
        <div className="incoming-items-shell"><div><span>ORDER CONTENTS</span><strong>{order.items.length} LINE ITEMS</strong></div><Table className="incoming-items-table"><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead className="table-amount">Total</TableHead></TableRow></TableHeader><TableBody>{order.items.map((item) => <TableRow key={item.id}><TableCell><strong>{item.description || "Product pending"}</strong><small>{item.sku || "No SKU"} · {money(item.unitPrice)} USDC / {item.unit}</small></TableCell><TableCell>{money(item.quantity)} {item.unit}</TableCell><TableCell className="table-amount">{money(item.quantity * item.unitPrice)}</TableCell></TableRow>)}</TableBody></Table></div>
        <div className="supplier-confirm-rule"><ShieldCheck size={16} /><span><strong>Confirmation locks the agreed order record.</strong><small>The buyer funds escrow only after your acceptance. You ship only after ProofPay shows payment secured.</small></span></div>
        <DialogFooter className="supplier-confirm-actions">{response === "pending" ? <><Button variant="outline" onClick={() => { onRequestChanges(); setOpen(false); }}><MessageSquareText size={15} />Request changes</Button><Button className="app-primary" onClick={() => { onConfirm(); setOpen(false); }}><Check size={15} />Confirm order</Button></> : <><span className={`confirmation-result result-${response}`}>{response === "confirmed" ? <CheckCircle2 size={15} /> : <MessageSquareText size={15} />}{response === "confirmed" ? "Confirmed · buyer may fund escrow" : "Changes requested · buyer notified"}</span><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrepareShipment({ onPrepared }: { onPrepared: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="app-primary"><Truck size={16} />Prepare shipment</Button></DialogTrigger>
      <DialogContent className="order-dialog supplier-dialog">
        <DialogHeader><span className="card-label">FUNDS VERIFIED · PO-2471</span><DialogTitle>Prepare shipment</DialogTitle><DialogDescription>Add the logistics reference and evidence bundle. Commercial files remain private; ProofPay anchors only their hashes.</DialogDescription></DialogHeader>
        <div className="dialog-form"><label><span>Logistics provider</span><Input defaultValue="Ninja Van Business" /></label><label><span>Tracking reference</span><Input defaultValue="NVB-884291" /></label><label><span>Shipment note</span><Input defaultValue="100 cartons · cooking oil" /></label></div>
        <div className="evidence-drop"><Upload size={19} /><div><strong>Attach packing list and dispatch photos</strong><span>PDF, JPG or PNG · files stay off-chain</span></div><button type="button">Choose files</button></div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Save draft</Button><Button className="app-primary" onClick={() => { onPrepared(); setOpen(false); }}>Mark as shipped <ArrowRight size={15} /></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryQR({ onGenerated }: { onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button className="qr-trigger" type="button"><QrCode size={16} />Generate delivery QR</button></DialogTrigger>
      <DialogContent className="delivery-qr-dialog">
        <DialogHeader><span className="card-label">AUTHORIZED DELIVERY SESSION</span><DialogTitle>PO-2471 delivery QR</DialogTitle><DialogDescription>The receiving employee scans this code to open the quantity and condition check. Scanning alone never releases funds.</DialogDescription></DialogHeader>
        <div className="qr-dialog-grid"><div className="qr-code qr-code-large" aria-label="Demo dynamic delivery QR code"><span /></div><div className="qr-session-copy"><span className="qr-live"><i />LIVE · ROTATES IN 01:42</span><h3>GreenBite Foods receiving dock</h3><p>100 cartons · Cooking oil<br />Session DL-2471-08F2</p><div><LockKeyhole size={14} />Authorized buyer confirmation required</div></div></div>
        <div className="qr-warning"><ShieldCheck size={16} /><p><strong>QR links the physical handover to this order.</strong><span>Accepted quantity and an authorized buyer signature determine settlement.</span></p></div>
        <DialogFooter><Button variant="outline">Download label</Button><Button className="app-primary" onClick={() => { onGenerated(); setOpen(false); }}><Link2 size={15} />Copy secure link</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SupplierWorkspace() {
  const [notice, setNotice] = useState<"prepared" | "qr" | "evidence" | "confirmed" | "changes" | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder>(defaultPendingOrder);
  const [orderResponse, setOrderResponse] = useState<OrderResponse>("pending");
  const steps = [
    { icon: Check, label: "Accepted", note: "24 Aug" },
    { icon: LockKeyhole, label: "Funded", note: "30,000 USDC" },
    { icon: Box, label: "Packing", note: "Your action" },
    { icon: Truck, label: "Deliver", note: "Evidence next" },
  ];

  useEffect(() => {
    const storedOrder = window.localStorage.getItem("proofpay_pending_order");
    const storedResponse = window.localStorage.getItem("proofpay_order_response") as OrderResponse | null;
    if (storedOrder) {
      try {
        const parsed = JSON.parse(storedOrder) as PendingOrder;
        setPendingOrder({ ...parsed, buyer: parsed.buyer || "GreenBite Foods" });
      } catch {
        window.localStorage.removeItem("proofpay_pending_order");
      }
    }
    if (storedResponse === "confirmed" || storedResponse === "changes" || storedResponse === "pending") setOrderResponse(storedResponse);
  }, []);

  const confirmOrder = () => {
    setOrderResponse("confirmed");
    window.localStorage.setItem("proofpay_order_response", "confirmed");
    setNotice("confirmed");
  };

  const requestChanges = () => {
    setOrderResponse("changes");
    window.localStorage.setItem("proofpay_order_response", "changes");
    setNotice("changes");
  };

  const displayedOrders = [[pendingOrder.id, pendingOrder.buyer, orderResponse === "confirmed" ? "Confirmed · awaiting funding" : orderResponse === "changes" ? "Changes requested" : "Confirmation required", money(pendingOrder.value)], ...incomingOrders];

  return (
    <div className="buyer-shell supplier-shell">
      <header className="app-header"><Logo /><nav><a href="#">Overview</a><a href="#orders">Orders</a><a href="#shipments">Shipments</a><a href="#evidence">Evidence</a><a href="#payouts">Payouts</a></nav><div className="app-user"><a className="workspace-return" href="/workspace" aria-label="Return to unified workspace"><ArrowLeftRight size={15} /><span>Unified workspace</span></a><button className="app-icon notification-button" aria-label={`${orderResponse === "pending" ? 1 : 0} unread order notifications`}><Bell size={17} />{orderResponse === "pending" && <span>1</span>}</button><button className="user-button"><span className="user-avatar">FS</span><span><strong>FreshSource</strong><small>Supplier workspace</small></span><ChevronDown size={14} /></button></div></header>
      <main className="buyer-main">
        {notice && <div className="app-alert supplier-alert"><CheckCircle2 size={17} /><span>{notice === "confirmed" ? `${pendingOrder.id} confirmed. ${pendingOrder.buyer} can now fund escrow.` : notice === "changes" ? `Changes requested for ${pendingOrder.id}. The buyer has been notified.` : notice === "prepared" ? "PO-2471 marked as shipped. The buyer can now follow the delivery record." : notice === "qr" ? "Secure delivery link copied. This QR opens verification but cannot release payment by itself." : "Evidence bundle attached. Its hash is ready to anchor to PO-2471."}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
        <section className="app-title"><div><span>SUPPLIER WORKSPACE · SUI TESTNET</span><h1>Ship against money you can verify.</h1><p>{orderResponse === "pending" ? "One new purchase order needs your confirmation. Three funded orders are ready for fulfilment." : "Three funded orders are ready. Payment becomes receivable as soon as the buyer accepts delivery."}</p></div><PrepareShipment onPrepared={() => setNotice("prepared")} /></section>

        <section className={`supplier-incoming-request request-${orderResponse}`}>
          <div className="incoming-request-mark">{orderResponse === "confirmed" ? <CheckCircle2 size={22} /> : orderResponse === "changes" ? <MessageSquareText size={22} /> : <Bell size={22} />}</div>
          <div className="incoming-request-copy"><span>{orderResponse === "confirmed" ? "ORDER CONFIRMED · WAITING FOR BUYER FUNDING" : orderResponse === "changes" ? "CHANGES REQUESTED · BUYER NOTIFIED" : "NEW PURCHASE ORDER · YOUR CONFIRMATION REQUIRED"}</span><h2>{pendingOrder.id} · {pendingOrder.itemSummary}</h2><p>{pendingOrder.buyer} · Delivery {pendingOrder.delivery} · {pendingOrder.location}</p></div>
          <div className="incoming-request-value"><small>ORDER VALUE</small><strong>{money(pendingOrder.value)} <span>USDC</span></strong></div>
          <ConfirmIncomingOrder order={pendingOrder} response={orderResponse} onConfirm={confirmOrder} onRequestChanges={requestChanges} />
        </section>

        <section className="summary-rule supplier-summary"><article><span>SECURED ORDER VALUE</span><strong>70,400 <small>USDC</small></strong><p>Funds visible before dispatch</p></article><article><span>READY TO SHIP</span><strong>2</strong><p>Both orders fully funded</p></article><article><span>RELEASE READY</span><strong>26,100 <small>USDC</small></strong><p>Accepted by GreenBite</p></article><article><span>HELD IN EXCEPTION</span><strong>3,900 <small>USDC</small></strong><p>Only disputed value remains</p></article></section>

        <section id="shipments" className="supplier-focus-grid">
          <article className="work-panel focus-order supplier-focus"><div className="focus-head"><div><span className="card-label">PAYMENT SECURED · YOUR ACTION</span><h2>Prepare the funded shipment</h2></div><span className="secured-chip"><i />30,000 USDC locked</span></div><div className="order-line"><span className="supplier-avatar">GB</span><div><strong>GreenBite Foods</strong><small>PO-2471 · Cooking oil · 100 cartons</small></div><div className="order-money"><small>PAYOUT ADDRESS</small><strong>0x71F…9A2</strong></div></div><div className="mini-flow">{steps.map((step,index) => { const StepIcon = step.icon; return <div key={step.label} className={index < 2 ? "done" : index === 2 ? "current" : ""}><span><StepIcon size={14} /></span><strong>{step.label}</strong><small>{step.note}</small></div>; })}</div><div className="focus-actions supplier-actions"><p><ShieldCheck size={15} />Payout address was snapshotted when this PO was funded.</p><div><button className="evidence-button" type="button" onClick={() => setNotice("evidence")}><FileCheck2 size={15} />Attach evidence</button><DeliveryQR onGenerated={() => setNotice("qr")} /></div></div></article>

          <article id="payouts" className="work-panel supplier-payout"><span className="card-label">PARTIAL SETTLEMENT</span><h2>Accepted value moves first.</h2><div className="payout-total"><span>RELEASE READY</span><strong>26,100 <small>USDC</small></strong></div><div className="payout-split"><div><i /><span>87 accepted cartons</span><strong>26,100</strong></div><div><i /><span>13 in exception</span><strong>3,900</strong></div></div><p><Clock3 size={14} />The accepted portion can settle without waiting for the remaining dispute.</p></article>

          <article className="work-panel qr-session-card"><div className="qr-card-copy"><span className="card-label">OPTIONAL DELIVERY LINK</span><h2>Dynamic receiving session</h2><p>Give the package a scannable link to PO-2471. The buyer still decides accepted, missing and damaged quantities.</p><span className="qr-live"><i />SESSION READY</span></div><div className="qr-code" aria-label="Demo delivery QR code"><span /></div></article>
        </section>

        <section id="orders" className="second-grid supplier-second-grid"><article className="work-panel orders-panel"><div className="panel-head"><div><span className="card-label">INCOMING TRADE PIPELINE</span><h2>Incoming purchase orders</h2></div><button>View all <ArrowRight size={14} /></button></div><Table className="order-table"><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Buyer</TableHead><TableHead>Status</TableHead><TableHead className="table-amount">Value</TableHead></TableRow></TableHeader><TableBody>{displayedOrders.map((order) => <TableRow key={order[0]}><TableCell><strong>{order[0]}</strong><small>Verified counterparty</small></TableCell><TableCell>{order[1]}</TableCell><TableCell>{order[2]}</TableCell><TableCell className="table-amount">{order[3]} USDC</TableCell></TableRow>)}</TableBody></Table></article><article id="evidence" className="work-panel activity-panel"><div className="panel-head"><div><span className="card-label">SHARED RECORD</span><h2>Supplier activity</h2></div></div><div className="activity-list"><article><span><BadgeCheck size={15} /></span><div><strong>Buyer accepted 87 cartons</strong><p>26,100 USDC is ready to release for PO-2463.</p><small>12 minutes ago</small></div></article><article><span><Camera size={15} /></span><div><strong>Evidence hash anchored</strong><p>Six dispatch photos linked to PO-2454.</p><small>Yesterday, 5:18 PM</small></div></article><article><span><WalletCards size={15} /></span><div><strong>Payment secured</strong><p>Kita Grocer funded PO-2470 in full.</p><small>Yesterday, 2:42 PM</small></div></article></div></article></section>

        <section className="supplier-record-strip"><span><PackageCheck size={17} />SETTLEMENT RECEIPT</span><p>PO-2454 · 12,400 USDC distributed through one programmable transaction.</p><a href="#">View on Sui Explorer <ExternalLink size={14} /></a></section>
        <footer className="app-footer"><span><ShieldCheck size={14} />ProofPay cannot redirect or withdraw your secured receivables.</span><span>Demo Supplier Workspace · Sui Testnet</span></footer>
      </main>
    </div>
  );
}

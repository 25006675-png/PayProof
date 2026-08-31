"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, ArrowRight, BadgeCheck, Bell, Box, Building2, Check,
  CheckCircle2, ChevronDown, CircleDollarSign, ClipboardCheck, FileCheck2,
  LockKeyhole, Plus, Search, ShieldCheck, Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type OrderRole = "BUYER" | "SUPPLIER";
type RoleFilter = "all" | "buyer" | "supplier";
type Order = {
  id: string;
  role: OrderRole;
  counterparty: string;
  item: string;
  itemNote: string;
  status: string;
  value: number;
  delivery: string;
  nextAction: string;
  settlement?: {
    acceptedPercent: number;
    released: number;
    held: number;
  };
};

const initialOrders: Order[] = [
  { id: "PO-2475", role: "SUPPLIER", counterparty: "Sunrise Mart", item: "Premium cooking oils", itemNote: "3 line items · 84 units", status: "Confirmation required", value: 23660, delivery: "08 Sep 2026", nextAction: "Confirm commercial terms" },
  { id: "PO-2471", role: "BUYER", counterparty: "FreshSource Foods", item: "Cooking oil", itemNote: "100 cartons delivered", status: "Inspection due", value: 30000, delivery: "Delivered 29 Aug", nextAction: "Review delivered quantities" },
  { id: "PO-2470", role: "SUPPLIER", counterparty: "Kita Grocer", item: "Pantry essentials", itemNote: "Payment secured", status: "Prepare shipment", value: 14500, delivery: "04 Sep 2026", nextAction: "Attach dispatch evidence" },
  { id: "PO-2468", role: "BUYER", counterparty: "Apex Packaging", item: "Food-grade packaging", itemNote: "Logistics evidence attached", status: "In transit", value: 18400, delivery: "Arrives tomorrow", nextAction: "Track delivery" },
  { id: "PO-2463", role: "SUPPLIER", counterparty: "Bowl & Co.", item: "Cooking supplies", itemNote: "87 units accepted", status: "Release ready", value: 9800, delivery: "Accepted 12m ago", nextAction: "Receive accepted value" },
  { id: "PO-2459", role: "BUYER", counterparty: "Metro Ingredients", item: "Dry ingredients", itemNote: "Escrow fully funded", status: "Funds secured", value: 22000, delivery: "06 Sep 2026", nextAction: "Await supplier dispatch" },
];

const money = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

function Logo() {
  return <a className="logo" href="/"><span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/proofpay-logo.png" alt="" width="40" height="40" /></span><span>ProofPay</span></a>;
}

function RoleBadge({ role }: { role: OrderRole }) {
  return <span className={role === "BUYER" ? "trade-role trade-role-buyer" : "trade-role trade-role-supplier"}>{role === "BUYER" ? <Building2 size={14} /> : <Box size={14} />}{role}</span>;
}

function CreatePurchaseOrder({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (order: Order) => void }) {
  const [role, setRole] = useState<OrderRole>("BUYER");
  const [counterparty, setCounterparty] = useState("FreshSource Foods Sdn. Bhd.");
  const [product, setProduct] = useState("Premium sunflower cooking oil 20L");
  const [quantity, setQuantity] = useState(60);
  const [unitPrice, setUnitPrice] = useState(282);
  const total = quantity * unitPrice;
  const isBuying = role === "BUYER";

  const selectRole = (value: string) => {
    const nextRole = value as OrderRole;
    setRole(nextRole);
    setCounterparty(nextRole === "BUYER" ? "FreshSource Foods Sdn. Bhd." : "Sunrise Mart Sdn. Bhd.");
  };

  const submit = () => {
    onCreate({ id: "PO-2476", role, counterparty: counterparty || `${isBuying ? "Supplier" : "Buyer"} pending`, item: product || "Product pending", itemNote: `${quantity} cartons · ${money(unitPrice)} USDC each`, status: isBuying ? "Awaiting supplier" : "Awaiting buyer", value: total, delivery: "10 Sep 2026", nextAction: isBuying ? "Wait for supplier confirmation" : "Wait for buyer confirmation and funding" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="order-dialog unified-order-create">
        <DialogHeader><span className="card-label">NEW PURCHASE ORDER · {isBuying ? "BUYING" : "SUPPLYING"} ROLE</span><DialogTitle>{isBuying ? "Create a buying order" : "Create a supplying order"}</DialogTitle><DialogDescription>{isBuying ? "Send the shared terms to your supplier. They confirm before funding becomes available." : "Record the agreed terms and send them to the buyer. They confirm and fund escrow before you ship."}</DialogDescription></DialogHeader>
        <div className="create-role-choice"><span>YOUR ROLE ON THIS ORDER</span><RadioGroup value={role} onValueChange={selectRole} className="create-role-options"><label className={isBuying ? "role-option role-option-active" : "role-option"} htmlFor="create-role-buyer"><span className="role-option-icon"><Building2 size={17} /></span><span><strong>Buying</strong><small>You issue the order and fund escrow</small></span><RadioGroupItem id="create-role-buyer" value="BUYER" aria-label="Create as buyer" /></label><label className={!isBuying ? "role-option role-option-active role-option-supplier" : "role-option role-option-supplier"} htmlFor="create-role-supplier"><span className="role-option-icon"><Box size={17} /></span><span><strong>Supplying</strong><small>You fulfil the order and receive payout</small></span><RadioGroupItem id="create-role-supplier" value="SUPPLIER" aria-label="Create as supplier" /></label></RadioGroup></div>
        <div className="create-order-parties"><span><Building2 size={16} /></span><div><small>BUYER</small><strong>{isBuying ? "GreenBite Trading" : counterparty || "Buyer pending"}</strong></div><ArrowRight size={16} /><span><Box size={16} /></span><div><small>SUPPLIER</small><strong>{isBuying ? counterparty || "Supplier pending" : "GreenBite Trading"}</strong></div></div>
        <div className="create-order-form"><label><span>{isBuying ? "Supplier" : "Buyer"}</span><Input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} /></label><label><span>Expected delivery</span><Input defaultValue="10 Sep 2026" /></label></div>
        <div className="line-item-editor"><div className="line-item-head"><span>PRODUCT</span><span>QUANTITY</span><span>UNIT PRICE</span><span>LINE TOTAL</span></div><div className="line-item-row"><Input value={product} onChange={(event) => setProduct(event.target.value)} /><Input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /><Input type="number" min={0} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} /><strong>{money(total)} USDC</strong></div></div>
        <div className="create-order-total"><span><ShieldCheck size={15} />{isBuying ? "Funding remains disabled until supplier confirmation." : "Shipping remains disabled until buyer confirmation and funding."}</span><strong>{money(total)} <small>USDC</small></strong></div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Save draft</Button><Button className="app-primary" onClick={submit}>Send to {isBuying ? "supplier" : "buyer"} <ArrowRight size={15} /></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderDetail({ order, open, onOpenChange, onAction }: { order: Order | null; open: boolean; onOpenChange: (open: boolean) => void; onAction: (order: Order) => void }) {
  if (!order) return null;
  const isBuyer = order.role === "BUYER";
  const actionLabel = order.status === "Confirmation required" ? "Confirm order" : order.status === "Inspection due" ? "Review delivery" : order.status === "Prepare shipment" ? "Prepare shipment" : order.nextAction;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="review-sheet unified-order-sheet">
        <SheetHeader className="sheet-head"><span className="card-label">SHARED ORDER RECORD · {order.id}</span><SheetTitle>{order.item}</SheetTitle><SheetDescription>Your authority and available actions come from your role on this purchase order.</SheetDescription></SheetHeader>
        <div className="sheet-body">
          <RoleBadge role={order.role} />
          <div className="order-detail-route"><div><span><Building2 size={16} /></span><small>{isBuyer ? "YOUR ORGANISATION" : "BUYER"}</small><strong>{isBuyer ? "GreenBite Trading" : order.counterparty}</strong></div><ArrowRight size={17} /><div><span><Box size={16} /></span><small>{isBuyer ? "SUPPLIER" : "YOUR ORGANISATION"}</small><strong>{isBuyer ? order.counterparty : "GreenBite Trading"}</strong></div></div>
          <section className="sheet-card order-detail-facts"><div><small>ORDER VALUE</small><strong>{money(order.value)} USDC</strong></div><div><small>STATUS</small><strong>{order.status}</strong></div><div><small>DELIVERY</small><strong>{order.delivery}</strong></div></section>
          {order.status === "Partially settled" && order.settlement && <section className="sheet-card settlement-progress"><div className="settlement-progress-head"><span>SETTLEMENT PROGRESS</span><strong>{order.settlement.acceptedPercent}% RELEASED</strong></div><div className="settlement-bar"><Progress value={order.settlement.acceptedPercent} aria-label={`${order.settlement.acceptedPercent}% of order value released`} /><div className="settlement-bar-labels"><span>{order.settlement.acceptedPercent}% accepted</span><span>{100 - order.settlement.acceptedPercent}% held</span></div></div><div className="settlement-breakdown"><div><i className="released-dot" /><span><small>RELEASED TO SUPPLIER</small><strong>{money(order.settlement.released)} USDC</strong></span></div><div><i className="held-dot" /><span><small>HELD IN DISPUTE</small><strong>{money(order.settlement.held)} USDC</strong></span></div></div><p>Accepted value is released immediately. Only the disputed portion remains locked.</p></section>}
          <section className="sheet-card"><span>ORDER CONTENTS</span><h3>{order.item}</h3><p className="sheet-evidence-copy">{order.itemNote}. Pricing and quantity terms are shared by both organisations and locked when escrow is funded.</p></section>
          <section className="order-control-principle"><LockKeyhole size={16} /><span><strong>{isBuyer ? "Buyer authority" : "Supplier authority"}</strong><small>{isBuyer ? "Fund escrow, inspect delivery and record accepted quantities." : "Confirm terms, attach shipment evidence and receive accepted value."}</small></span></section>
          <div className="order-action-box"><small>NEXT AUTHORIZED ACTION</small><strong>{actionLabel}</strong><p>{isBuyer ? "Your decision can release accepted value, but this screen cannot redirect supplier funds." : "Supplier actions can advance fulfilment, but cannot release buyer escrow without acceptance."}</p></div>
          <div className="sheet-buttons"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button className="app-primary" onClick={() => onAction(order)}>{order.status === "Confirmation required" ? <Check size={15} /> : isBuyer ? <ClipboardCheck size={15} /> : <Truck size={15} />}{actionLabel}</Button></div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderRegister({ orders, onSelect }: { orders: Order[]; onSelect: (order: Order) => void }) {
  return (
    <div className="order-register-table"><Table className="order-table"><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Your role</TableHead><TableHead>Counterparty</TableHead><TableHead>Contents</TableHead><TableHead>Status</TableHead><TableHead className="table-amount">Value</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{orders.length > 0 ? orders.map((order) => <TableRow key={order.id}><TableCell><strong>{order.id}</strong><small>{order.delivery}</small></TableCell><TableCell><RoleBadge role={order.role} /></TableCell><TableCell>{order.counterparty}</TableCell><TableCell><strong>{order.item}</strong><small>{order.itemNote}</small></TableCell><TableCell><span className={`order-status status-${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</span></TableCell><TableCell className="table-amount">{money(order.value)} USDC</TableCell><TableCell><button className="order-open" onClick={() => onSelect(order)}>Open <ArrowRight size={13} /></button></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="orders-empty"><Search size={18} /><strong>No matching orders</strong><small>Try another company, order number or status.</small></TableCell></TableRow>}</TableBody></Table></div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role === "buyer" || role === "supplier") setFilter(role);
    if (params.get("action") === "create") setCreateOpen(true);
    const orderId = params.get("order");
    if (orderId) setSelected(initialOrders.find((order) => order.id === orderId) || null);
  }, []);

  const visible = useMemo(() => orders.filter((order) => (filter === "all" || order.role.toLowerCase() === filter) && [order.id, order.counterparty, order.item, order.status].join(" ").toLowerCase().includes(query.toLowerCase())), [orders, filter, query]);
  const counts = { all: orders.length, buyer: orders.filter((order) => order.role === "BUYER").length, supplier: orders.filter((order) => order.role === "SUPPLIER").length };

  const actOnOrder = (order: Order) => {
    const nextStatus = order.status === "Confirmation required" ? "Awaiting buyer funding" : order.status === "Inspection due" ? "Partially settled" : order.status === "Prepare shipment" ? "Shipment prepared" : order.status;
    setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: nextStatus, ...(nextStatus === "Partially settled" ? { settlement: { acceptedPercent: 87, released: item.value * .87, held: item.value * .13 } } : {}) } : item));
    setNotice(`${order.id} updated: ${nextStatus}. Both parties now see the same order state.`);
    setSelected(null);
  };

  return (
    <div className="buyer-shell unified-shell orders-shell">
      <header className="app-header"><Logo /><nav><a href="/workspace">Overview</a><a className="nav-active" href="/orders">Orders</a><a href="/wallet">Wallet</a><a href="/workspace#deliveries">Activity</a></nav><div className="app-user"><button className="app-icon" aria-label="Notifications"><Bell size={17} /></button><button className="user-button"><span className="user-avatar unified-avatar"><ArrowLeftRight size={16} /></span><span><strong>GreenBite Trading</strong><small>Business workspace</small></span><ChevronDown size={14} /></button></div></header>
      <main className="buyer-main orders-main">
        {notice && <div className="app-alert"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
        <section className="app-title orders-title"><div><span>ROLE-AWARE ORDER REGISTER · SUI TESTNET</span><h1>Every trade. One register.</h1><p>Filter by your role on each purchase order—without changing accounts or switching workspaces.</p></div><Button className="app-primary" onClick={() => setCreateOpen(true)}><Plus size={16} />New purchase order</Button></section>
        <section className="orders-assurance"><ShieldCheck size={17} /><p><strong>Roles are fixed per order.</strong><span>A buying order exposes buyer controls; a supplying order exposes supplier controls.</span></p><BadgeCheck size={17} /></section>
        <section className="work-panel orders-register-panel">
          <div className="orders-register-head"><div><span className="card-label">ALL PURCHASE ORDERS</span><h2>Operational order register</h2></div><label className="order-search"><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, company or status" aria-label="Search orders" /></label></div>
          <Tabs value={filter} onValueChange={(value) => setFilter(value as RoleFilter)} className="order-role-tabs">
            <TabsList><TabsTrigger value="all">All orders <span>{counts.all}</span></TabsTrigger><TabsTrigger value="buyer"><Building2 size={14} />Buying <span>{counts.buyer}</span></TabsTrigger><TabsTrigger value="supplier"><Box size={14} />Supplying <span>{counts.supplier}</span></TabsTrigger></TabsList>
            <TabsContent value="all"><OrderRegister orders={visible} onSelect={setSelected} /></TabsContent>
            <TabsContent value="buyer"><OrderRegister orders={visible} onSelect={setSelected} /></TabsContent>
            <TabsContent value="supplier"><OrderRegister orders={visible} onSelect={setSelected} /></TabsContent>
          </Tabs>
          <div className="order-register-foot"><span><CircleDollarSign size={15} />Escrow, receivables and wallet balance remain separate.</span><strong>{visible.length} ORDERS SHOWN</strong></div>
        </section>
        <footer className="app-footer"><span><FileCheck2 size={14} />One purchase order, one shared state and one verifiable settlement record.</span><span>Demo Order Register · Sui Testnet</span></footer>
      </main>
      <CreatePurchaseOrder open={createOpen} onOpenChange={setCreateOpen} onCreate={(order) => { setOrders((current) => [order, ...current]); setFilter(order.role === "BUYER" ? "buyer" : "supplier"); setNotice(`${order.id} created as a ${order.role.toLowerCase()} order and sent to ${order.counterparty}.`); }} />
      <OrderDetail order={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} onAction={actOnOrder} />
    </div>
  );
}

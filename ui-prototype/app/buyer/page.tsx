"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, Bell, Check, CheckCircle2, ChevronDown,
  CircleDollarSign, ClipboardCheck, FileImage, FileText, Loader2,
  LockKeyhole, PackageOpen, Plus, ReceiptText, ShieldCheck, Sparkles,
  Trash2, Truck, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LineItem = {
  id: number;
  description: string;
  sku: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

type OrderRecord = {
  id: string;
  supplier: string;
  status: string;
  value: number;
  delivery: string;
  location: string;
  itemSummary: string;
  items: LineItem[];
};

type NewOrderPayload = {
  supplier: string;
  reference: string;
  delivery: string;
  location: string;
  items: LineItem[];
  total: number;
};

const initialOrders: OrderRecord[] = [
  {
    id: "PO-2471", supplier: "FreshSource Foods", status: "Inspection due", value: 30000,
    delivery: "29 Aug 2026", location: "GreenBite Receiving Bay · PJ",
    itemSummary: "Cooking oil · 100 cartons",
    items: [{ id: 1, description: "Premium cooking oil 20L", sku: "CO-20L", quantity: 100, unit: "Carton", unitPrice: 300 }],
  },
  {
    id: "PO-2468", supplier: "Apex Packaging", status: "In transit", value: 18400,
    delivery: "02 Sep 2026", location: "GreenBite Central Kitchen · KL",
    itemSummary: "Food-grade containers · 10,000 pieces",
    items: [
      { id: 1, description: "750ml food container", sku: "AP-750", quantity: 5000, unit: "Unit", unitPrice: 1.45 },
      { id: 2, description: "Matching seal lid", sku: "AP-L750", quantity: 5000, unit: "Unit", unitPrice: 2.23 },
    ],
  },
  {
    id: "PO-2459", supplier: "Metro Ingredients", status: "Funds secured", value: 22000,
    delivery: "06 Sep 2026", location: "GreenBite Receiving Bay · PJ",
    itemSummary: "Dry ingredients · 220 bags",
    items: [{ id: 1, description: "High-protein flour 25kg", sku: "MI-HP25", quantity: 220, unit: "Bag", unitPrice: 100 }],
  },
  {
    id: "PO-2447", supplier: "Nordic Cold Chain", status: "Settled", value: 8000,
    delivery: "27 Aug 2026", location: "GreenBite Cold Room · PJ",
    itemSummary: "Cold-chain service · 1 route",
    items: [{ id: 1, description: "Temperature-controlled delivery", sku: "NCC-KL01", quantity: 1, unit: "Route", unitPrice: 8000 }],
  },
];

const extractedItems: LineItem[] = [
  { id: 1, description: "Premium sunflower cooking oil 20L", sku: "FS-SF20", quantity: 60, unit: "Carton", unitPrice: 282 },
  { id: 2, description: "Canola cooking oil 20L", sku: "FS-CA20", quantity: 20, unit: "Carton", unitPrice: 295 },
  { id: 3, description: "Reusable food-grade drum", sku: "FS-DRM", quantity: 4, unit: "Unit", unitPrice: 210 },
];

const money = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

function Logo() {
  return <a className="logo" href="/"><span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" /></span><span>ProofPay</span></a>;
}

function NewOrder({ onCreated }: { onCreated: (order: NewOrderPayload) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<"upload" | "manual">("manual");
  const [supplier, setSupplier] = useState("FreshSource Foods Sdn. Bhd.");
  const [reference, setReference] = useState("PO-2475");
  const [delivery, setDelivery] = useState("08 Sep 2026");
  const [location, setLocation] = useState("GreenBite Receiving Bay · PJ");
  const [fileName, setFileName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [items, setItems] = useState<LineItem[]>([
    { id: 1, description: "", sku: "", quantity: 1, unit: "Carton", unitPrice: 0 },
  ]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0),
    [items],
  );

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => {
        setStep(1);
        setExtracting(false);
      }, 180);
    }
  };

  const updateItem = (id: number, field: keyof LineItem, value: string | number) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const addRow = () => {
    setItems((current) => [...current, { id: Date.now(), description: "", sku: "", quantity: 1, unit: "Unit", unitPrice: 0 }]);
  };

  const removeRow = (id: number) => {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  };

  const extractFile = (file?: File) => {
    if (!file) return;
    setMode("upload");
    setFileName(file.name);
    setExtracting(true);
    window.setTimeout(() => {
      setItems(extractedItems);
      setExtracting(false);
    }, 900);
  };

  const sendOrder = () => {
    const cleanItems = items.filter((item) => item.description.trim());
    onCreated({ supplier, reference, delivery, location, items: cleanItems.length ? cleanItems : items, total });
    changeOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button className="app-primary"><Plus size={16} />New purchase order</Button></DialogTrigger>
      <DialogContent className="order-dialog order-wizard" showCloseButton={false}>
        <div className="wizard-topline">
          <span className="card-label">SECURE A NEW TRADE</span>
          <div className="wizard-progress" aria-label={`Step ${step} of 2`}>
            <span className="active"><b>{step > 1 ? <Check size={11} /> : "1"}</b>Trade details</span>
            <i />
            <span className={step === 2 ? "active" : ""}><b>2</b>Line items</span>
          </div>
        </div>

        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Start the purchase order.</DialogTitle>
              <DialogDescription>Set who you are buying from and where the order should arrive. Products come next.</DialogDescription>
            </DialogHeader>
            <div className="dialog-form wizard-form">
              <label><span>Supplier</span><Input value={supplier} onChange={(event) => setSupplier(event.target.value)} /></label>
              <label><span>PO reference</span><Input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
              <label><span>Expected delivery</span><Input value={delivery} onChange={(event) => setDelivery(event.target.value)} /></label>
              <label className="full-field"><span>Delivery location</span><Input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
            </div>
            <div className="wizard-note"><ShieldCheck size={16} /><span><strong>No funds move yet.</strong> The supplier reviews this draft before you fund escrow.</span></div>
            <DialogFooter className="wizard-footer">
              <Button variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
              <Button className="app-primary" onClick={() => setStep(2)}>Next: add products <ArrowRight size={15} /></Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>What are you buying?</DialogTitle>
              <DialogDescription>Import a quote or enter the products directly. Extracted values stay fully editable.</DialogDescription>
            </DialogHeader>

            <div className="entry-modes" role="group" aria-label="Choose how to add line items">
              <button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}>
                <span><FileImage size={18} /></span><strong>Extract from photo</strong><small>Invoice, quote or order sheet</small>{mode === "upload" && <Check size={15} />}
              </button>
              <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>
                <span><ReceiptText size={18} /></span><strong>Enter manually</strong><small>Fast spreadsheet-style entry</small>{mode === "manual" && <Check size={15} />}
              </button>
            </div>

            {mode === "upload" && (
              <label className={`extract-dropzone ${fileName ? "has-file" : ""}`}>
                <input type="file" accept="image/*,.pdf" onChange={(event) => extractFile(event.target.files?.[0])} />
                {extracting ? (
                  <><Loader2 className="extract-spinner" size={23} /><strong>Reading line items…</strong><small>Detecting descriptions, quantity and unit price</small></>
                ) : fileName ? (
                  <><span className="extracted-icon"><Sparkles size={20} /></span><strong>{fileName}</strong><small>3 line items extracted · review them below</small></>
                ) : (
                  <><span><Upload size={21} /></span><strong>Drop a photo or PDF here</strong><small>or click to choose a file · PNG, JPG or PDF</small></>
                )}
              </label>
            )}

            <div className="line-items-shell">
              <div className="line-items-heading">
                <div><span>ORDER CONTENTS</span><strong>{items.length} line {items.length === 1 ? "item" : "items"}</strong></div>
                <div className="editable-mark"><Sparkles size={12} />Editable after extraction</div>
              </div>
              <div className="line-items-scroll">
                <div className="line-items-grid line-items-grid-head">
                  <span>#</span><span>Product / description</span><span>SKU</span><span>Qty</span><span>Unit</span><span>Unit price</span><span>Line total</span><span />
                </div>
                {items.map((item, index) => (
                  <div className="line-items-grid line-item-row" key={item.id}>
                    <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
                    <Input aria-label={`Product ${index + 1}`} placeholder="What are you buying?" value={item.description} onChange={(event) => updateItem(item.id, "description", event.target.value)} />
                    <Input aria-label={`SKU ${index + 1}`} placeholder="Optional" value={item.sku} onChange={(event) => updateItem(item.id, "sku", event.target.value)} />
                    <Input aria-label={`Quantity ${index + 1}`} type="number" min="0" value={item.quantity} onChange={(event) => updateItem(item.id, "quantity", Number(event.target.value))} />
                    <Input aria-label={`Unit ${index + 1}`} value={item.unit} onChange={(event) => updateItem(item.id, "unit", event.target.value)} />
                    <div className="money-input"><span>$</span><Input aria-label={`Unit price ${index + 1}`} type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.id, "unitPrice", Number(event.target.value))} /></div>
                    <strong className="line-total">{money(item.quantity * item.unitPrice)}</strong>
                    <button className="remove-row" aria-label={`Remove line ${index + 1}`} onClick={() => removeRow(item.id)} disabled={items.length === 1}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="add-line" onClick={addRow}><Plus size={14} />Add another line</button>
              <div className="order-total"><span><small>Draft total</small><strong>Calculated from {items.length} line {items.length === 1 ? "item" : "items"}</strong></span><b>{money(total)} <small>USDC</small></b></div>
            </div>

            <p className="prototype-note"><Sparkles size={12} />Prototype extraction fills demo values; production will connect to document OCR.</p>
            <DialogFooter className="wizard-footer">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft size={15} />Back</Button>
              <Button className="app-primary" onClick={sendOrder} disabled={extracting}>Send to supplier <ArrowRight size={15} /></Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrderDetails({ order }: { order: OrderRecord }) {
  const supplierConfirmed = !["Draft", "Awaiting supplier", "Changes requested"].includes(order.status);
  const funded = ["Funds secured", "In transit", "Inspection due", "Settled"].includes(order.status);
  const delivered = ["Inspection due", "Settled"].includes(order.status);

  return (
    <Sheet>
      <SheetTrigger asChild><Button variant="ghost" className="details-trigger">View details <ArrowRight size={13} /></Button></SheetTrigger>
      <SheetContent className="review-sheet order-details-sheet">
        <SheetHeader className="sheet-head">
          <span className="card-label">PURCHASE ORDER DETAILS</span>
          <SheetTitle>{order.id}</SheetTitle>
          <SheetDescription>{order.supplier} · {order.itemSummary}</SheetDescription>
        </SheetHeader>
        <div className="sheet-body order-details-body">
          <section className="detail-hero">
            <div><span>PROTECTED ORDER VALUE</span><strong>{money(order.value)} <small>USDC</small></strong></div>
            <span className="detail-status"><i />{order.status}</span>
          </section>
          <section className="detail-facts">
            <div><span>SUPPLIER</span><strong>{order.supplier}</strong></div>
            <div><span>EXPECTED DELIVERY</span><strong>{order.delivery}</strong></div>
            <div><span>DELIVERY LOCATION</span><strong>{order.location}</strong></div>
            <div><span>PAYMENT RULE</span><strong>Accepted quantity only</strong></div>
          </section>
          <section className="detail-section">
            <div className="detail-section-head"><span><PackageOpen size={15} />ORDER CONTENTS</span><strong>{order.items.length} line {order.items.length === 1 ? "item" : "items"}</strong></div>
            <Table className="detail-items-table">
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead className="table-amount">Total</TableHead></TableRow></TableHeader>
              <TableBody>{order.items.map((item) => <TableRow key={item.id}><TableCell><strong>{item.description}</strong><small>{item.sku || "No SKU"} · {money(item.unitPrice)} SUI / {item.unit}</small></TableCell><TableCell>{money(item.quantity)} {item.unit}</TableCell><TableCell className="table-amount">{money(item.quantity * item.unitPrice)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </section>
          <section className="detail-section proof-rule">
            <div><LockKeyhole size={17} /><span><strong>Funds follow accepted goods.</strong><small>The smart contract releases only the quantity the buyer signs for. Exceptions remain held.</small></span></div>
            <div className="detail-flow"><span className="done"><Check size={11} />Draft</span><i /><span className={supplierConfirmed ? "done" : "current"}>{supplierConfirmed && <Check size={11} />}Supplier confirmed</span><i /><span className={funded ? "done" : supplierConfirmed ? "current" : ""}>{funded && <Check size={11} />}Funded</span><i /><span className={delivered ? "done" : funded ? "current" : ""}>{delivered && <Check size={11} />}Delivered</span></div>
          </section>
          <Button variant="outline" className="detail-document"><FileText size={15} />Open shared settlement record <ArrowRight size={14} /></Button>
          <p className="sheet-note">Demo workspace · values shown on Sui Testnet only.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReviewDelivery({ onConfirmed }: { onConfirmed: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button className="review-button">Review delivery <ArrowRight size={15} /></Button></SheetTrigger>
      <SheetContent className="review-sheet">
        <SheetHeader className="sheet-head"><span className="card-label">DELIVERY INSPECTION</span><SheetTitle>PO-2471 · Cooking oil</SheetTitle><SheetDescription>Record what GreenBite Foods received before the 48-hour window closes.</SheetDescription></SheetHeader>
        <div className="sheet-body">
          <section className="sheet-card"><span>QUANTITY CHECK</span><h3>100 cartons delivered</h3><div className="quantity-split"><div><span>ACCEPTED</span><strong>87</strong><small>26,100 USDC</small></div><div><span>DAMAGED / MISSING</span><strong>13</strong><small>3,900 USDC held</small></div></div></section>
          <section className="sheet-card"><span>DELIVERY EVIDENCE</span><h3>Signed delivery order and six receiving photos</h3><p className="sheet-evidence-copy">Evidence hashes are anchored to this trade record while the commercial files remain private.</p></section>
          <div className="release-box"><small>RELEASE AFTER CONFIRMATION</small><strong>26,100 USDC</strong><p>Only the disputed 3,900 USDC remains protected in escrow.</p></div>
          <div className="sheet-buttons"><Button variant="outline" onClick={() => setOpen(false)}>Save for later</Button><Button className="app-primary" onClick={() => { onConfirmed(); setOpen(false); }}><Check size={15} />Confirm inspection</Button></div>
          <p className="sheet-note">Demo interaction only — no real funds will move.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function BuyerWorkspace() {
  const [notice, setNotice] = useState<"created" | "confirmed" | "supplierConfirmed" | "changesRequested" | null>(null);
  const [draftOrder, setDraftOrder] = useState<OrderRecord | null>(null);
  const orders = draftOrder ? [draftOrder, ...initialOrders] : initialOrders;
  const steps = [
    { icon: Check, label: "Funded", note: "24 Aug" },
    { icon: Check, label: "Shipped", note: "27 Aug" },
    { icon: Truck, label: "Delivered", note: "29 Aug" },
    { icon: ClipboardCheck, label: "Inspection", note: "Your action" },
  ];

  const handleCreated = (payload: NewOrderPayload) => {
    const nextOrder: OrderRecord = {
      id: payload.reference || "PO-DRAFT",
      supplier: payload.supplier || "Supplier pending",
      status: "Awaiting supplier",
      value: payload.total,
      delivery: payload.delivery,
      location: payload.location,
      itemSummary: payload.items.length ? `${payload.items[0].description} · ${payload.items.length} line ${payload.items.length === 1 ? "item" : "items"}` : "Products pending",
      items: payload.items,
    };
    setDraftOrder(nextOrder);
    window.localStorage.setItem("proofpay_pending_order", JSON.stringify({ ...nextOrder, buyer: "GreenBite Foods", sentAt: new Date().toISOString() }));
    window.localStorage.setItem("proofpay_order_response", "pending");
    setNotice("created");
  };

  useEffect(() => {
    const storedOrder = window.localStorage.getItem("proofpay_pending_order");
    const response = window.localStorage.getItem("proofpay_order_response");
    if (!storedOrder) return;
    try {
      const order = JSON.parse(storedOrder) as OrderRecord;
      const status = response === "confirmed" ? "Supplier confirmed" : response === "changes" ? "Changes requested" : "Awaiting supplier";
      setDraftOrder({ ...order, status });
      if (response === "confirmed") setNotice("supplierConfirmed");
      if (response === "changes") setNotice("changesRequested");
    } catch {
      window.localStorage.removeItem("proofpay_pending_order");
    }
  }, []);

  return (
    <div className="buyer-shell">
      <header className="app-header"><Logo /><nav><a href="#">Overview</a><a href="#orders">Orders</a><a href="#">Deliveries</a><a href="#">Escrow</a></nav><div className="app-user"><a className="workspace-return" href="/workspace" aria-label="Return to unified workspace"><ArrowLeftRight size={15} /><span>Unified workspace</span></a><button className="app-icon" aria-label="Notifications"><Bell size={17} /></button><button className="user-button"><span className="user-avatar">SE</span><span><strong>Shen En</strong><small>GreenBite Foods</small></span><ChevronDown size={14} /></button></div></header>
      <main className="buyer-main">
        {notice && <div className="app-alert"><CheckCircle2 size={17} /><span>{notice === "created" ? `${draftOrder?.id || "Order"} sent to ${draftOrder?.supplier || "the supplier"}. Funding stays disabled until they confirm.` : notice === "supplierConfirmed" ? `${draftOrder?.supplier || "The supplier"} confirmed ${draftOrder?.id || "the order"}. Your next step is to fund escrow.` : notice === "changesRequested" ? `${draftOrder?.supplier || "The supplier"} requested changes to ${draftOrder?.id || "the order"}. Review the shared terms before resending.` : "Inspection confirmed. 26,100 USDC is ready for settlement."}</span><button onClick={() => setNotice(null)}>Dismiss</button></div>}
        <section className="app-title"><div><span>BUYER WORKSPACE · SUI TESTNET</span><h1>Your money waits for proof.</h1><p>Two deliveries need attention. Every protected dollar remains visible below.</p></div><Button className="app-primary" asChild><a href="/orders?action=create"><Plus size={16} />New purchase order</a></Button></section>
        <section className="summary-rule"><article><span>SECURED IN ESCROW</span><strong>78,400 <small>USDC</small></strong><p>Across three funded orders</p></article><article><span>READY TO RELEASE</span><strong>26,100 <small>USDC</small></strong><p>Awaiting inspection decision</p></article><article><span>OPEN ORDERS</span><strong>{draftOrder ? 5 : 4}</strong><p>Two active suppliers</p></article><article><span>ACTION NEEDED</span><strong>2</strong><p>One inspection · one response</p></article></section>
        <section className="work-grid">
          <article className="work-panel focus-order"><div className="focus-head"><div><span className="card-label">NEEDS YOUR ATTENTION</span><h2>Delivery ready for inspection</h2></div><span className="status-chip">43h 12m left</span></div><div className="order-line"><span className="supplier-avatar">FS</span><div><strong>FreshSource Foods</strong><small>PO-2471 · Cooking oil · 100 cartons</small></div><div className="order-money"><small>ESCROWED VALUE</small><strong>30,000 USDC</strong></div></div><div className="mini-flow">{steps.map((step, index) => { const StepIcon = step.icon; return <div key={step.label} className={index === 3 ? "current" : "done"}><span><StepIcon size={14} /></span><strong>{step.label}</strong><small>{step.note}</small></div>; })}</div><div className="focus-actions"><p><ShieldCheck size={15} />Funds remain locked until your signed decision.</p><ReviewDelivery onConfirmed={() => setNotice("confirmed")} /></div></article>
          <article className="work-panel funds-panel"><span className="card-label">SETTLEMENT HEALTH</span><h2>Protected and on track</h2><div className="fund-number"><div><strong>92</strong><small>/100</small></div><span><CheckCircle2 size={14} />Healthy</span></div><div className="fund-bar"><span /></div><div className="fund-list"><div><span>Escrow coverage</span><strong>100%</strong></div><div><span>On-time settlements</span><strong>96%</strong></div><div><span>Disputed value</span><strong>4.8%</strong></div></div></article>
        </section>
        <section id="orders" className="second-grid"><article className="work-panel orders-panel buyer-orders-panel"><div className="panel-head"><div><span className="card-label">ACTIVE TRADE PIPELINE</span><h2>Purchase orders</h2></div><button>View all <ArrowRight size={14} /></button></div><Table className="order-table buyer-order-table"><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Supplier</TableHead><TableHead>Contents</TableHead><TableHead>Status</TableHead><TableHead className="table-amount">Value</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader><TableBody>{orders.map((order) => <TableRow key={order.id}><TableCell><strong>{order.id}</strong><small>Delivery-linked trade</small></TableCell><TableCell>{order.supplier}</TableCell><TableCell><strong>{order.itemSummary.split(" · ")[0]}</strong><small>{order.itemSummary.split(" · ").slice(1).join(" · ") || `${order.items.length} line item`}</small></TableCell><TableCell><span className={`order-status status-${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</span></TableCell><TableCell className="table-amount">{money(order.value)} SUI</TableCell><TableCell><OrderDetails order={order} /></TableCell></TableRow>)}</TableBody></Table></article><article className="work-panel activity-panel"><div className="panel-head"><div><span className="card-label">SHARED RECORD</span><h2>Recent activity</h2></div></div><div className="activity-list"><article><span><Truck size={15} /></span><div><strong>Delivery recorded</strong><p>FreshSource uploaded evidence for PO-2471.</p><small>18 minutes ago</small></div></article><article><span><LockKeyhole size={15} /></span><div><strong>Escrow funded</strong><p>22,000 USDC secured for Metro Ingredients.</p><small>Yesterday, 4:42 PM</small></div></article><article><span><CircleDollarSign size={15} /></span><div><strong>Settlement complete</strong><p>PO-2447 paid to Nordic Cold Chain.</p><small>27 Aug, 11:08 AM</small></div></article></div></article></section>
        <footer className="app-footer"><span><ShieldCheck size={14} />ProofPay cannot withdraw your escrowed funds.</span><span>Demo Buyer Workspace · Sui Testnet</span></footer>
      </main>
    </div>
  );
}

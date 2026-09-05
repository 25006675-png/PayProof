"use client";

import { useState } from "react";
import { ArrowRight, Box, Building2, Check, ClipboardCopy, Link2, Plus, ScanSearch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AgreementBlock, ConsentDialog, FileField, HelpHint, Notice } from "@/app/components/app-shell";
import { buildDocument, extractPurchaseOrder } from "@/app/components/order-documents";
import { ReleasePlanBar } from "@/app/components/release-plan";
import { type DemoOrder, type ExtractedPurchaseOrder, type OrderDocument, formatOrderMoney as money, itemSummary } from "@/lib/demo-orders";
import { createLiveOrder } from "@/lib/live-orders";
import { loadExtras, saveExtras } from "@/lib/local-order-extras";
import { loadSession, type InvitationDelivery, type WorkspaceProfile } from "@/lib/payproof-api";

type DraftLine = { id: number; description: string; quantity: number; unit: string; unitPrice: number };
const blankLine = (id: number): DraftLine => ({ id, description: "", quantity: 1, unit: "units", unitPrice: 0 });

export function CreateOrderDialog({ open, onOpenChange, onCreate, profile, company }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (order: DemoOrder) => void; profile?: WorkspaceProfile; company: string }) {
  const [page, setPage] = useState<1 | 2>(1);
  const [role, setRole] = useState<"buyer" | "supplier">("buyer");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [counterpartyEmail, setCounterpartyEmail] = useState("");
  const [reference, setReference] = useState("");
  const [delivery, setDelivery] = useState("");
  const [location, setLocation] = useState("");
  const [items, setItems] = useState<DraftLine[]>([blankLine(1)]);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [created, setCreated] = useState<DemoOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deliveryResult, setDeliveryResult] = useState<InvitationDelivery>();
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState<ExtractedPurchaseOrder | null>(null);
  const [depositPercent, setDepositPercent] = useState(20);
  const [dispatchPercent, setDispatchPercent] = useState(40);

  const buying = role === "buyer";
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(counterpartyEmail.trim());
  const detailsValid = Boolean(counterpartyName.trim() && emailValid && delivery && location.trim() && total > 0 && items.every((item) => item.description.trim() && item.quantity > 0 && item.unitPrice > 0));
  const canSend = Boolean(accepted && detailsValid);
  const deliveryPercent = 100 - depositPercent - dispatchPercent;
  const releaseValue = (percent: number) => Math.round(total * percent) / 100;

  const reset = () => {
    setRole("buyer"); setCounterpartyName(""); setCounterpartyEmail(""); setReference(""); setDelivery(""); setLocation("");
    setItems([blankLine(1)]); setAgreementFile(null); setAccepted(false); setCreated(null); setCopied(false); setInviteUrl(""); setError(""); setDeliveryResult(undefined); setImported(null); setImportFile(null); setImportError(""); setPage(1); setDepositPercent(20); setDispatchPercent(40);
  };
  const changeOpen = (next: boolean) => { if (!next) reset(); onOpenChange(next); };
  const updateLine = (id: number, field: keyof DraftLine, value: string | number) => setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  const addLine = () => setItems((current) => [...current, blankLine(Math.max(...current.map((item) => item.id)) + 1)]);
  const removeLine = (id: number) => setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));

  const applyImport = (extracted: ExtractedPurchaseOrder) => {
    if (extracted.lines.length) setItems(extracted.lines.map((line, index) => ({ id: index + 1, description: line.description, quantity: line.quantity, unit: line.unit || "units", unitPrice: line.unitPrice ?? 0 })));
    if (extracted.reference && !reference) setReference(extracted.reference);
    const other = buying ? extracted.supplierName : extracted.buyerName;
    if (other && !counterpartyName) setCounterpartyName(other);
    if (extracted.deliveryDate && !delivery) setDelivery(extracted.deliveryDate);
    if (extracted.deliveryLocation && !location) setLocation(extracted.deliveryLocation);
    setImported(extracted);
  };

  const runImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportError("");
    try {
      applyImport(await extractPurchaseOrder(importFile));
      setImportOpen(false);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "The document could not be read.");
    } finally {
      setImporting(false);
    }
  };

  const lines = () => items.map((item, index) => ({ id: String(index + 1), description: item.description.trim(), quantity: item.quantity, unit: item.unit || "units", unitPrice: item.unitPrice }));

  const attachments = async (): Promise<OrderDocument[]> => {
    const documents: OrderDocument[] = [];
    if (importFile && imported) documents.push(await buildDocument(importFile, "purchase_order", buying ? "BUYER" : "SUPPLIER", imported));
    if (agreementFile) documents.push(await buildDocument(agreementFile, "internal_agreement", buying ? "BUYER" : "SUPPLIER"));
    return documents;
  };

  const buildSample = async (): Promise<DemoOrder> => {
    const ref = reference.trim() || `PO-${String(Date.now()).slice(-6)}`;
    const documents = await attachments();
    return {
      id: `sample-${ref.toLowerCase()}-${Date.now().toString(36)}`, reference: ref, role: buying ? "BUYER" : "SUPPLIER", initiatorRole: role, counterparty: counterpartyName.trim(),
      buyer: buying ? company : counterpartyName.trim(), supplier: buying ? counterpartyName.trim() : company, item: itemSummary(lines()), items: lines(),
      status: buying ? "awaiting_supplier" : "awaiting_buyer", value: total,
      delivery, deliveryLocation: location.trim(), settlementAsset: "Testnet USDC", currency: "USDC", inviteToken: crypto.randomUUID(), version: 1,
      releasePlan: { depositValue: releaseValue(depositPercent), dispatchValue: releaseValue(dispatchPercent), deliveryValue: Math.max(0, total - releaseValue(depositPercent) - releaseValue(dispatchPercent)) },
      source: "sample", documents, events: [{ at: new Date().toISOString(), label: "Order created", detail: `${company} issued the purchase order${buying ? "" : " as supplier"}.` }, ...documents.map((document) => ({ at: document.uploadedAt, label: "Document attached", detail: document.name }))],
    };
  };

  const send = async () => {
    setSaving(true);
    setError("");
    try {
      if (!loadSession()) {
        const sample = await buildSample();
        onCreate(sample);
        setCreated(sample);
        setInviteUrl(`${window.location.origin}/orders/${encodeURIComponent(sample.id)}?invite=${sample.inviteToken}`);
        return;
      }
      if (!profile) throw new Error("Your workspace is still loading. Try again in a moment.");
      const session = loadSession();
      const result = await createLiveOrder({ reference: reference.trim(), initiatorRole: role, counterpartyName: counterpartyName.trim(), counterpartyEmail: counterpartyEmail.trim(), deliveryDate: delivery, deliveryLocation: location.trim(), organizationId: profile.primary.organizationId, items: lines(), supplierWalletAddress: buying ? undefined : session?.suiAddress, releasePercentages: { deposit: depositPercent, dispatch: dispatchPercent } });
      let order = result.order;
      const documents = await attachments();
      if (documents.length) {
        const extras = loadExtras(order.id);
        saveExtras(order.id, { ...extras, documents: [...documents, ...extras.documents], events: [...extras.events, ...documents.map((document) => ({ at: document.uploadedAt, label: "Document attached", detail: document.name }))] });
        order = { ...order, documents };
      }
      onCreate(order); setCreated(order); setInviteUrl(result.inviteUrl); setDeliveryResult(result.inviteDelivery);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The order could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const otherRole = buying ? "supplier" : "buyer";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={`po-dialog po-dialog-${role}`} showCloseButton={!created}>
        {created ? (
          <div className="order-created">
            <span className="order-created-mark"><Check size={22} aria-hidden="true" /></span>
            <DialogHeader>
              <DialogTitle>Order {created.reference} sent for confirmation</DialogTitle>
              <DialogDescription>{created.counterparty} has to confirm the terms before {buying ? "you can fund escrow" : "the buyer can fund escrow"}.</DialogDescription>
            </DialogHeader>
            <dl className="fact-list fact-list-inline">
              <div><dt>Order value</dt><dd><strong>{money(created.value)} {created.currency}</strong></dd></div>
              <div><dt>{buying ? "Supplier" : "Buyer"}</dt><dd>{created.counterparty}</dd></div>
              <div><dt>Expected delivery</dt><dd>{created.delivery}</dd></div>
            </dl>
            <div className="invite-link">
              <Link2 size={15} aria-hidden="true" />
              <span><strong>Confirmation link</strong><code>{inviteUrl}</code></span>
              <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(inviteUrl); setCopied(true); }}><ClipboardCopy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy link"}</Button>
            </div>
            <Notice tone={deliveryResult?.status === "sent" ? "success" : "info"}>
              {deliveryResult?.status === "sent" ? `An invitation email was sent to ${counterpartyEmail.trim()}.`
                : deliveryResult?.status === "failed" ? "The invitation email could not be delivered. Copy the link and send it yourself."
                : deliveryResult?.status === "not_configured" ? "Automatic email is not configured. Copy the link and send it yourself."
                : `This is a sample order. Use the link to open it as the ${otherRole}.`}
            </Notice>
            <DialogFooter>
              <Button variant="outline" onClick={() => changeOpen(false)}>Done</Button>
              <Button className="btn-primary" asChild><a href={`/orders/${encodeURIComponent(created.id)}`}>Open order<ArrowRight size={14} aria-hidden="true" /></a></Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New purchase order</DialogTitle>
              <DialogDescription>{page === 1 ? "Set the parties, delivery terms and line items." : "Choose when the supplier receives each part of the order value."}</DialogDescription>
            </DialogHeader>

            <ol className="po-pages" aria-label="Purchase order steps">
              <li className={page === 1 ? "po-page-current" : "po-page-done"}><span>{page === 1 ? "1" : <Check size={13} aria-hidden="true" />}</span>Order details</li>
              <li className={page === 2 ? "po-page-current" : ""}><span>2</span>Release plan</li>
            </ol>

            <div className="po-page" hidden={page !== 1}>
            <fieldset className="form-section">
              <legend>Your role on this order</legend>
              <div className="role-choice" role="radiogroup" aria-label="Your role">
                <label className={buying ? "role-option role-option-active" : "role-option"}>
                  <input type="radio" name="role" value="buyer" checked={buying} onChange={() => { setRole("buyer"); setCounterpartyName(""); }} />
                  <Building2 size={17} aria-hidden="true" />
                  <span><strong>{company} is buying</strong><small>You fund escrow after the supplier confirms.</small></span>
                </label>
                <label className={!buying ? "role-option role-option-active role-option-supplier" : "role-option role-option-supplier"}>
                  <input type="radio" name="role" value="supplier" checked={!buying} onChange={() => { setRole("supplier"); setCounterpartyName(""); }} />
                  <Box size={17} aria-hidden="true" />
                  <span><strong>{company} is supplying</strong><small>The buyer confirms the terms, then funds escrow.</small></span>
                </label>
              </div>
            </fieldset>

            <div className="import-strip">
              <div><strong>Have the purchase order as a file?</strong><small>Upload the PDF or image and the line quantities are read for you to review.</small></div>
              <Button variant="outline" size="sm" onClick={() => { setImportError(""); setImportFile(null); setImportOpen(true); }}><ScanSearch size={14} aria-hidden="true" />Import from file</Button>
            </div>
            {imported && <Notice tone="success" onDismiss={() => setImported(null)}>{imported.lines.length} {imported.lines.length === 1 ? "line was" : "lines were"} read from the file. Check the quantities and prices below before sending.{imported.warnings.length > 0 && <ul className="extraction-warnings">{imported.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</Notice>}

            <fieldset className="form-section">
              <legend>{buying ? "Supplier" : "Buyer"}</legend>
              <div className="form-grid">
                <label className="field"><span>{buying ? "Supplier company" : "Buyer company"}</span><Input aria-label={buying ? "Supplier company name" : "Buyer company name"} value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} placeholder={buying ? "FreshSource Foods" : "GreenBite Trading"} /></label>
                <label className="field"><span>{buying ? "Supplier contact email" : "Buyer contact email"}<HelpHint text="The confirmation invitation is sent to this address. Only an account signed in with this email can confirm the order." /></span><Input aria-label={buying ? "Supplier contact email" : "Buyer contact email"} type="email" autoComplete="email" value={counterpartyEmail} onChange={(event) => setCounterpartyEmail(event.target.value)} placeholder={buying ? "orders@supplier.com" : "purchasing@buyer.com"} aria-invalid={counterpartyEmail.length > 0 && !emailValid} /></label>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>Terms</legend>
              <div className="form-grid form-grid-3">
                <label className="field"><span>PO reference<small>Optional</small></span><Input aria-label="PO reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Generated if left blank" /></label>
                <label className="field"><span>Expected delivery</span><Input aria-label="Expected delivery" type="date" value={delivery} onChange={(event) => setDelivery(event.target.value)} /></label>
                <label className="field"><span>Delivery location</span><Input aria-label="Delivery location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Warehouse or receiving address" /></label>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>Line items</legend>
              <div className="line-editor">
                <div className="line-editor-head" aria-hidden="true"><span>Product</span><span>Quantity</span><span>Unit</span><span>Unit price (USDC)</span><span>Line total</span><span /></div>
                {items.map((item, index) => (
                  <div className="line-editor-row" key={item.id}>
                    <Input aria-label={`Product ${index + 1}`} placeholder="Product or description" value={item.description} onChange={(event) => updateLine(item.id, "description", event.target.value)} />
                    <Input aria-label={`Quantity ${index + 1}`} type="number" min={1} value={item.quantity} onChange={(event) => updateLine(item.id, "quantity", Number(event.target.value))} />
                    <Input aria-label={`Unit ${index + 1}`} value={item.unit} onChange={(event) => updateLine(item.id, "unit", event.target.value)} placeholder="cartons" />
                    <Input aria-label={`Unit price ${index + 1}`} type="number" min={0} step="0.01" value={item.unitPrice} onChange={(event) => updateLine(item.id, "unitPrice", Number(event.target.value))} />
                    <strong>{money(item.quantity * item.unitPrice)}</strong>
                    <button type="button" className="icon-button" aria-label={`Remove line item ${index + 1}`} onClick={() => removeLine(item.id)} disabled={items.length === 1}><Trash2 size={14} /></button>
                  </div>
                ))}
                <button className="line-editor-add" type="button" onClick={addLine}><Plus size={14} aria-hidden="true" />Add line item</button>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>Internal agreement<small className="legend-note">Optional</small></legend>
              <FileField label="Attach the agreement signed between both companies" hint="PDF or image. Only its fingerprint is kept with the order record." accept=".pdf,.png,.jpg,.jpeg,.webp" onFile={setAgreementFile} file={agreementFile} />
            </fieldset>

            <div className="order-total-strip">
              <span>Order value, settled in Testnet USDC</span>
              <strong>{money(total)} <small>USDC</small></strong>
            </div>
            </div>

            <div className="po-page" hidden={page !== 2}>
              <fieldset className="form-section release-plan-fieldset">
                <legend>Payment allocation</legend>
                <p className="release-intro">Both companies confirm this allocation before the buyer funds the order. Money released at an earlier stage cannot be reclaimed through PayProof.</p>
                <div className="release-allocation">
                  <ReleasePlanBar total={total || 1} currency="USDC"
                    values={{ deposit: releaseValue(depositPercent), dispatch: releaseValue(dispatchPercent), delivery: Math.max(0, total - releaseValue(depositPercent) - releaseValue(dispatchPercent)) }}
                    slider={<>
                      <input className="release-range release-range-deposit" aria-label="Adjust end of order deposit" type="range" min={0} max={100 - dispatchPercent} value={depositPercent} onChange={(event) => setDepositPercent(Number(event.target.value))} />
                      <input className="release-range release-range-dispatch" aria-label="Adjust end of dispatch payment" type="range" min={depositPercent} max={100} value={depositPercent + dispatchPercent} onChange={(event) => setDispatchPercent(Number(event.target.value) - depositPercent)} />
                    </>} />
                </div>
                <div className="release-controls">
                  <label>
                    <span><strong>Order deposit</strong><small>Released when escrow is funded</small></span>
                    <span className="percent-input"><Input aria-label="Order deposit percentage" type="number" min={0} max={100 - dispatchPercent} step={1} value={depositPercent} onChange={(event) => setDepositPercent(Math.max(0, Math.min(100 - dispatchPercent, Number(event.target.value) || 0)))} /><b>%</b></span>
                    <output>{money(releaseValue(depositPercent))} USDC</output>
                  </label>
                  <label>
                    <span><strong>Dispatch payment</strong><small>Released with anchored shipping evidence</small></span>
                    <span className="percent-input"><Input aria-label="Dispatch payment percentage" type="number" min={0} max={100 - depositPercent} step={1} value={dispatchPercent} onChange={(event) => setDispatchPercent(Math.max(0, Math.min(100 - depositPercent, Number(event.target.value) || 0)))} /><b>%</b></span>
                    <output>{money(releaseValue(dispatchPercent))} USDC</output>
                  </label>
                  <div className="release-final">
                    <span><strong>Delivery balance</strong><small>Released after acceptance, timeout, or dispute settlement</small></span>
                    <b>{deliveryPercent}%</b>
                    <output>{money(Math.max(0, total - releaseValue(depositPercent) - releaseValue(dispatchPercent)))} USDC</output>
                  </div>
                </div>
                {deliveryPercent < 20 && <Notice tone="warning">Only {deliveryPercent}% remains protected for delivery issues. Earlier releases are final and reduce the maximum refund available through PayProof.</Notice>}
                {depositPercent === 0 && dispatchPercent === 0 && <Notice tone="info">This matches PayProof’s original single-release flow: the full order value stays secured until delivery.</Notice>}
              </fieldset>

            <AgreementBlock company={company} accepted={accepted} onChange={setAccepted}
              clauses={[
                `${company} issues this purchase order as ${buying ? "buyer" : "supplier"} and is bound by the shared terms once ${counterpartyName.trim() || `the ${otherRole}`} confirms them.`,
                `${depositPercent}% is released when the confirmed order is funded, ${dispatchPercent}% when the supplier signs shipment with evidence, and ${deliveryPercent}% remains for delivery.`,
                "Released amounts are final. A refund or dispute can apply only to the delivery balance still held in escrow.",
              ]} />
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <DialogFooter>
              {page === 1 ? <>
                <Button variant="outline" disabled={saving} onClick={() => changeOpen(false)}>Cancel</Button>
                <Button className="btn-primary" disabled={!detailsValid} onClick={() => setPage(2)}>Set release plan<ArrowRight size={14} aria-hidden="true" /></Button>
              </> : <>
                <Button variant="outline" disabled={saving} onClick={() => setPage(1)}>Back to order details</Button>
                <Button className="btn-primary" disabled={!canSend || saving} onClick={() => void send()}>{saving ? "Sending" : `Send for ${otherRole} confirmation`}{!saving && <ArrowRight size={14} aria-hidden="true" />}</Button>
              </>}
            </DialogFooter>

            <ConsentDialog open={importOpen} onOpenChange={setImportOpen} company={company} title="Import purchase order from file"
              description="The file is read once to extract line items, quantities and prices. You review everything before the order is sent, and the file is attached to the order with its fingerprint."
              clauses={["This is a genuine purchase order issued by or to your company.", "You will check the extracted quantities and prices before sending."]}
              confirmLabel="Read the file" busy={importing} onConfirm={runImport}>
              <FileField label="Choose the purchase order file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" onFile={setImportFile} file={importFile} />
              {importError && <Notice tone="error">{importError}</Notice>}
            </ConsentDialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

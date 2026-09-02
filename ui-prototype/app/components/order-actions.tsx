"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ClipboardCopy, ExternalLink, FastForward, Link2, PackageCheck, ScanSearch, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgreementBlock, ConsentDialog, FileField, HelpHint, Notice } from "@/app/components/app-shell";
import { ClaimSection } from "@/app/components/claim-section";
import { ExtractionComparison, attachFile, buildDocument, extractPurchaseOrder, prepareEvidence } from "@/app/components/order-documents";
import { type DemoOrder, type DocumentKind, type InspectionLine, type OrderDocument, type OrderShipment, claimOwner, formatDate, formatDateTime, formatOrderMoney as money } from "@/lib/demo-orders";
import { loadClaim, openDemoClaim } from "@/lib/dispute-actions";
import { useEscrowActions } from "@/lib/escrow-actions";
import { acceptLiveInvitation, acceptLiveInvite, cancelLiveInvite, markLiveDelivered, markLiveShipment, recordDemoAcceptance, recordDemoFunding, sendLiveInvite, tradeOrderToView, viewLiveOrder } from "@/lib/live-orders";
import { withExtras } from "@/lib/local-order-extras";
import { STATUS, demoNextStatus, isDisputed, nextAction } from "@/lib/order-status";
import type { InvitationDelivery } from "@/lib/payproof-api";
import { advanceSample, confirmSample, deliverSample, recordSampleInspection, shipSample, withStatus } from "@/lib/sample-orders";
import { explorerTransactionUrl } from "@/lib/sui-dapp-kit";
import { clearPendingInvite } from "@/lib/pending-invite";

export const DEMO_CONTROLS = process.env.NEXT_PUBLIC_DEMO_CONTROLS === "true" || (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_CONTROLS !== "false");
const CARRIERS = ["DHL Express", "City-Link Express", "GDEX", "J&T Express", "Pos Laju", "Own fleet"];

type Props = {
  order: DemoOrder;
  company: string;
  inviteToken?: string;
  onChange: (order: DemoOrder) => void;
  onInviteConsumed?: () => void;
};

type Run = (name: string, task: () => Promise<DemoOrder | null | void>, success?: string) => Promise<boolean>;
type StepProps = { order: DemoOrder; company: string; live: boolean; busy: string; run: Run };

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}


export function ActionPanel({ order, company, inviteToken, onChange, onInviteConsumed }: Props) {
  const live = order.source === "backend";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const action = nextAction(order.status, order.role, { invited: live ? Boolean(inviteToken || order.invited) : true, claimOwner: claimOwner(order.claim) });

  const run: Run = async (name, task, success) => {
    setBusy(name);
    setError("");
    try {
      const result = await task();
      if (result) onChange(result);
      if (success) setNotice(success);
      return true;
    } catch (cause) {
      setError(errorText(cause, "The action could not be completed."));
      document.getElementById("action-title")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return false;
    } finally {
      setBusy("");
    }
  };
  const step = { order, company, live, busy, run };

  if ((isDisputed(order.status) || order.status === "settled") && order.claim) {
    return <ClaimSection order={order} claim={order.claim} company={company} onOrderChange={onChange} onClaimChange={(claim) => onChange({ ...order, claim })} />;
  }

  return (
    <section className={`panel action-panel action-${action.owner} action-panel-${order.role.toLowerCase()}`} aria-labelledby="action-title">
      <div className="action-head">
        <div className="action-head-row">
          <span className="action-owner">{action.owner === "you" ? "Your action" : action.owner === "counterparty" ? `Waiting on ${order.counterparty}` : "No action needed"}</span>
          {DEMO_CONTROLS && <DemoControl {...step} />}
        </div>
        <h2 id="action-title">{action.title}</h2>
        <p>{action.detail}</p>
      </div>
      {notice && <Notice tone="success" onDismiss={() => setNotice("")}>{notice}</Notice>}
      {error && <Notice tone="error" onDismiss={() => setError("")}>{error}</Notice>}

      {(order.status === "awaiting_supplier" || order.status === "awaiting_buyer" || order.status === "changes_requested") && !action.owner.startsWith("you") && order.initiatorRole === (order.role === "BUYER" ? "buyer" : "supplier") && (
        <InvitationControls {...step} />
      )}
      {(order.status === "awaiting_supplier" || order.status === "awaiting_buyer") && action.owner === "you" && (
        <ConfirmControls {...step} inviteToken={inviteToken} onInviteConsumed={onInviteConsumed} />
      )}
      {order.status === "changes_requested" && action.owner === "you" && <InvitationControls {...step} />}
      {order.status === "supplier_confirmed" && order.role === "BUYER" && <FundControls {...step} />}
      {order.status === "funded" && order.role === "SUPPLIER" && <ShipForm {...step} />}
      {order.status === "in_transit" && <TransitCard {...step} />}
      {order.status === "delivered" && order.role === "BUYER" && <InspectionFlow {...step} />}
      {order.status === "delivered" && order.role === "SUPPLIER" && order.deliveryRecord && <p className="action-note">Delivery was recorded on {formatDateTime(order.deliveryRecord.recordedAt)}{order.deliveryRecord.reference ? `, reference ${order.deliveryRecord.reference}` : ""}. The buyer checks the goods next.</p>}
      {(isDisputed(order.status) || (order.status === "settled" && order.disputeId)) && !order.claim && live && <LoadClaim order={order} onChange={onChange} />}
      {order.status === "settled" && <SettlementRecord order={order} />}
    </section>
  );
}

function LoadClaim({ order, onChange }: { order: DemoOrder; onChange: (order: DemoOrder) => void }) {
  const [error, setError] = useState("");
  useEffect(() => {
    if (!order.disputeId) return;
    loadClaim(order.disputeId).then((claim) => onChange({ ...order, claim })).catch((cause) => setError(errorText(cause, "The claim could not be loaded.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.disputeId]);
  return error ? <Notice tone="error">{error}</Notice> : <p className="action-note">Loading the claim.</p>;
}

function InvitationControls({ order, live, busy, run }: StepProps) {
  const [inviteUrl, setInviteUrl] = useState(order.inviteToken ? `${window.location.origin}/orders/${encodeURIComponent(order.id)}?invite=${order.inviteToken}` : "");
  const [delivery, setDelivery] = useState<InvitationDelivery>();
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(inviteUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="action-body">
      {inviteUrl ? (
        <div className="invite-link">
          <Link2 size={15} aria-hidden="true" />
          <span><strong>Confirmation link for {order.counterparty}</strong><code>{inviteUrl}</code></span>
          <Button variant="outline" size="sm" onClick={() => void copy()}><ClipboardCopy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy link"}</Button>
        </div>
      ) : (
        <p className="action-note">{order.counterparty} can confirm from their own ProofPay workspace after signing in with the invited email. Earlier links are not shown again. Send a new invitation to replace them.</p>
      )}
      {delivery && <Notice tone={delivery.status === "sent" ? "success" : "info"}>{delivery.status === "sent" ? "The invitation email was sent. Any earlier link no longer works." : delivery.status === "failed" ? "The email could not be delivered. Copy the link and send it yourself." : "Automatic email is not configured. Copy the link and send it yourself."}</Notice>}
      <div className="action-buttons">
        {live && (
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run("invite", async () => { const result = await sendLiveInvite(order.id); setInviteUrl(result.inviteUrl); setDelivery(result.inviteDelivery); return withExtras(result.order); })}>
            {busy === "invite" ? "Sending" : "Send new invitation"}
          </Button>
        )}
        {live && order.inviteExpiresAt && (
          <Button variant="outline" className="btn-danger-outline" disabled={Boolean(busy)} onClick={() => void run("cancel", async () => withExtras(await cancelLiveInvite(order.id)), "The invitation was cancelled.")}>
            <X size={14} aria-hidden="true" />{busy === "cancel" ? "Cancelling" : "Cancel invitation"}
          </Button>
        )}
        {!live && order.status === "changes_requested" && (
          <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => void run("resend", async () => withStatus(order, order.initiatorRole === "buyer" ? "awaiting_supplier" : "awaiting_buyer", "Revised order sent for confirmation."), "The revised order was sent.")}>Send revised order</Button>
        )}
      </div>
    </div>
  );
}

function ConfirmControls({ order, company, live, inviteToken, busy, run, onInviteConsumed }: StepProps & { inviteToken?: string; onInviteConsumed?: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [comparison, setComparison] = useState<OrderDocument | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const iAmBuyer = order.role === "BUYER";

  const confirm = () => run("confirm", async () => {
    if (!live) return confirmSample(order, company);
    const result = inviteToken ? await acceptLiveInvite(inviteToken) : await acceptLiveInvitation(order.id);
    clearPendingInvite();
    onInviteConsumed?.();
    return withExtras(result);
  }, iAmBuyer ? "The order is confirmed. Fund escrow when you are ready." : "The order is confirmed. The buyer funds escrow next.");

  const checkDocument = async () => {
    if (!checkFile) return;
    setChecking(true);
    setCheckError("");
    try {
      const extracted = await extractPurchaseOrder(checkFile);
      const document = await buildDocument(checkFile, "purchase_order", order.role, extracted);
      void run("attach", async () => attachFile(order, checkFile, "purchase_order", order.role, { extracted }));
      setComparison(document);
      setCheckOpen(false);
    } catch (cause) {
      setCheckError(errorText(cause, "The document could not be read."));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="action-body">
      <div className="check-strip">
        <div><strong>Check against your own purchase order</strong><small>Upload the PO document you received or issued. The quantities and prices are compared with this order before you confirm.</small></div>
        <Button variant="outline" size="sm" onClick={() => { setCheckError(""); setCheckFile(null); setCheckOpen(true); }}><ScanSearch size={14} aria-hidden="true" />Compare a document</Button>
      </div>
      {comparison && <ExtractionComparison order={order} document={comparison} onClose={() => setComparison(null)} />}
      <label className="consent-check">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        <span>I have reviewed every line, the unit prices, the delivery date and the delivery location on this order.</span>
      </label>
      <AgreementBlock company={company} accepted={accepted} onChange={setAccepted}
        clauses={[
          `${company} confirms order ${order.reference} version ${order.version} as ${iAmBuyer ? "buyer" : "supplier"}. The confirmed terms are hashed into the Sui escrow when it is funded.`,
          iAmBuyer ? `You fund ${money(order.value)} SUI into escrow next. Release follows the inspection result.` : `${order.buyer} funds ${money(order.value)} SUI into escrow. The accepted value is released to you when the buyer accepts the delivery.`,
          "Any exception at delivery is handled under the Dispute Resolution Policy: the accepted value is released and only the disputed amount stays in escrow.",
        ]} />
      <div className="action-buttons">
        <Button variant="outline" disabled={Boolean(busy)} onClick={() => setChangeOpen(true)}><X size={14} aria-hidden="true" />Request changes</Button>
        <Button className="btn-primary" disabled={!reviewed || !accepted || Boolean(busy)} onClick={() => void confirm()}><Check size={14} aria-hidden="true" />{busy === "confirm" ? "Confirming" : "Confirm and accept terms"}</Button>
      </div>
      <ConsentDialog open={changeOpen} onOpenChange={setChangeOpen} company={company} title="Request changes" description="Tell the other company what needs to change. The order stays unconfirmed until they send a revised version."
        clauses={["The order is not confirmed until a revised version is sent and accepted."]}
        confirmLabel="Send change request" busy={busy === "changes"}
        onConfirm={async () => {
          if (live) { setChangeOpen(false); await run("changes", async () => { throw new Error("Change requests on live orders are not available yet. Contact the other company directly and ask them to cancel and reissue the order."); }); return; }
          if (await run("changes", async () => withStatus(order, "changes_requested", reason || "Changes were requested."), "Your change request was sent.")) setChangeOpen(false);
        }}>
        <label className="field"><span>What should change?</span><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: unit price for line 2 should be 265" /></label>
      </ConsentDialog>
      <ConsentDialog open={checkOpen} onOpenChange={setCheckOpen} company={company} title="Compare a purchase order document"
        description="The file is read once to extract line quantities and prices for comparison, and attached to the order with its fingerprint."
        clauses={["The document is genuine and relates to this order.", "You are authorised to share it with the other party."]}
        confirmLabel="Read and compare" busy={checking} onConfirm={checkDocument}>
        <FileField label="Choose the purchase order file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" onFile={setCheckFile} file={checkFile} />
        {checkError && <Notice tone="error">{checkError}</Notice>}
      </ConsentDialog>
    </div>
  );
}

function FundControls({ order, company, live, busy, run }: StepProps) {
  const [open, setOpen] = useState(false);
  const escrow = useEscrowActions();
  const payout = order.raw?.supplierWalletAddress;
  const short = (value?: string) => value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "Not attached yet";
  return (
    <div className="action-body">
      {order.confirmation && <div className="agreement agreement-done"><Check size={15} aria-hidden="true" /><span>Confirmed by <strong>{order.confirmation.organizationName || order.counterparty}</strong> on {formatDateTime(order.confirmation.confirmedAt)} under Terms of Service and Dispute Resolution Policy version {order.confirmation.termsVersion}.</span></div>}
      <dl className="fact-list">
        <div><dt>Amount to secure</dt><dd><strong>{money(order.value)} SUI</strong></dd></div>
        <div><dt>Released to</dt><dd>{order.supplier}<small>{live ? short(payout) : "Verified payout address"}</small></dd></div>
        <div><dt>Signed by</dt><dd>{live ? (escrow.signingAddress ? short(escrow.signingAddress) : "No Sui address in this session") : "Your business wallet"}<small>{live && escrow.hasZkLogin ? "Google zkLogin address" : live ? "Connected wallet" : ""}</small></dd></div>
      </dl>
      <div className="action-buttons">
        <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => setOpen(true)}>Fund escrow<ArrowRight size={14} aria-hidden="true" /></Button>
      </div>
      <ConsentDialog open={open} onOpenChange={setOpen} company={company} title={`Fund ${money(order.value)} SUI into escrow`}
        description="The amount moves from your Sui address into the escrow contract for this order. ProofPay cannot withdraw it."
        clauses={[
          `${money(order.value)} SUI is locked for order ${order.reference} and released to ${order.supplier} only when you accept the delivery, or according to the claim outcome.`,
          "The confirmed order terms are hashed into the escrow so neither party can later dispute what was agreed.",
          "Release follows the inspection result and the Dispute Resolution Policy.",
        ]}
        confirmLabel={live ? "Sign and fund escrow" : "Fund escrow"} busy={busy === "fund"}
        onConfirm={async () => {
          if (await run("fund", async () => {
            if (!live) return withStatus(order, "funded", `${order.buyer} secured ${money(order.value)} SUI in escrow.`);
            if (!order.raw) throw new Error("Order data is missing.");
            return withExtras(await viewLiveOrder(await escrow.fundEscrow(order.raw)));
          }, "Escrow is funded. The supplier can ship now.")) setOpen(false);
        }} />
    </div>
  );
}

function ShipForm({ order, company, live, busy, run }: StepProps) {
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [tracking, setTracking] = useState("");
  const [dispatchedAt, setDispatchedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedAt, setExpectedAt] = useState(order.delivery);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const valid = carrier.trim().length > 1 && tracking.trim().length > 3 && Boolean(dispatchedAt);
  const shipment: OrderShipment = { carrier: carrier.trim(), trackingNumber: tracking.trim(), dispatchedAt: new Date(dispatchedAt).toISOString(), expectedAt };
  return (
    <div className="action-body">
      <div className="form-grid form-grid-3">
        <label className="field"><span>Carrier</span>
          <select className="select" value={carrier} onChange={(event) => setCarrier(event.target.value)}>{CARRIERS.map((name) => <option key={name}>{name}</option>)}</select>
        </label>
        <label className="field"><span>Tracking number</span><Input value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="DHL 4471 2290 MY" /></label>
        <label className="field"><span>Dispatch date</span><Input type="date" value={dispatchedAt} onChange={(event) => setDispatchedAt(event.target.value)} /></label>
        <label className="field"><span>Expected arrival</span><Input type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} /></label>
      </div>
      <FileField label="Attach dispatch note or carrier receipt (optional)" accept=".pdf,.png,.jpg,.jpeg,.webp" onFile={setFile} file={file} />
      <div className="action-buttons">
        <Button className="btn-primary" disabled={!valid || Boolean(busy)} onClick={() => setOpen(true)}><Truck size={14} aria-hidden="true" />Mark as shipped</Button>
      </div>
      <ConsentDialog open={open} onOpenChange={setOpen} company={company} title="Mark as shipped"
        description={`${order.buyer} will see the carrier, tracking number and expected arrival. They record delivery when the goods arrive.`}
        clauses={["The dispatch details and any attached evidence are genuine and unaltered.", "This update is recorded on the shared order and both parties see it."]}
        confirmLabel="Mark as shipped" busy={busy === "ship"}
        onConfirm={async () => {
          if (await run("ship", async () => {
            let next: DemoOrder;
            if (!live) next = shipSample(order, shipment);
            else {
              next = withExtras(await markLiveShipment(order.id, shipment));
            }
            if (file) next = await attachFile(next, file, "dispatch_evidence", "SUPPLIER");
            return next;
          }, "The order is marked in transit.")) setOpen(false);
        }} />
    </div>
  );
}

function TransitCard({ order, company, live, busy, run }: StepProps) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const shipment = order.shipment;
  const buyer = order.role === "BUYER";
  return (
    <div className="action-body">
      <div className="shipment-card">
        <span className="shipment-icon"><Truck size={18} aria-hidden="true" /></span>
        <div>
          <strong>{shipment ? `Shipped by ${shipment.carrier} on ${formatDate(shipment.dispatchedAt)}` : `Shipped by ${order.supplier}`}</strong>
          <span>{shipment ? <>Tracking <code>{shipment.trackingNumber}</code>{shipment.expectedAt ? `, expected ${formatDate(shipment.expectedAt)}` : ""}</> : `Expected ${formatDate(order.delivery)} at ${order.deliveryLocation}.`}</span>
        </div>
      </div>
      <div className="action-buttons">
        <Button className={buyer ? "btn-primary" : ""} variant={buyer ? "default" : "outline"} disabled={Boolean(busy)} onClick={() => setOpen(true)}><PackageCheck size={14} aria-hidden="true" />{buyer ? "The goods have arrived" : "Record delivery for the carrier"}</Button>
      </div>
      <ConsentDialog open={open} onOpenChange={setOpen} company={company} title="Record delivery"
        description={buyer ? "Confirm the goods reached the delivery location. You check the quantities in the next step." : "Confirm the carrier handed the goods over. The buyer checks the quantities next."}
        clauses={["The goods were handed over at the agreed delivery location.", "The inspection window under the Dispute Resolution Policy starts now."]}
        confirmLabel="Record delivery" busy={busy === "deliver"}
        onConfirm={async () => {
          if (await run("deliver", async () => {
            let next: DemoOrder;
            if (!live) next = deliverSample(order, order.role, reference.trim() || undefined);
            else {
              next = withExtras(await markLiveDelivered(order.id, { reference: reference.trim() || undefined }));
            }
            if (file) next = await attachFile(next, file, "delivery_evidence", order.role);
            return next;
          }, buyer ? "Delivery recorded. Now check the goods." : "Delivery recorded. The buyer checks the goods next.")) setOpen(false);
        }}>
        <label className="field"><span>Delivery order number (optional)</span><Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="DO-2471" /></label>
        <FileField label="Attach the signed delivery order or photos (optional)" accept=".pdf,.png,.jpg,.jpeg,.webp" onFile={setFile} file={file} />
      </ConsentDialog>
    </div>
  );
}

function InspectionFlow({ order, company, live, busy, run }: StepProps) {
  const [choice, setChoice] = useState<"intact" | "exceptions" | null>(null);
  const [lines, setLines] = useState<InspectionLine[]>(() => order.items.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 })));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [demoClaimOpen, setDemoClaimOpen] = useState(false);
  const escrow = useEscrowActions();

  const update = (lineId: string, field: "missing" | "damaged", value: number) => setLines((current) => current.map((entry) => {
    if (entry.lineId !== lineId) return entry;
    const item = order.items.find((candidate) => candidate.id === lineId)!;
    const next = { ...entry, [field]: Math.max(0, Math.min(item.quantity, Math.floor(value || 0))) };
    if (next.missing + next.damaged > item.quantity) next[field === "missing" ? "damaged" : "missing"] = item.quantity - next[field];
    next.accepted = item.quantity - next.missing - next.damaged;
    return next;
  }));

  const totals = useMemo(() => {
    let accepted = 0, held = 0, rejectedUnits = 0;
    for (const entry of lines) {
      const item = order.items.find((candidate) => candidate.id === entry.lineId)!;
      accepted += entry.accepted * item.unitPrice;
      held += (entry.missing + entry.damaged) * item.unitPrice;
      rejectedUnits += entry.missing + entry.damaged;
    }
    return { accepted, held, rejectedUnits };
  }, [lines, order.items]);
  const exceptions = choice === "exceptions";
  const claimReady = exceptions && totals.rejectedUnits > 0 && note.trim().length >= 10;
  const fullLines = () => order.items.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 }));

  const acceptAll = () => run("accept", async () => {
    if (!live) return recordSampleInspection(order, fullLines(), "");
    if (!order.raw) throw new Error("Order data is missing.");
    return withExtras(await escrow.acceptDelivery(order.raw, { lines: fullLines() }));
  }, "Delivery accepted in full. The whole escrow was released to the supplier.");

  const openClaim = (demo: boolean) => run("claim", async () => {
    let base = order;
    let files;
    if (file) { const evidence = await prepareEvidence(order, file, "BUYER"); base = evidence.order; files = [evidence.input]; }
    let next: DemoOrder;
    if (!live) next = recordSampleInspection(base, lines, note.trim(), file ? 1 : 0);
    else {
      if (!base.raw) throw new Error("Order data is missing.");
      const input = { disputedValue: totals.held, requestedValue: totals.held, claim: note.trim(), evidence: `${note.trim()}${file ? ` Evidence file ${file.name} attached.` : ""}`, files, inspection: { lines, note: note.trim() } };
      if (demo) {
        const result = await openDemoClaim(base.id, input);
        const { getLiveOrder } = await import("@/lib/live-orders");
        next = { ...withExtras(await getLiveOrder(result.orderId)), claim: result.claim };
      } else {
        const result = await escrow.openClaim(base.raw, input);
        next = { ...withExtras(result.order), claim: result.claim };
      }
    }
    return next;
  }, "Claim opened. The accepted value is released and the disputed amount stays in escrow until the claim is settled.");

  return (
    <div className="action-body">
      {order.deliveryRecord && (
        <div className="shipment-card">
          <span className="shipment-icon"><PackageCheck size={18} aria-hidden="true" /></span>
          <div>
            <strong>Delivery recorded on {formatDateTime(order.deliveryRecord.recordedAt)}</strong>
            <span>{order.shipment ? `${order.shipment.carrier}, tracking ${order.shipment.trackingNumber}. ` : ""}{order.deliveryRecord.reference ? `Delivery order ${order.deliveryRecord.reference}.` : ""}</span>
          </div>
        </div>
      )}
      <div className="choice-question">
        <strong>Did everything arrive as ordered?</strong>
        <div className="choice-grid" role="radiogroup" aria-label="Inspection result">
          <button type="button" role="radio" aria-checked={choice === "intact"} className={choice === "intact" ? "choice choice-active" : "choice"} onClick={() => setChoice("intact")}>
            <Check size={18} aria-hidden="true" /><span><strong>Yes, everything intact</strong><small>{money(order.value)} SUI is released to {order.supplier}.</small></span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "exceptions"} className={choice === "exceptions" ? "choice choice-active choice-danger" : "choice"} onClick={() => setChoice("exceptions")}>
            <X size={18} aria-hidden="true" /><span><strong>Some items missing or damaged</strong><small>Record what was wrong and open a claim for that value.</small></span>
          </button>
        </div>
      </div>

      {choice === "intact" && (
        <div className="action-buttons">
          <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => setConfirmOpen(true)}>Accept delivery and release {money(order.value)} SUI</Button>
        </div>
      )}

      {exceptions && (
        <>
          <table className="data-table inspection-table">
            <thead><tr><th>Line</th><th>Ordered</th><th>Missing</th><th>Damaged</th><th>Accepted</th><th className="num">Held for claim</th></tr></thead>
            <tbody>
              {order.items.map((item) => {
                const entry = lines.find((candidate) => candidate.lineId === item.id)!;
                return (
                  <tr key={item.id}>
                    <td><strong>{item.description}</strong><small>{money(item.unitPrice)} SUI per {item.unit.replace(/s$/, "")}</small></td>
                    <td>{money(item.quantity)} {item.unit}</td>
                    <td><Input type="number" inputMode="numeric" min={0} max={item.quantity} aria-label={`Missing quantity for ${item.description}`} value={entry.missing} onChange={(event) => update(item.id, "missing", Number(event.target.value))} /></td>
                    <td><Input type="number" inputMode="numeric" min={0} max={item.quantity} aria-label={`Damaged quantity for ${item.description}`} value={entry.damaged} onChange={(event) => update(item.id, "damaged", Number(event.target.value))} /></td>
                    <td aria-label={`Accepted quantity for ${item.description}`}>{money(entry.accepted)} {item.unit}</td>
                    <td className="num">{money((entry.missing + entry.damaged) * item.unitPrice)} SUI</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="inspection-summary">
            <div><span>Released to supplier</span><strong>{money(totals.accepted)} SUI</strong></div>
            <div><span>Held for claim</span><strong>{money(totals.held)} SUI</strong></div>
            <div><span>Rejected</span><strong>{totals.rejectedUnits} units</strong></div>
          </div>
          {totals.rejectedUnits === 0 && <p className="action-note">Enter the missing or damaged quantity on at least one line, or choose "Yes, everything intact".</p>}
          {totals.rejectedUnits > 0 && (
            <>
              <label className="field"><span>What was wrong<HelpHint text="This statement is sent to the supplier with the claim and quoted by the AI mediator. Say what arrived, in what condition, and how you know." /></span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="13 cartons arrived crushed and leaking. The driver noted the damage on the signed delivery order." />
              </label>
              <FileField label="Attach evidence" hint="Signed delivery order or photos. The file is read into text for the mediator. Only its fingerprint is kept with the order." accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onFile={setFile} file={file} />
              {note.trim().length < 10 && <p className="action-note">Describe what was wrong in at least 10 characters before you can open the claim. You have written {note.trim().length}.</p>}
              <div className="action-buttons">
                {DEMO_CONTROLS && live && <Button variant="outline" disabled={!claimReady || Boolean(busy)} onClick={() => setDemoClaimOpen(true)}><FastForward size={14} aria-hidden="true" />Open claim without signing (demo)</Button>}
                <Button className="btn-primary" disabled={!claimReady || Boolean(busy)} onClick={() => setConfirmOpen(true)}>Open claim for {money(totals.held)} SUI</Button>
              </div>
            </>
          )}
        </>
      )}

      <ConsentDialog open={confirmOpen} onOpenChange={setConfirmOpen} company={company}
        title={choice === "intact" ? "Accept the delivery in full" : "Open a claim"}
        description={choice === "intact"
          ? `${money(order.value)} SUI is released to ${order.supplier} from the escrow contract.${live ? " You sign one Sui transaction." : ""} This cannot be reversed.`
          : `${money(totals.accepted)} SUI is released to ${order.supplier} now. ${money(totals.held)} SUI stays in escrow until the claim is settled.${live ? " You sign one Sui transaction." : ""}`}
        clauses={choice === "intact"
          ? ["The quantities received match the order in full.", "The release is final and settles this order."]
          : ["The quantities entered are what your company actually received, and any evidence attached is genuine and unaltered.", "The accepted value is released to the supplier now. Only the held amount is disputed.", "The claim follows the Dispute Resolution Policy: supplier response, negotiation with optional AI mediation, then arbitration if no agreement is reached."]}
        confirmLabel={choice === "intact" ? "Release payment" : "Open claim"} busy={busy === "accept" || busy === "claim"}
        onConfirm={async () => { const ok = choice === "intact" ? await acceptAll() : await openClaim(false); if (ok) setConfirmOpen(false); }} />
      <ConsentDialog open={demoClaimOpen} onOpenChange={setDemoClaimOpen} company={company} title="Open claim without the Sui signature"
        description="Demo control. The claim is recorded on the backend with a placeholder dispute reference instead of a signed Sui transaction."
        clauses={["This shortcut is for demonstrations only.", "The claim record itself is real and the mediation runs on the live model."]}
        confirmLabel="Open claim (demo)" busy={busy === "claim"} onConfirm={async () => { if (await openClaim(true)) setDemoClaimOpen(false); }} />
    </div>
  );
}

function SettlementRecord({ order }: { order: DemoOrder }) {
  const settlement = order.settlement;
  return (
    <div className="action-body">
      <dl className="fact-list">
        <div><dt>Paid to supplier</dt><dd><strong>{money(settlement?.supplierValue ?? order.value)} SUI</strong></dd></div>
        <div><dt>Returned to buyer</dt><dd><strong>{money(settlement?.buyerValue ?? 0)} SUI</strong></dd></div>
        <div><dt>How</dt><dd>{settlement?.source === "dispute" ? "Agreed under the claim and executed on Sui." : "Delivery accepted in full. The whole escrow was released to the supplier."}</dd></div>
        <div><dt>Sui transaction</dt><dd>{settlement?.transactionDigest && settlement.verifiedOnChain
          ? <a className="link" href={explorerTransactionUrl(settlement.transactionDigest)} target="_blank" rel="noreferrer">View on Suiscan<ExternalLink size={12} aria-hidden="true" /></a>
          : order.source === "sample" ? "Sample order, no on-chain record" : "Recorded without on-chain verification"}</dd></div>
      </dl>
    </div>
  );
}

function DemoControl({ order, live, busy, run }: StepProps) {
  const next = demoNextStatus(order.status);
  if (!next) return null;
  let unavailable = "";
  if (live) {
    if (["awaiting_supplier", "awaiting_buyer", "changes_requested"].includes(order.status)) unavailable = "The invited company has to confirm. Sign in as that account to continue.";
    else if (isDisputed(order.status)) unavailable = "Use the claim section to move a disputed order forward.";
  }
  const step = async () => run("demo", async () => {
    if (!live) return advanceSample(order);
    if (order.status === "supplier_confirmed") return withExtras(await recordDemoFunding(order));
    if (order.status === "funded") return withExtras(await markLiveShipment(order.id, { carrier: "DHL Express", trackingNumber: `DHL${Date.now().toString().slice(-8)}MY`, dispatchedAt: new Date().toISOString(), expectedAt: order.delivery }));
    if (order.status === "in_transit") return withExtras(await markLiveDelivered(order.id, {}));
    if (order.status === "delivered") return withExtras(await recordDemoAcceptance(order, { lines: order.items.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 })) }));
    return null;
  }, `Moved to ${STATUS[next].label}.`);
  const hint = unavailable || `Demo control: skip to "${STATUS[next].label}" without the usual evidence.${live ? " The backend records the step as a real state change." : " Only this sample changes."}`;
  return (
    <button type="button" className="demo-skip" aria-label="Skip to next step" title={hint} disabled={Boolean(unavailable) || Boolean(busy)} onClick={() => void step()}>
      <FastForward size={13} aria-hidden="true" />{busy === "demo" ? "Moving" : `Skip to ${STATUS[next].label}`}
    </button>
  );
}

export type { DocumentKind };

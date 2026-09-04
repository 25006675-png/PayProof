"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, FastForward, FileText, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, HelpHint, Logo, Notice, RoleTag, SampleTag, Skeleton, StatusPill } from "@/app/components/app-shell";
import { ClaimSection } from "@/app/components/claim-section";
import { ActionPanel } from "@/app/components/order-actions";
import { DocumentsPanel } from "@/app/components/order-documents";
import { OrderStepper, OrderTimeline } from "@/app/components/order-stepper";
import { AnimatedAmount, LiftCard, StageSwitch } from "@/app/components/motion";
import { type DemoOrder, formatDate, formatDateTime, formatOrderMoney as money, totalQuantity } from "@/lib/demo-orders";
import { loadClaim } from "@/lib/dispute-actions";
import { getLiveOrder, previewLiveInvite } from "@/lib/live-orders";
import { withExtras } from "@/lib/local-order-extras";
import { STATUS, isDisputed } from "@/lib/order-status";
import { clearSession, loadSession, signOutSession } from "@/lib/payproof-api";
import { savePendingInvite } from "@/lib/pending-invite";
import { beginGoogleZkLogin } from "@/lib/auth";
import { advanceSample, guidedDemoNextLabel } from "@/lib/sample-orders";
import { useWorkspace } from "@/lib/use-workspace";

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const workspace = useWorkspace();
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [ready, setReady] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [loadError, setLoadError] = useState("");
  const [inviteAuthRequired, setInviteAuthRequired] = useState(false);
  const [claimError, setClaimError] = useState("");
  const isSample = id.startsWith("sample-");

  useEffect(() => {
    void (async () => {
      const token = new URLSearchParams(window.location.search).get("invite") ?? "";
      setInviteToken(token);
      if (token) savePendingInvite(id, token);
      if (isSample) return;
      if (loadSession()) {
        try {
          setOrder(withExtras(token ? await previewLiveInvite(token) : await getLiveOrder(id)));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "This order could not be loaded.";
          setLoadError(message);
          setInviteAuthRequired(Boolean(token && /supplier email|different supplier account|invited/i.test(message)));
        }
      } else if (token) {
        setInviteAuthRequired(true);
      } else {
        setLoadError("Sign in to open this order.");
      }
      setReady(true);
    })();
  }, [id, isSample]);

  useEffect(() => {
    if (!isSample || !workspace.ready) return;
    const found = workspace.sampleOrders.find((item) => item.id === id) ?? null;
    setOrder(found);
    if (!found) setLoadError("This sample order does not exist for your account.");
    setReady(true);
  }, [isSample, workspace.ready, workspace.sampleOrders, id]);

  // Live claims are loaded from the dispute record once the order arrives.
  useEffect(() => {
    if (!order || order.source !== "backend" || !order.disputeId || order.claim) return;
    let cancelled = false;
    loadClaim(order.disputeId)
      .then((claim) => { if (!cancelled) setOrder((current) => current && current.id === order.id ? { ...current, claim } : current); })
      .catch((cause) => { if (!cancelled) setClaimError(cause instanceof Error ? cause.message : "The claim could not be loaded."); });
    return () => { cancelled = true; };
  }, [order]);

  const change = (next: DemoOrder) => {
    if (next.source === "sample") { workspace.updateSample(next.id, () => next); setOrder(next); return; }
    setOrder(next);
  };

  if (!ready) {
    return (
      <AppShell active="orders" company={workspace.company}>
        <div className="panel"><Skeleton lines={2} /></div>
        <div className="panel"><Skeleton lines={4} /></div>
      </AppShell>
    );
  }
  if (!order && inviteToken && inviteAuthRequired) return <InviteGate error={loadError} />;
  if (!order) {
    return (
      <AppShell active="orders" company={workspace.company}>
        <div className="empty-state">
          <FileText size={26} aria-hidden="true" />
          <h1>Order not available</h1>
          <p>{loadError || "This order could not be found."}</p>
          <Button asChild><a href="/orders">Back to orders</a></Button>
        </div>
      </AppShell>
    );
  }

  const meta = STATUS[order.status];
  const quantity = totalQuantity(order.items);
  const showClaim = Boolean(order.claim) && (isDisputed(order.status) || order.status === "settled");
  const roleKey = order.role.toLowerCase();
  const escrowState = order.funding
    ? order.funding.verificationStatus === "verified_on_chain" ? "Verified on Sui" : "Recorded from a Sui reference"
    : order.source === "sample" && meta.step >= 2 ? "Secured (sample)" : "Not funded yet";

  return (
    <AppShell active="orders" company={workspace.company}>
      <a className="back-link" href="/orders"><ArrowLeft size={14} aria-hidden="true" />All orders</a>
      <LiftCard as="header" className={`order-header order-header-${roleKey} reveal`} tilt={1.5} lift={2}>
        <div className="order-header-top">
          <div>
            <div className="order-head-tags"><StatusPill status={order.status} /><RoleTag role={order.role} compact />{order.source === "sample" && <SampleTag label={order.guidedDemo ? "Guided demo" : undefined} />}</div>
            <h1>{order.reference}</h1>
            <p>{order.item}. {money(quantity)} units across {order.items.length} {order.items.length === 1 ? "line" : "lines"}. {meta.summary}</p>
          </div>
          <div className="order-head-total"><span>Order value</span><strong><AnimatedAmount value={order.value} /> <small>{order.currency}</small></strong></div>
        </div>
        <dl className="fact-strip">
          <div><dt>Buyer</dt><dd><strong>{order.buyer}</strong>{order.raw?.buyerEmail && <small>{order.raw.buyerEmail}</small>}</dd></div>
          <div><dt>Supplier</dt><dd><strong>{order.supplier}</strong>{order.raw?.supplierEmail && <small>{order.raw.supplierEmail}</small>}</dd></div>
          <div><dt>Expected delivery</dt><dd><strong>{formatDate(order.delivery)}</strong>{order.shipment?.carrier && <small>{order.shipment.carrier}</small>}</dd></div>
          <div><dt>Delivery location</dt><dd><strong>{order.deliveryLocation}</strong></dd></div>
          <div><dt>Escrow<HelpHint text="Funds are held by the Sui escrow contract, not by ProofPay, and are released according to the inspection result and the Dispute Resolution Policy." /></dt><dd><strong>{escrowState}</strong>{order.funding && <small>{order.funding.escrowObjectId.slice(0, 10)}...{order.funding.escrowObjectId.slice(-6)}</small>}</dd></div>
        </dl>
      </LiftCard>
      {order.source === "sample" && <Notice tone="info">This is a sample order for demonstration. Every action changes only this sample. Nothing is sent to the backend or to Sui.</Notice>}
      {claimError && <Notice tone="error">{claimError}</Notice>}
      {order.guidedDemo && (
        <section className="guided-demo-bar" aria-label="Guided demo controls">
          <div><strong>Buyer-led guided demo</strong><span>Use the normal action, or jump ahead with realistic prefilled data and evidence.</span></div>
          <Button variant="outline" onClick={() => {
            if (order.status === "settled") { workspace.resetSamples(); return; }
            const next = advanceSample(order);
            if (next) change(next);
          }}>
            {order.status === "settled" ? <RotateCcw size={14} aria-hidden="true" /> : <FastForward size={14} aria-hidden="true" />}
            {guidedDemoNextLabel(order)}
          </Button>
        </section>
      )}
      {/* The stepper and the working columns share one block container so the bar can stick while they scroll. */}
      <div className="order-body">
        <div className="stepper-bar reveal reveal-1"><OrderStepper status={order.status} /></div>

        <div className="order-grid">
          <div className="order-main">
            <div className="reveal reveal-2">
              <StageSwitch stageKey={showClaim ? "claim" : order.status}>
                {showClaim && order.claim
                  ? <ClaimSection order={order} claim={order.claim} company={workspace.company} onOrderChange={change} onClaimChange={(claim) => change({ ...order, claim })} railId="order-rail-actions" />
                  : <ActionPanel order={order} company={workspace.company} inviteToken={inviteToken} onChange={change} onInviteConsumed={() => { setInviteToken(""); history.replaceState(null, "", `/orders/${encodeURIComponent(order.id)}`); }} />}
              </StageSwitch>
            </div>
  
            <section className="panel reveal reveal-3" aria-labelledby="lines-title">
              <div className="panel-head"><h2 id="lines-title">Order lines</h2><span className="panel-meta">Version {order.version}</span></div>
              <table className="data-table lines-table">
                <thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th className="num">Line total</th></tr></thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.description}</strong></td>
                      <td>{money(item.quantity)} {item.unit}</td>
                      <td>{money(item.unitPrice)} {order.currency}</td>
                      <td className="num"><strong>{money(item.quantity * item.unitPrice)} {order.currency}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>Total in {order.settlementAsset}</td><td className="num"><strong>{money(order.value)} {order.currency}</strong></td></tr></tfoot>
              </table>
              {order.inspection && !isDisputed(order.status) && (
                <div className="inspection-record">
                  <h3>Inspection result</h3>
                  <table className="data-table">
                    <thead><tr><th>Line</th><th>Accepted</th><th>Missing</th><th>Damaged</th></tr></thead>
                    <tbody>{order.inspection.lines.map((entry) => { const item = order.items.find((candidate) => candidate.id === entry.lineId); return item ? <tr key={entry.lineId}><td>{item.description}</td><td>{entry.accepted} {item.unit}</td><td>{entry.missing}</td><td>{entry.damaged}</td></tr> : null; })}</tbody>
                  </table>
                  {order.inspection.note && <p className="muted">{order.inspection.note}</p>}
                </div>
              )}
            </section>
  
            <div className="reveal reveal-4"><DocumentsPanel order={order} role={order.role} company={workspace.company} onOrderChange={change} /></div>
          </div>
  
          <aside className="order-rail">
            <div id="order-rail-actions" className="rail-actions reveal reveal-2" />
            <section className="rail-group reveal reveal-3" aria-labelledby="details-title">
              <h3 id="details-title">Details</h3>
              <dl className="rail-list">
                <div><dt>Issued by</dt><dd>{order.initiatorRole === "buyer" ? order.buyer : order.supplier}</dd></div>
                {order.confirmation && <div><dt>Confirmed</dt><dd>{order.confirmation.organizationName || "Counterparty"}<small>{formatDateTime(order.confirmation.confirmedAt)}, terms version {order.confirmation.termsVersion}</small></dd></div>}
                {order.shipment && <div><dt>Shipment</dt><dd>{order.shipment.carrier}<small>Tracking {order.shipment.trackingNumber}, dispatched {formatDate(order.shipment.dispatchedAt)}</small></dd></div>}
                {order.deliveryRecord && <div><dt>Delivered</dt><dd>{formatDateTime(order.deliveryRecord.recordedAt)}{order.deliveryRecord.reference && <small>Delivery order {order.deliveryRecord.reference}</small>}</dd></div>}
                <div><dt>Settlement asset</dt><dd>{order.settlementAsset}</dd></div>
                {order.funding && <div><dt><LockKeyhole size={12} aria-hidden="true" />Escrow object</dt><dd><code>{order.funding.escrowObjectId.slice(0, 14)}...{order.funding.escrowObjectId.slice(-8)}</code></dd></div>}
                <div><dt><ShieldCheck size={12} aria-hidden="true" />Protection</dt><dd>Funds are held by the Sui escrow contract. ProofPay cannot withdraw them.</dd></div>
              </dl>
            </section>
            <section className="rail-group reveal reveal-4" aria-labelledby="history-title">
              <h3 id="history-title">History</h3>
              <OrderTimeline events={order.events} />
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function InviteGate({ error }: { error: string }) {
  const [actionError, setActionError] = useState("");
  const currentSession = loadSession();
  const needsAccountSwitch = Boolean(currentSession);
  return (
    <div className="gate-shell">
      <header className="gate-header"><Logo /><span>Order invitation</span></header>
      <main className="gate-main">
        <section aria-labelledby="invite-sign-in-title">
          <span className="gate-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
          <h1 id="invite-sign-in-title">{needsAccountSwitch ? "Switch account to review this order" : "Sign in to review this order"}</h1>
          <p>{needsAccountSwitch
            ? <>You are signed in as <strong>{currentSession?.user.email || "a different account"}</strong>. Use the Google account that received this invitation.</>
            : "Use the Google account that received the invitation. Your invitation stays attached and opens automatically after sign-in."}</p>
          <div className="gate-assurance"><LockKeyhole size={15} aria-hidden="true" /><span><strong>The order remains private</strong><small>ProofPay checks the signed-in email before showing commercial terms.</small></span></div>
          {(actionError || (error && !needsAccountSwitch)) && <p className="form-error" role="alert">{actionError || error}</p>}
          <Button className="btn-primary" onClick={() => {
            setActionError("");
            const returnTo = `${window.location.pathname}${window.location.search}`;
            void (async () => {
              if (needsAccountSwitch) { try { await signOutSession(); } catch { clearSession(); } }
              await beginGoogleZkLogin(returnTo);
            })().catch((cause) => setActionError(cause instanceof Error ? cause.message : "Google sign-in could not be started."));
          }}>{needsAccountSwitch ? "Switch Google account" : "Continue with Google"}<ArrowRight size={14} aria-hidden="true" /></Button>
          <small className="legal-copy">By continuing you agree to the <a href="/legal/terms">Terms of Service</a> and the <a href="/legal/dispute-policy">Dispute Resolution Policy</a>.</small>
          <a className="gate-back" href="/">Return to ProofPay</a>
        </section>
      </main>
    </div>
  );
}

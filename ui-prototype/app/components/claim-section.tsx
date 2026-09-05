"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bot, Check, ExternalLink, FileText, Gavel, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConsentDialog, FileField, HelpHint, Notice } from "@/app/components/app-shell";
import { DocumentLink, prepareEvidence } from "@/app/components/order-documents";
import { MediationReportView } from "@/app/components/mediation-report";
import { ReleasePlanBar, releaseProgress } from "@/app/components/release-plan";
import { type ClaimProposal, type ClaimView, type DemoOrder, formatDateTime, formatOrderMoney as money } from "@/lib/demo-orders";
import { acceptClaimProposal, enforceClaimDeadline, loadClaim, proposeClaimSplit, rejectClaimProposal, requestMediation, respondToClaim, type EvidenceFileInput } from "@/lib/dispute-actions";
import { useEscrowActions } from "@/lib/escrow-actions";
import { getLiveOrder } from "@/lib/live-orders";
import { agreeSample, escalateSample, executeSampleSettlement, mediateSample, proposeSample, rejectSample, respondSample } from "@/lib/sample-orders";
import { explorerTransactionUrl } from "@/lib/sui-dapp-kit";

type Props = { order: DemoOrder; claim: ClaimView; company: string; onOrderChange: (order: DemoOrder) => void; onClaimChange: (claim: ClaimView) => void; railId?: string };

const STAGES: Array<{ id: ClaimView["status"]; label: string }> = [
  { id: "supplier_review", label: "Supplier response" },
  { id: "negotiation_open", label: "Negotiation" },
  { id: "settlement_pending", label: "Settlement" },
  { id: "settled", label: "Settled" },
];

function useCountdown(deadline: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const remaining = new Date(deadline).getTime() - now;
  if (Number.isNaN(remaining)) return { text: "No deadline", expired: false };
  if (remaining <= 0) return { text: "Deadline passed", expired: true };
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return { text: hours >= 48 ? `${Math.floor(hours / 24)} days left` : `${hours}h ${minutes}m left`, expired: false };
}

function createOrPlace(rail: HTMLElement | null, node: React.ReactElement) {
  return rail ? createPortal(node, rail) : node;
}

function sourceLabel(proposal: ClaimProposal, order: DemoOrder): string {
  if (proposal.source === "ai") return "AI mediator";
  if (proposal.source === "arbitrator") return "Arbitrator";
  return proposal.side === "buyer" ? order.buyer : proposal.side === "supplier" ? order.supplier : "A party";
}

export function ClaimSection({ order, claim, company, onOrderChange, onClaimChange, railId }: Props) {
  const live = order.source === "backend";
  const [rail, setRail] = useState<HTMLElement | null>(null);
  useEffect(() => { setRail(railId ? document.getElementById(railId) : null); }, [railId]);
  const mySide: "buyer" | "supplier" = order.role === "BUYER" ? "buyer" : "supplier";
  const escrow = useEscrowActions();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const countdown = useCountdown(claim.deadline);
  const open = claim.proposals.find((proposal) => proposal.status === "open");
  const stageIndex = claim.status === "arbitration_pending" ? 1 : STAGES.findIndex((stage) => stage.id === claim.status);
  // open_dispute pays this out in the claim transaction itself; only the disputed amount stays.
  const undisputedPaid = claim.totalValue - claim.disputedValue;
  const myAccepted = open?.acceptances.includes(mySide) ?? false;
  const iProposed = open?.source === "human" && open.side === mySide;

  const run = async (name: string, task: () => Promise<void>, success?: string) => {
    setBusy(name);
    setError("");
    try { await task(); if (success) setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed."); }
    finally { setBusy(""); }
  };

  /** Live claims re-read the order so its status follows the dispute. */
  const applyLive = async (next: ClaimView) => {
    const refreshed = await getLiveOrder(order.id);
    onOrderChange({ ...refreshed, claim: next });
  };

  // Supplier response
  const [respondOpen, setRespondOpen] = useState<"accept" | "dispute" | null>(null);
  const [statement, setStatement] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  const respond = (agrees: boolean) => run("respond", async () => {
    let files: EvidenceFileInput[] | undefined;
    let base = order;
    if (evidenceFile) { const evidence = await prepareEvidence(order, evidenceFile, "SUPPLIER"); base = evidence.order; files = [evidence.input]; }
    if (!live) {
      onOrderChange(respondSample(base, agrees, statement.trim() || (agrees ? "The supplier accepts the claim." : "The supplier disputes the claim."), evidenceFile ? 1 : 0));
    } else {
      const next = await respondToClaim(claim.id, { agrees, statement: statement.trim() || (agrees ? "The supplier accepts the buyer's requested remedy." : "The supplier disputes the claim."), files });
      await applyLive(next);
    }
    setRespondOpen(null);
    setStatement("");
    setEvidenceFile(null);
  }, agrees ? "You accepted the claim. Both parties sign the settlement next." : "Your response and evidence were recorded. Negotiation is open.");

  // Proposals
  const [proposeOpen, setProposeOpen] = useState(false);
  const [buyerShare, setBuyerShare] = useState(() => Math.round(claim.requestedValue / 2));
  const [summary, setSummary] = useState("");
  const propose = () => run("propose", async () => {
    const buyerValue = Math.max(0, Math.min(claim.disputedValue, buyerShare));
    const supplierValue = Math.round((claim.disputedValue - buyerValue) * 100) / 100;
    const text = summary.trim() || `Refund ${money(buyerValue)} ${order.currency} to the buyer and release ${money(supplierValue)} ${order.currency} to the supplier.`;
    if (!live) { const next = proposeSample(order, mySide, buyerValue, supplierValue, text); onOrderChange(next); }
    else await applyLive(await proposeClaimSplit(claim.id, { buyerValue, supplierValue, summary: text, reasoning: `${company} proposed this split during negotiation.` }, open?.id));
    setProposeOpen(false);
    setSummary("");
  }, "Your proposal was sent. The other party can accept, reject or counter it.");

  const accept = () => run("accept", async () => {
    if (!open) return;
    if (!live) { const next = agreeSample(order, mySide); onOrderChange(next); }
    else await applyLive(await acceptClaimProposal(claim.id, open.id));
  }, "You accepted the proposal.");

  const reject = () => run("reject", async () => {
    if (!open) return;
    if (!live) { const next = rejectSample(order, mySide); onOrderChange(next); }
    else await applyLive(await rejectClaimProposal(claim.id, open.id));
  }, "You rejected the proposal.");

  const [mediationNote, setMediationNote] = useState<{ outcome: "proposal" | "abstain"; reason?: string; unresolved: string[] } | null>(null);
  const mediate = () => run("mediate", async () => {
    if (!live) { const next = mediateSample(order); onOrderChange(next); setMediationNote({ outcome: "proposal", unresolved: [] }); return; }
    const result = await requestMediation(claim.id);
    setMediationNote({ outcome: result.outcome, reason: result.reason, unresolved: result.unresolvedIssues ?? [] });
    await applyLive(result.claim);
  });

  const escalate = () => run("escalate", async () => {
    if (!live) { const next = escalateSample(order); onOrderChange(next); }
    else await applyLive(await enforceClaimDeadline(claim.id));
  }, "The claim was sent to the arbitrator.");

  // On-chain settlement
  const [signed, setSigned] = useState<Record<string, boolean>>({});
  const allocation = claim.settlement ? { buyerValue: claim.settlement.buyerValue, supplierValue: claim.settlement.supplierValue, proposalId: claim.settlement.proposalId ?? claim.settlement.agreementId } : undefined;
  const approve = () => run("approve", async () => {
    if (!allocation) return;
    if (live && order.raw) await escrow.approveSettlement(order.raw, mySide, allocation);
    setSigned((value) => ({ ...value, [mySide]: true }));
  }, "Your approval is signed on Sui.");
  const execute = () => run("execute", async () => {
    if (!live) { const next = executeSampleSettlement(order); onOrderChange(next); return; }
    if (!order.raw) throw new Error("Order data is missing.");
    await applyLive(await escrow.executeSettlement(order.raw, claim.id));
  }, "Settlement executed. The record is final.");

  const proposals = useMemo(() => [...claim.proposals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [claim.proposals]);

  return (
    <section className={`panel claim claim-role-${order.role.toLowerCase()} ${rail ? "claim-single" : ""}`} aria-labelledby="claim-title">
      <div className="panel-head">
        <h2 id="claim-title"><Scale size={17} aria-hidden="true" />Claim<HelpHint text="Only the disputed amount stays in escrow. The accepted value is released to the supplier. The parties negotiate a split, can ask the AI mediator for a non-binding proposal, and the agreed split is signed by both and executed on Sui." /></h2>
        <span className={`claim-deadline ${countdown.expired ? "claim-deadline-expired" : ""}`}>{claim.status === "negotiation_open" || claim.status === "supplier_review" ? `Round ${Math.max(claim.round, 1)} of ${claim.maxRounds}, ${countdown.text}` : ""}</span>
      </div>

      <ol className="claim-stages" aria-label="Claim progress">
        {STAGES.map((stage, index) => (
          <li key={stage.id} className={index < stageIndex ? "done" : index === stageIndex ? "current" : ""}>
            <span className="claim-stage-dot" aria-hidden="true">{index < stageIndex ? <Check size={11} /> : index + 1}</span>{stage.label}
          </li>
        ))}
        {claim.status === "arbitration_pending" && <li className="current claim-stage-branch"><span className="claim-stage-dot" aria-hidden="true"><Gavel size={11} /></span>With arbitrator</li>}
      </ol>

      {order.releasePlan && (
        <div className="claim-money">
          <ReleasePlanBar total={order.value} currency={order.currency}
            values={{ deposit: order.releasePlan.depositValue, dispatch: order.releasePlan.dispatchValue, delivery: order.releasePlan.deliveryValue }}
            progress={releaseProgress(order)} />
          <p className="claim-money-ask">The buyer asks <strong>{money(claim.requestedValue)} {order.currency}</strong> back of the {money(claim.disputedValue)} {order.currency} in dispute. Everything else is already paid out.</p>
        </div>
      )}

      {notice && <Notice tone="success" onDismiss={() => setNotice("")}>{notice}</Notice>}
      {error && <Notice tone="error" onDismiss={() => setError("")}>{error}</Notice>}
      {mediationNote && mediationNote.outcome === "abstain" && (
        <Notice tone="info" onDismiss={() => setMediationNote(null)}>
          <strong>The AI mediator did not propose a split.</strong> {mediationNote.reason}
          {mediationNote.unresolved.length > 0 && <ul className="extraction-warnings">{mediationNote.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          Attach the evidence the questions point to, then request mediation again.
        </Notice>
      )}

      <div className="claim-grid">
        <div className="claim-main">
          <div className="claim-statement">
            <strong>{order.buyer} claims</strong>
            <p>{claim.claim}</p>
          </div>
          <ol className="claim-evidence">
            {claim.evidence.map((entry) => {
              const files = order.documents.filter((document) => document.kind === "claim_evidence" && document.uploadedBy === (entry.side === "buyer" ? "BUYER" : "SUPPLIER"));
              return (
                <li key={entry.id}>
                  <span className={`claim-side claim-side-${entry.side}`}>{entry.side === "buyer" ? order.buyer : order.supplier}</span>
                  <p>{entry.statement}</p>
                  {files.length > 0 && <ul className="evidence-files">{files.map((document) => <li key={document.id}><FileText size={13} aria-hidden="true" /><DocumentLink order={order} document={document} /></li>)}</ul>}
                  <small>{formatDateTime(entry.submittedAt)}</small>
                </li>
              );
            })}
          </ol>

          {proposals.length > 0 && (
            <div className="proposal-list">
              <h3>Proposals</h3>
              {proposals.map((proposal) => (
                <article key={proposal.id} className={`proposal proposal-${proposal.status} ${proposal.source === "ai" ? "proposal-ai" : ""} lift-row`}>
                  <header>
                    <span className="proposal-source">{proposal.source === "ai" && <Bot size={14} aria-hidden="true" />}{sourceLabel(proposal, order)}{proposal.source === "ai" && <em>AI proposal, not binding</em>}</span>
                    <span className={`pill ${proposal.status === "open" ? "pill-progress" : proposal.status === "accepted" ? "pill-success" : "pill-neutral"}`}>{proposal.status === "open" ? "Open" : proposal.status === "accepted" ? "Accepted by both" : proposal.status === "rejected" ? "Rejected" : "Superseded"}</span>
                  </header>
                  <div className="proposal-split">
                    <span><small>Back to buyer</small><strong>{money(proposal.buyerValue)} {order.currency}</strong></span>
                    <span><small>To supplier</small><strong>{money(proposal.supplierValue)} {order.currency}</strong></span>
                    {proposal.evidenceSufficiency && <span><small>Evidence</small><strong className="capitalize">{proposal.evidenceSufficiency}</strong></span>}
                  </div>
                  <p>{proposal.source === "ai" ? `Refund ${money(proposal.buyerValue)} ${order.currency} to the buyer and release ${money(proposal.supplierValue)} ${order.currency} to the supplier.` : proposal.summary}</p>
                  {proposal.acceptances.length > 0 && proposal.status === "open" && <small className="proposal-acceptances">Accepted by {proposal.acceptances.map((side) => side === "buyer" ? order.buyer : order.supplier).join(" and ")}. Waiting for the other party.</small>}
                  {(() => {
                    const run = proposal.source === "ai" ? claim.mediations.find((entry) => entry.proposalId === proposal.id && entry.report) : undefined;
                    return (
                      <>
                        <button type="button" className="text-button proposal-report-toggle" onClick={() => setExpanded(expanded === proposal.id ? null : proposal.id)}>{expanded === proposal.id ? (run ? "Hide mediation report" : "Hide reasoning") : (run ? "View mediation report" : "Show reasoning")}</button>
                        {expanded === proposal.id && run && <MediationReportView run={run} order={order} />}
                        {expanded === proposal.id && !run && (
                          <div className="proposal-reasoning">
                            {proposal.reasoning.split("\n").map((part, index) => <p key={index}>{part}</p>)}
                            {proposal.citations.length > 0 && <ul>{proposal.citations.map((citation, index) => <li key={index}><strong>{citation.locator}</strong> {citation.excerpt}</li>)}</ul>}
                            {proposal.unresolvedIssues.length > 0 && <ul className="extraction-warnings">{proposal.unresolvedIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <small className="proposal-time">Round {proposal.round}, {formatDateTime(proposal.createdAt)}</small>
                </article>
              ))}
            </div>
          )}
          {claim.mediations.filter((run) => run.outcome !== "proposal").map((run) => (
            <div key={run.id} className="mediation-note">
              <Bot size={14} aria-hidden="true" />
              <div>
                <strong>AI mediation on {formatDateTime(run.createdAt)} made no proposal.</strong><span>{run.reason}</span>
                {run.unresolved.length > 0 && <ul>{run.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>}
                {run.report && <button type="button" className="text-button proposal-report-toggle" onClick={() => setExpanded(expanded === run.id ? null : run.id)}>{expanded === run.id ? "Hide mediation report" : "View mediation report"}</button>}
                {expanded === run.id && run.report && <MediationReportView run={run} order={order} />}
              </div>
            </div>
          ))}
        </div>

        {createOrPlace(rail, <aside className="claim-side-panel">
          {claim.status === "supplier_review" && mySide === "supplier" && (
            <div className="claim-actions">
              <strong>Your response</strong>
              <p>Accept the claim to refund {money(claim.requestedValue)} {order.currency}, or dispute it with your evidence.</p>
              <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => setRespondOpen("dispute")}>Dispute with evidence</Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => setRespondOpen("accept")}>Accept the claim</Button>
            </div>
          )}
          {claim.status === "supplier_review" && mySide === "buyer" && <div className="claim-actions"><strong>Waiting for {order.supplier}</strong><p>They can accept the claim or dispute it with evidence. The accepted value is releasable to them meanwhile.</p></div>}

          {claim.status === "negotiation_open" && (
            <div className="claim-actions">
              {open && !iProposed && !myAccepted && (
                <>
                  <strong>{open.source === "ai" ? "Review the AI proposal" : `Review ${sourceLabel(open, order)}'s proposal`}</strong>
                  <p>Accept it to settle, counter with your own split, or reject it.</p>
                  <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => void accept()}><Check size={14} aria-hidden="true" />{busy === "accept" ? "Accepting" : "Accept proposal"}</Button>
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => { setBuyerShare(Math.round(open.buyerValue)); setProposeOpen(true); }}>Counter with another split</Button>
                  <Button variant="outline" className="btn-danger-outline" disabled={Boolean(busy)} onClick={() => void reject()}><X size={14} aria-hidden="true" />Reject</Button>
                </>
              )}
              {open && (iProposed || myAccepted) && <><strong>Waiting for {mySide === "buyer" ? order.supplier : order.buyer}</strong><p>They can accept the open proposal, counter it or reject it.</p></>}
              {!open && (
                <>
                  <strong>No open proposal</strong>
                  <p>Propose a split, or ask the AI mediator to analyse both sides' evidence against the policy and propose one.</p>
                  <Button className="btn-primary" disabled={Boolean(busy)} onClick={() => void mediate()}><Bot size={14} aria-hidden="true" />{busy === "mediate" ? "Mediator is analysing" : "Request AI mediation"}</Button>
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => setProposeOpen(true)}>Propose a split</Button>
                </>
              )}
              {(countdown.expired || !live) && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void escalate()}><Gavel size={14} aria-hidden="true" />{live ? "Escalate to arbitrator" : "Send to arbitrator"}</Button>}
              {busy === "mediate" && <p className="claim-working">Two advocates argue each side, then a neutral mediator applies the policy. This takes about half a minute.</p>}
            </div>
          )}

          {claim.status === "arbitration_pending" && <div className="claim-actions"><strong>With the arbitrator</strong><p>{claim.escalationReason || "The arbitrator reviews the evidence package."} No action is needed.</p></div>}

          {claim.status === "settlement_pending" && claim.settlement && (
            <div className="claim-actions">
              <strong>Agreed split</strong>
              <dl className="fact-list">
                <div><dt>Back to buyer</dt><dd><strong>{money(claim.settlement.buyerValue)} {order.currency}</strong></dd></div>
                <div><dt>To supplier</dt><dd><strong>{money(claim.settlement.supplierValue)} {order.currency}</strong></dd></div>
              </dl>
              <p>Both parties sign the exact split on Sui, then either party executes it.</p>
              <Button className="btn-primary" disabled={Boolean(busy) || signed[mySide]} onClick={() => void approve()}>{signed[mySide] ? "Signed" : busy === "approve" ? "Signing" : `Sign as ${mySide}`}</Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void execute()}>{busy === "execute" ? "Executing" : "Execute settlement"}<ArrowRight size={14} aria-hidden="true" /></Button>
              {live && <small className="muted">Execution succeeds only after both signatures are on chain.</small>}
            </div>
          )}

          {claim.status === "settled" && claim.settlement && (
            <div className="claim-actions">
              <strong>Settled</strong>
              <dl className="fact-list">
                <div><dt>Back to buyer</dt><dd><strong>{money(claim.settlement.buyerValue)} {order.currency}</strong></dd></div>
                <div><dt>To supplier</dt><dd><strong>{money(claim.settlement.supplierValue)} {order.currency}</strong></dd></div>
                <div><dt>Sui transaction</dt><dd>{claim.settlement.transactionDigest && claim.settlement.executionStatus === "verified_on_chain" && live ? <a className="link" href={explorerTransactionUrl(claim.settlement.transactionDigest)} target="_blank" rel="noreferrer">View on Suiscan<ExternalLink size={12} aria-hidden="true" /></a> : "Sample record"}</dd></div>
              </dl>
            </div>
          )}

          {mySide === "supplier" && undisputedPaid > 0 && (
            <div className="claim-actions claim-actions-quiet">
              <strong>Accepted value</strong>
              <p>{money(undisputedPaid)} {order.currency} was paid to your wallet by the claim transaction itself. Only the disputed amount is still in escrow.</p>
            </div>
          )}
        </aside>)}
      </div>

      <ConsentDialog open={respondOpen !== null} onOpenChange={(value) => { if (!value) setRespondOpen(null); }} company={company}
        title={respondOpen === "accept" ? "Accept the claim" : "Dispute the claim"}
        description={respondOpen === "accept"
          ? `${money(claim.requestedValue)} ${order.currency} goes back to ${order.buyer} and the rest of the disputed amount is released to you once both parties sign.`
          : "Your statement and evidence are recorded on the claim and quoted by the AI mediator. Attach the dispatch note, carrier receipt or photos."}
        clauses={respondOpen === "accept"
          ? ["Accepting settles the claim at the buyer's requested amount.", "The settlement is executed on Sui once both parties sign it."]
          : ["Your statement and any attached evidence are genuine and unaltered.", "Evidence is shared with the buyer and, if the claim escalates, with the arbitrator.", "Negotiation follows the Dispute Resolution Policy rounds and deadline."]}
        confirmLabel={respondOpen === "accept" ? "Accept the claim" : "Submit response"} busy={busy === "respond"}
        onConfirm={() => respond(respondOpen === "accept")}>
        <label className="field"><span>{respondOpen === "accept" ? "Note to the buyer (optional)" : "Your statement"}</span>
          <textarea rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder={respondOpen === "accept" ? "We accept the claim and will refund the damaged cartons." : "Dispatch photos show every carton intact when the goods left our warehouse on 27 August."} />
        </label>
        {respondOpen === "dispute" && <FileField label="Attach evidence (optional)" hint="The file is read into text for the mediator. Only its fingerprint is kept with the order." accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onFile={setEvidenceFile} file={evidenceFile} />}
      </ConsentDialog>

      <ConsentDialog open={proposeOpen} onOpenChange={setProposeOpen} company={company} title="Propose a split of the disputed amount"
        description={`${money(claim.disputedValue)} ${order.currency} is in dispute. Choose how much goes back to ${order.buyer}; the rest is released to ${order.supplier}.`}
        clauses={["A proposal you make is binding on your company once the other party accepts it.", "Each proposal uses one negotiation round."]}
        confirmLabel="Send proposal" busy={busy === "propose"} onConfirm={propose}>
        <label className="field"><span>Back to buyer ({order.currency})</span><Input type="number" min={0} max={claim.disputedValue} step="0.01" value={buyerShare} onChange={(event) => setBuyerShare(Number(event.target.value))} /><small>To supplier: {money(Math.max(0, claim.disputedValue - Math.min(claim.disputedValue, buyerShare)))} {order.currency}</small></label>
        <label className="field"><span>Why this split (optional)</span><Input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Half of the damaged cartons were still saleable." /></label>
      </ConsentDialog>
    </section>
  );
}


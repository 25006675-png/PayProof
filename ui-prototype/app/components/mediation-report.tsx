"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { type AdvocateCase, type ClaimMediation, type DemoOrder, type MediatorCase, type QuotedClause, type QuotedEvidence, formatDateTime, formatOrderMoney as money } from "@/lib/demo-orders";

type Tab = "summary" | "buyer" | "supplier" | "mediator";

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h4><span>{number}</span>{title}</h4>
      {children}
    </section>
  );
}

function Quotes({ items, label }: { items: Array<QuotedClause | QuotedEvidence>; label: (item: QuotedClause | QuotedEvidence) => string }) {
  if (items.length === 0) return <p className="report-none">None quoted.</p>;
  return (
    <ul className="report-quotes">
      {items.map((item, index) => <li key={index}><strong>{label(item)}</strong><q>{item.quote}</q></li>)}
    </ul>
  );
}

function Bullets({ items, empty = "None recorded." }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p className="report-none">{empty}</p>;
  return <ul className="report-bullets">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}

function AdvocateReport({ advocate, order, side }: { advocate: AdvocateCase; order: DemoOrder; side: "buyer" | "supplier" }) {
  const name = side === "buyer" ? order.buyer : order.supplier;
  return (
    <div className="report">
      <p className="report-note"><Bot size={13} aria-hidden="true" /> An AI advocate argued this side from the submitted evidence and the policy. It is not a statement by {name}.</p>
      <Section number="1" title="Recommended split">
        <div className="report-split"><span><small>Back to buyer</small><strong>{money(advocate.buyerValue)} SUI</strong></span><span><small>To supplier</small><strong>{money(advocate.supplierValue)} SUI</strong></span></div>
      </Section>
      <Section number="2" title="Issues that decide the dispute"><Bullets items={advocate.issues} /></Section>
      <Section number="3" title="Evidence relied on"><Quotes items={advocate.evidenceBasis} label={(item) => (item as QuotedEvidence).evidenceId} /></Section>
      <Section number="4" title="Agreement terms applied"><Quotes items={advocate.contractBasis} label={(item) => (item as QuotedClause).clauseId} /></Section>
      <Section number="5" title="Policy clauses applied"><Quotes items={advocate.policyBasis} label={(item) => (item as QuotedClause).clauseId} /></Section>
      <Section number="6" title="Application"><p>{advocate.application}</p></Section>
      <Section number="7" title="Concessions"><Bullets items={advocate.concessions} empty="No weaknesses conceded." /></Section>
      {advocate.inferences.length > 0 && <Section number="8" title="AI inferences, not verified facts"><Bullets items={advocate.inferences} /></Section>}
      {advocate.unresolvedQuestions.length > 0 && <Section number="9" title="Open questions"><Bullets items={advocate.unresolvedQuestions} /></Section>}
    </div>
  );
}

function MediatorReport({ mediator }: { mediator: MediatorCase }) {
  let n = 0;
  const next = () => String(++n);
  return (
    <div className="report">
      <Section number={next()} title="Common ground"><Bullets items={mediator.commonGround} /></Section>
      <Section number={String(n + 1)} title="Findings">
        {mediator.findings.length === 0 ? <p className="report-none">No findings could be made.</p> : (
          <ol className="report-findings">
            {mediator.findings.map((finding, index) => (
              <li key={index}>
                <strong>{n + 1}.{index + 1} {finding.issue}</strong>
                <p>{finding.finding}</p>
                {finding.supportingEvidence.length > 0 && <ul className="report-quotes">{finding.supportingEvidence.map((item, quoteIndex) => <li key={quoteIndex}><strong>{item.evidenceId}</strong><q>{item.quote}</q></li>)}</ul>}
              </li>
            ))}
          </ol>
        )}
      </Section>
      {(() => { next(); return null; })()}
      <Section number={next()} title="Agreement terms applied"><Quotes items={mediator.contractBasis} label={(item) => (item as QuotedClause).clauseId} /></Section>
      <Section number={next()} title="Policy clauses applied"><Quotes items={mediator.policyBasis} label={(item) => (item as QuotedClause).clauseId} /></Section>
      {mediator.outcome === "proposal" ? (
        <>
          <Section number={next()} title="Reasoning and arithmetic"><p>{mediator.reasoning}</p></Section>
          <Section number={next()} title="Determination">
            <div className="report-split"><span><small>Back to buyer</small><strong>{money(mediator.buyerValue ?? 0)} SUI</strong></span><span><small>To supplier</small><strong>{money(mediator.supplierValue ?? 0)} SUI</strong></span>{mediator.evidenceSufficiency && <span><small>Evidence</small><strong className="capitalize">{mediator.evidenceSufficiency}</strong></span>}{mediator.legalRelevance && <span><small>Rule fit</small><strong className="capitalize">{mediator.legalRelevance}</strong></span>}</div>
          </Section>
        </>
      ) : (
        <Section number={next()} title="Why no proposal was made"><p>{mediator.reason}</p></Section>
      )}
      {mediator.inferences.length > 0 && <Section number={next()} title="AI inferences, not verified facts"><Bullets items={mediator.inferences} /></Section>}
      {mediator.unresolvedQuestions.length > 0 && <Section number={next()} title="Open questions"><Bullets items={mediator.unresolvedQuestions} /></Section>}
    </div>
  );
}

export function MediationReportView({ run, order }: { run: ClaimMediation; order: DemoOrder }) {
  const [tab, setTab] = useState<Tab>("summary");
  const report = run.report;
  if (!report) return null;
  const tabs: Array<{ id: Tab; label: string; available: boolean }> = [
    { id: "summary", label: "Summary", available: true },
    { id: "buyer", label: `${order.buyer}'s case`, available: Boolean(report.buyer) },
    { id: "supplier", label: `${order.supplier}'s case`, available: Boolean(report.supplier) },
    { id: "mediator", label: "Mediator's determination", available: Boolean(report.mediator) },
  ];
  return (
    <div className="mediation-report">
      <div className="report-tabs" role="tablist" aria-label="Mediation report">
        {tabs.filter((entry) => entry.available).map((entry) => (
          <button key={entry.id} role="tab" type="button" aria-selected={tab === entry.id} className={tab === entry.id ? "report-tab report-tab-active" : "report-tab"} onClick={() => setTab(entry.id)}>{entry.label}</button>
        ))}
      </div>
      {tab === "summary" && (
        <div className="report">
          <p className="report-note"><Bot size={13} aria-hidden="true" /> Mediation run on {formatDateTime(run.createdAt)}: {report.debateRounds} {report.debateRounds === 1 ? "round" : "rounds"} of advocate argument, {run.modelCalls} model calls, then a neutral determination. Non-binding until both parties accept.</p>
          <Section number="1" title="Outcome">
            {report.mediator?.outcome === "proposal"
              ? <div className="report-split"><span><small>Back to buyer</small><strong>{money(report.mediator.buyerValue ?? 0)} SUI</strong></span><span><small>To supplier</small><strong>{money(report.mediator.supplierValue ?? 0)} SUI</strong></span>{report.mediator.evidenceSufficiency && <span><small>Evidence</small><strong className="capitalize">{report.mediator.evidenceSufficiency}</strong></span>}</div>
              : <p>No proposal. {report.mediator?.reason ?? run.reason}</p>}
          </Section>
          {report.buyer && report.supplier && (
            <Section number="2" title="What each side argued">
              <div className="report-split"><span><small>{order.buyer}'s advocate</small><strong>{money(report.buyer.buyerValue)} SUI back to buyer</strong></span><span><small>{order.supplier}'s advocate</small><strong>{money(report.supplier.buyerValue)} SUI back to buyer</strong></span></div>
            </Section>
          )}
          {report.mediator && report.mediator.findings.length > 0 && (
            <Section number="3" title="Key findings"><Bullets items={report.mediator.findings.map((finding) => `${finding.issue}: ${finding.finding}`)} /></Section>
          )}
          {report.mediator && (report.mediator.contractBasis.length > 0 || report.mediator.policyBasis.length > 0) && (
            <Section number="4" title="Rules applied"><Bullets items={[...report.mediator.contractBasis, ...report.mediator.policyBasis].map((clause) => clause.clauseId)} /></Section>
          )}
          {(report.mediator?.unresolvedQuestions.length ?? 0) > 0 && <Section number="5" title="Open questions"><Bullets items={report.mediator!.unresolvedQuestions} /></Section>}
        </div>
      )}
      {tab === "buyer" && report.buyer && <AdvocateReport advocate={report.buyer} order={order} side="buyer" />}
      {tab === "supplier" && report.supplier && <AdvocateReport advocate={report.supplier} order={order} side="supplier" />}
      {tab === "mediator" && report.mediator && <MediatorReport mediator={report.mediator} />}
    </div>
  );
}

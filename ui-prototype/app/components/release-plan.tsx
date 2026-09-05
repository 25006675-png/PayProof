"use client";

import type { ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { type DemoOrder, formatOrderMoney as money } from "@/lib/demo-orders";

export type ReleaseStageKey = "deposit" | "dispatch" | "delivery";

/** What each tranche has actually paid out, and whether the rest is contested. */
export type ReleaseProgress = { deposit: number; dispatch: number; delivery: number; contested: boolean; settled: boolean };

const FUNDED = ["funded", "in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending", "settled"];
const DISPATCHED = ["in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending", "settled"];
const CONTESTED = ["dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending"];

/** Released amounts for a live order, or undefined while the plan is only agreed.
 *  Prefers the recorded payouts and falls back to the lifecycle for sample orders. */
export function releaseProgress(order: DemoOrder): ReleaseProgress | undefined {
  const plan = order.releasePlan;
  if (!plan || !FUNDED.includes(order.status)) return undefined;
  const contested = CONTESTED.includes(order.status);
  const settled = order.status === "settled";
  const records = order.raw?.releaseRecords;
  const planUnits = order.raw?.releasePlan;
  if (!records || !planUnits) {
    return { deposit: plan.depositValue, dispatch: DISPATCHED.includes(order.status) ? plan.dispatchValue : 0,
      delivery: settled ? plan.deliveryValue : 0, contested, settled };
  }
  const paid = (...stages: string[]) => records.filter((record) => stages.includes(record.stage)).reduce((sum, record) => sum + BigInt(record.amountUnits), 0n);
  // Records are in base units. Scale by the plan so no decimal conversion is needed here.
  const share = (units: bigint, ofUnits: string, ofValue: number) => (BigInt(ofUnits) > 0n ? (Number(units) / Number(BigInt(ofUnits))) * ofValue : 0);
  return {
    deposit: share(paid("deposit"), planUnits.depositUnits, plan.depositValue),
    dispatch: share(paid("dispatch"), planUnits.dispatchUnits, plan.dispatchValue),
    delivery: share(paid("undisputed", "delivery"), planUnits.deliveryUnits, plan.deliveryValue),
    contested, settled,
  };
}

type Segment = { key: string; tone: ReleaseStageKey; name: string; trigger: string; value: number; state: "planned" | "released" | "held" | "disputed" | "refunded" };

function segmentsOf(values: Record<ReleaseStageKey, number>, progress?: ReleaseProgress): Segment[] {
  const out: Segment[] = [];
  const early = [
    { key: "deposit" as const, name: "Order deposit", trigger: "When escrow is funded" },
    { key: "dispatch" as const, name: "Dispatch payment", trigger: "When dispatch evidence is signed" },
  ];
  for (const stage of early) {
    if (values[stage.key] <= 0) continue;
    const paid = (progress?.[stage.key] ?? 0) >= values[stage.key] - 0.0001;
    out.push({ ...stage, tone: stage.key, value: values[stage.key], state: !progress ? "planned" : paid ? "released" : "held" });
  }
  const releasedDelivery = Math.min(progress?.delivery ?? 0, values.delivery);
  const remaining = values.delivery - releasedDelivery;
  if (releasedDelivery > 0.0001) {
    out.push({ key: "delivery-paid", tone: "delivery", value: releasedDelivery, state: "released",
      name: remaining > 0.0001 ? "Delivery released" : "Delivery balance",
      trigger: progress?.contested ? "Undisputed value, paid when the claim opened" : "On acceptance or timeout" });
  }
  if (remaining > 0.0001) {
    out.push({ key: "delivery-held", tone: "delivery", value: remaining,
      state: !progress ? "planned" : progress.settled ? "refunded" : progress.contested ? "disputed" : "held",
      name: progress?.settled ? "Returned to buyer" : progress?.contested ? "In dispute" : "Delivery balance",
      trigger: progress?.settled ? "Refunded when the claim settled"
        : progress?.contested ? "Held until both parties approve a split" : "After acceptance or timeout" });
  }
  return out;
}

/** Proportional payment schedule. The zone labels answer the question a buyer actually has:
 * how much has left the escrow, and how much is still recoverable. */
export function ReleasePlanBar({ values, total, currency, progress, slider }: {
  values: Record<ReleaseStageKey, number>;
  total: number;
  currency: string;
  /** Omit while the plan is only agreed. Present on a funded order to mark what has been paid. */
  progress?: ReleaseProgress;
  slider?: ReactNode;
}) {
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const segments = segmentsOf(values, progress).map((segment) => ({ ...segment, percent: share(segment.value) }));
  const columns = segments.map((segment) => `minmax(0, ${segment.percent}fr)`).join(" ");
  const out = segments.filter((segment) => segment.state === "released").reduce((sum, segment) => sum + segment.value, 0);
  const kept = segments.filter((segment) => segment.state !== "released").reduce((sum, segment) => sum + segment.value, 0);
  const zones = progress
    ? [
        out > 0.0001 ? { key: "early", label: "Paid out", value: out } : undefined,
        kept > 0.0001 ? { key: "held", label: progress.settled ? "Returned to buyer" : progress.contested ? "In dispute" : "Still held in escrow", value: kept } : undefined,
      ]
    : [
        values.deposit + values.dispatch > 0 ? { key: "early", label: "Paid before you inspect", value: values.deposit + values.dispatch } : undefined,
        values.delivery > 0 ? { key: "held", label: "Protected until you accept", value: values.delivery } : undefined,
      ];
  const shown = zones.filter((zone) => zone !== undefined).map((zone) => ({ ...zone, percent: share(zone.value) }));

  return (
    <div className="release-plan">
      {/* While the plan is being chosen the zones sit over the segments they describe. Once money
          has moved they are a summary, so both figures stay readable however lopsided the split. */}
      <div className={progress ? "release-summary" : "release-row"}
        style={progress ? undefined : { gridTemplateColumns: shown.map((zone) => `minmax(0, ${zone.percent}fr)`).join(" ") }}>
        {shown.map((zone) => (
          <div key={zone.key} className={`release-zone release-zone-${zone.key}`}>
            <div className="release-zone-body">
              <span>{zone.key === "held" && !progress?.contested && !progress?.settled && <ShieldCheck size={13} aria-hidden="true" />}{zone.label}</span>
              <b>{money(zone.value)} {currency}</b>
            </div>
          </div>
        ))}
      </div>
      <div className="release-bar" style={{ gridTemplateColumns: columns }} role="list">
        {segments.map((segment) => (
          <div key={segment.key} role="listitem" className={`release-seg release-seg-${segment.tone} release-seg-${segment.state}`}
            aria-label={`${segment.name}, ${Math.round(segment.percent)} percent, ${money(segment.value)} ${currency}, ${segment.state === "released" ? "released to the supplier" : segment.state === "disputed" ? "in dispute" : segment.state === "refunded" ? "returned to the buyer" : "held in escrow"}. ${segment.trigger}.`}>
            <span className="release-seg-name" aria-hidden="true">{segment.name}</span>
            <span className="release-seg-share" aria-hidden="true">{Math.round(segment.percent)}%</span>
            <b className="release-seg-amount" aria-hidden="true">{money(segment.value)}</b>
            {progress && (
              <span className="release-seg-state" aria-hidden="true">
                {segment.state === "released" ? <><Check size={11} />Released</> : segment.state === "disputed" ? "In dispute" : segment.state === "refunded" ? "Refunded" : "In escrow"}
              </span>
            )}
          </div>
        ))}
        {slider}
      </div>
      <div className="release-row release-legend" aria-hidden="true" style={{ gridTemplateColumns: columns }}>
        {segments.map((segment) => (
          <div key={segment.key} className="release-leg">
            <strong>{segment.name}</strong>
            <small>{segment.trigger}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

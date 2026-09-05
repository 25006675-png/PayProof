"use client";

import type { ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { formatOrderMoney as money } from "@/lib/demo-orders";
import type { OrderStatus } from "@/lib/order-status";

export type ReleaseStageKey = "deposit" | "dispatch" | "delivery";

const STAGES: Array<{ key: ReleaseStageKey; name: string; trigger: string }> = [
  { key: "deposit", name: "Order deposit", trigger: "When escrow is funded" },
  { key: "dispatch", name: "Dispatch payment", trigger: "When dispatch evidence is signed" },
  { key: "delivery", name: "Delivery balance", trigger: "After acceptance or timeout" },
];

/** Lifecycle points at which each tranche has actually left the escrow. */
const FUNDED = ["funded", "in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending", "settled"];
const DISPATCHED = ["in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending", "settled"];

/** Which tranches are already paid out, or undefined while the order is still only a plan. */
export function releasedStages(status: OrderStatus): Record<ReleaseStageKey, boolean> | undefined {
  if (!FUNDED.includes(status)) return undefined;
  return { deposit: true, dispatch: DISPATCHED.includes(status), delivery: status === "settled" };
}

/** Proportional payment schedule. The zone labels answer the question a buyer actually has:
 * how much leaves before the goods can be checked, and how much stays recoverable. */
export function ReleasePlanBar({ values, total, currency, released, slider }: {
  values: Record<ReleaseStageKey, number>;
  total: number;
  currency: string;
  /** Omit while the plan is only agreed. Present on a funded order to mark paid tranches. */
  released?: Record<ReleaseStageKey, boolean>;
  slider?: ReactNode;
}) {
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const stages = STAGES.map((stage) => ({ ...stage, value: values[stage.key], percent: share(values[stage.key]) })).filter((stage) => stage.percent > 0);
  const columns = stages.map((stage) => `minmax(0, ${stage.percent}fr)`).join(" ");
  const early = values.deposit + values.dispatch;
  const zones = [
    early > 0 ? { key: "early", label: released ? "Paid before inspection" : "Paid before you inspect", value: early, percent: share(early) } : undefined,
    values.delivery > 0 ? { key: "held", label: released ? "Protected until acceptance" : "Protected until you accept", value: values.delivery, percent: share(values.delivery) } : undefined,
  ].filter((zone) => zone !== undefined);

  return (
    <div className="release-plan">
      <div className="release-row" style={{ gridTemplateColumns: zones.map((zone) => `minmax(0, ${zone.percent}fr)`).join(" ") }}>
        {zones.map((zone) => (
          <div key={zone.key} className={`release-zone release-zone-${zone.key}`}>
            <div className="release-zone-body">
              <span>{zone.key === "held" && <ShieldCheck size={13} aria-hidden="true" />}{zone.label}</span>
              <b>{money(zone.value)} {currency}</b>
            </div>
          </div>
        ))}
      </div>
      <div className="release-bar" style={{ gridTemplateColumns: columns }} role="list">
        {stages.map((stage) => {
          const paid = released?.[stage.key];
          const state = released ? (paid ? "released" : "holding") : "planned";
          return (
            <div key={stage.key} role="listitem" className={`release-seg release-seg-${stage.key} release-seg-${state}`}
              aria-label={`${stage.name}, ${Math.round(stage.percent)} percent, ${money(stage.value)} ${currency}${released ? (paid ? ", released" : ", still held in escrow") : ""}. ${stage.trigger}.`}>
              <span className="release-seg-name" aria-hidden="true">{stage.name}</span>
              <span className="release-seg-share" aria-hidden="true">{Math.round(stage.percent)}%</span>
              <b className="release-seg-amount" aria-hidden="true">{money(stage.value)}</b>
              {released && <span className="release-seg-state" aria-hidden="true">{paid ? <><Check size={11} />Released</> : "In escrow"}</span>}
            </div>
          );
        })}
        {slider}
      </div>
      <div className="release-row release-legend" aria-hidden="true" style={{ gridTemplateColumns: columns }}>
        {stages.map((stage) => (
          <div key={stage.key} className="release-leg">
            <strong>{stage.name}</strong>
            <small>{stage.trigger}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import type { OrderEvent } from "@/lib/demo-orders";
import { STATUS, STEPS, isDisputed, type OrderStatus } from "@/lib/order-status";

/**
 * Six-step progress bar. Completed steps draw in with a stagger on first paint;
 * after a status change only the newly completed steps animate.
 */
export function OrderStepper({ status }: { status: OrderStatus }) {
  const meta = STATUS[status];
  const disputed = isDisputed(status);
  const previous = useRef<number>(-1);
  const from = previous.current;
  useEffect(() => { previous.current = meta.step; }, [meta.step]);
  return (
    <ol className="stepper" aria-label="Order progress">
      {STEPS.map((step, index) => {
        const state = index < meta.step ? "done" : index === meta.step ? "current" : "todo";
        const flagged = disputed && index === 4;
        const fresh = index >= from && index <= meta.step;
        const order = Math.max(0, index - Math.max(from, 0));
        return (
          <li key={step} className={`stepper-step stepper-${state} ${flagged ? "stepper-flag" : ""}`} aria-current={state === "current" ? "step" : undefined}>
            <motion.span className="stepper-dot" aria-hidden="true"
              initial={fresh ? { scale: 0.5, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.32, delay: order * 0.14, ease: [0.22, 1, 0.36, 1] }}>
              {state === "done" ? <Check size={12} /> : index + 1}
            </motion.span>
            {index < STEPS.length - 1 && (
              <motion.span className={`stepper-line ${state === "done" ? "stepper-line-done" : ""}`} aria-hidden="true"
                initial={fresh && state === "done" ? { scaleX: 0 } : false}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.36, delay: order * 0.14 + 0.16, ease: [0.22, 1, 0.36, 1] }} />
            )}
            <span className="stepper-label">{step}{flagged && <small>Claim in progress</small>}{state === "current" && !flagged && <small>In progress</small>}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <ol className="timeline">
      {sorted.map((event, index) => (
        <li key={`${event.at}-${index}`}>
          <time dateTime={event.at}>{new Date(event.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          <div><strong>{event.label}</strong>{event.detail && <p>{event.detail}</p>}</div>
        </li>
      ))}
    </ol>
  );
}

export type OrderStatus =
  | "awaiting_supplier"
  | "awaiting_buyer"
  | "changes_requested"
  | "supplier_confirmed"
  | "funded"
  | "in_transit"
  | "delivered"
  | "dispute_open"
  | "negotiation_open"
  | "arbitration_pending"
  | "settlement_pending"
  | "settled"
  | "cancelled";

export type OrderRole = "BUYER" | "SUPPLIER";

export type StatusTone = "neutral" | "attention" | "progress" | "success" | "danger";

export const STEPS = ["Confirm", "Fund", "Ship", "Deliver", "Inspect", "Settle"] as const;

/** Version and effective date of the platform terms shown in agreement blocks. */
export const TERMS = {
  version: "1.0",
  effective: "2 September 2026",
  documents: [
    { title: "Terms of Service", href: "/legal/terms" },
    { title: "Dispute Resolution Policy", href: "/legal/dispute-policy" },
  ],
};

type StatusMeta = {
  label: string;
  tone: StatusTone;
  /** Index into STEPS that is currently in progress. 6 means every step is complete. */
  step: number;
  summary: string;
};

export const STATUS: Record<OrderStatus, StatusMeta> = {
  awaiting_supplier: { label: "Awaiting confirmation", tone: "attention", step: 0, summary: "The supplier has not confirmed the order terms yet." },
  awaiting_buyer: { label: "Awaiting confirmation", tone: "attention", step: 0, summary: "The buyer has not confirmed the order terms yet." },
  changes_requested: { label: "Changes requested", tone: "attention", step: 0, summary: "The other party asked for changes before confirming." },
  supplier_confirmed: { label: "Ready to fund", tone: "progress", step: 1, summary: "Both parties agreed the terms. The buyer funds escrow next." },
  funded: { label: "Funds secured", tone: "progress", step: 2, summary: "Payment is held in escrow. The supplier prepares the shipment." },
  in_transit: { label: "In transit", tone: "progress", step: 3, summary: "The goods have been dispatched and are on their way." },
  delivered: { label: "Inspection due", tone: "attention", step: 4, summary: "Goods were delivered. The buyer records what was received." },
  dispute_open: { label: "Claim opened", tone: "danger", step: 4, summary: "The buyer opened a claim for exceptions. The supplier responds next." },
  negotiation_open: { label: "In negotiation", tone: "danger", step: 4, summary: "Both parties are reviewing settlement proposals for the disputed amount." },
  arbitration_pending: { label: "With arbitrator", tone: "danger", step: 4, summary: "The disputed amount is with the arbitrator for a decision." },
  settlement_pending: { label: "Settlement ready", tone: "progress", step: 5, summary: "The agreed split is ready to be signed and executed on Sui." },
  settled: { label: "Settled", tone: "success", step: 6, summary: "Payment was released and the settlement record is final." },
  cancelled: { label: "Cancelled", tone: "neutral", step: 0, summary: "This order was cancelled before funding." },
};

export const STATUS_KEYS = Object.keys(STATUS) as OrderStatus[];

export type Phase = "confirm" | "fund" | "fulfil" | "claims" | "done";

export const PHASES: Array<{ id: Phase; label: string }> = [
  { id: "confirm", label: "To confirm" },
  { id: "fund", label: "To fund" },
  { id: "fulfil", label: "In fulfilment" },
  { id: "claims", label: "Claims" },
  { id: "done", label: "Completed" },
];

export function phaseOf(status: OrderStatus): Phase {
  switch (status) {
    case "awaiting_supplier": case "awaiting_buyer": case "changes_requested": return "confirm";
    case "supplier_confirmed": return "fund";
    case "funded": case "in_transit": case "delivered": return "fulfil";
    case "dispute_open": case "negotiation_open": case "arbitration_pending": case "settlement_pending": return "claims";
    default: return "done";
  }
}

export function statusLabel(status: string): string {
  return STATUS[status as OrderStatus]?.label ?? status;
}

export function statusTone(status: string): StatusTone {
  return STATUS[status as OrderStatus]?.tone ?? "neutral";
}

export function isDisputed(status: string): boolean {
  return ["dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending"].includes(status);
}

export type NextAction = {
  /** Who has to act now. */
  owner: "you" | "counterparty" | "none";
  title: string;
  detail: string;
};

/** What the signed-in party should do next for an order in this status. */
export function nextAction(status: OrderStatus, role: OrderRole, options: { invited?: boolean; claimOwner?: "buyer" | "supplier" | "both" | "none" } = {}): NextAction {
  const buyer = role === "BUYER";
  const invited = options.invited ?? true;
  switch (status) {
    case "awaiting_supplier":
      if (buyer) return { owner: "counterparty", title: "Waiting for supplier confirmation", detail: "You can resend or cancel the invitation while you wait." };
      return invited
        ? { owner: "you", title: "Review and confirm the order", detail: "Check every line and the delivery terms, then confirm or request changes." }
        : { owner: "counterparty", title: "Confirmation pending", detail: "The invited supplier account confirms this order." };
    case "awaiting_buyer":
      if (!buyer) return { owner: "counterparty", title: "Waiting for buyer confirmation", detail: "You can resend or cancel the invitation while you wait." };
      return invited
        ? { owner: "you", title: "Review and confirm the order", detail: "Check every line and the delivery terms, then confirm or request changes." }
        : { owner: "counterparty", title: "Confirmation pending", detail: "The invited buyer account confirms this order." };
    case "changes_requested":
      return buyer
        ? { owner: "you", title: "Revise the order", detail: "The supplier asked for changes. Update the terms and send a new confirmation." }
        : { owner: "counterparty", title: "Waiting for the buyer to revise", detail: "You asked for changes. The buyer updates the order next." };
    case "supplier_confirmed":
      return buyer
        ? { owner: "you", title: "Fund escrow", detail: "Move the order value into escrow on Sui. The supplier ships once funds are secured." }
        : { owner: "counterparty", title: "Waiting for buyer funding", detail: "Prepare stock. Dispatch only after funds are secured." };
    case "funded":
      return buyer
        ? { owner: "counterparty", title: "Waiting for dispatch", detail: "The supplier prepares and ships the goods." }
        : { owner: "you", title: "Ship the goods", detail: "Dispatch the order and record the carrier, tracking number and dispatch date." };
    case "in_transit":
      return buyer
        ? { owner: "you", title: "Confirm the goods arrived", detail: "Record delivery when the goods reach the delivery location." }
        : { owner: "counterparty", title: "Waiting for the buyer to record delivery", detail: "You can also record delivery once the carrier confirms handover." };
    case "delivered":
      return buyer
        ? { owner: "you", title: "Check the delivery", detail: "Confirm everything arrived intact, or record what was missing or damaged." }
        : { owner: "counterparty", title: "Waiting for inspection", detail: "The buyer checks the goods. Accepted value is released to you." };
    case "dispute_open":
      return buyer
        ? { owner: "counterparty", title: "Waiting for supplier response", detail: "The supplier reviews your claim and evidence." }
        : { owner: "you", title: "Respond to the claim", detail: "Accept the claim, or submit your evidence and open negotiation." };
    case "negotiation_open": {
      const owner = options.claimOwner === "none" ? "counterparty" : options.claimOwner === "both" || !options.claimOwner ? "you"
        : (options.claimOwner === "buyer") === buyer ? "you" : "counterparty";
      return owner === "you"
        ? { owner, title: "Review the latest proposal", detail: "Accept, counter, or ask the AI mediator for a proposal." }
        : { owner, title: "Waiting for the other party", detail: "They are reviewing the latest proposal." };
    }
    case "arbitration_pending":
      return { owner: "none", title: "Awaiting arbitrator decision", detail: "No action is needed until the arbitrator decides." };
    case "settlement_pending":
      return { owner: "you", title: "Sign the settlement", detail: "Both parties sign the agreed split on Sui, then it is executed." };
    case "settled":
      return { owner: "none", title: "Settlement complete", detail: "View the settlement record and the Sui transaction." };
    case "cancelled":
      return { owner: "none", title: "No action", detail: "This order is closed." };
  }
}

/** The next status a demo control can move an order to. */
export function demoNextStatus(status: OrderStatus): OrderStatus | null {
  switch (status) {
    case "awaiting_supplier": case "awaiting_buyer": return "supplier_confirmed";
    case "changes_requested": return "awaiting_supplier";
    case "supplier_confirmed": return "funded";
    case "funded": return "in_transit";
    case "in_transit": return "delivered";
    case "delivered": return "settled";
    case "dispute_open": return "negotiation_open";
    case "negotiation_open": return "settlement_pending";
    case "arbitration_pending": return "settlement_pending";
    case "settlement_pending": return "settled";
    default: return null;
  }
}

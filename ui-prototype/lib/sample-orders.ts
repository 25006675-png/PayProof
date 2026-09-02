"use client";

import { type ClaimProposal, type ClaimView, type DemoOrder, type DemoOrderLine, type InspectionLine, type MediationReport, type OrderDocument, type OrderShipment, itemSummary } from "@/lib/demo-orders";
import { STATUS, TERMS, demoNextStatus, type OrderStatus } from "@/lib/order-status";

const VERSION = 5;
const HIDE_KEY = "payproof_samples_hidden";

const line = (id: string, description: string, quantity: number, unitPrice: number, unit: string): DemoOrderLine => ({ id, description, quantity, unitPrice, unit });

type Seed = {
  reference: string;
  role: "BUYER" | "SUPPLIER";
  initiatorRole?: "buyer" | "supplier";
  counterparty: string;
  items: DemoOrderLine[];
  status: OrderStatus;
  delivery: string;
  deliveryLocation: string;
  daysAgo: number;
  invited?: boolean;
  carrier?: string;
};

const seeds: Seed[] = [
  { reference: "PO-2481", role: "BUYER", counterparty: "FreshSource Foods", status: "awaiting_supplier", delivery: "2026-09-18", deliveryLocation: "Central warehouse, Shah Alam", daysAgo: 0,
    items: [line("1", "Sunflower cooking oil 20L", 36, 280, "drums"), line("2", "Canola cooking oil 20L", 28, 270, "drums")] },
  { reference: "PO-2480", role: "SUPPLIER", counterparty: "Sunrise Mart", status: "awaiting_supplier", invited: true, delivery: "2026-09-15", deliveryLocation: "Sunrise Mart distribution centre, Klang", daysAgo: 1,
    items: [line("1", "Rice flour 10kg", 40, 185, "bags"), line("2", "Coconut milk 1L", 100, 71, "cartons"), line("3", "Palm olein 20L", 20, 301, "drums")] },
  { reference: "PO-2479", role: "SUPPLIER", initiatorRole: "supplier", counterparty: "Harvest Table", status: "awaiting_buyer", delivery: "2026-09-16", deliveryLocation: "Harvest Table central kitchen", daysAgo: 1,
    items: [line("1", "Extra virgin olive oil 5L", 40, 95, "tins")] },
  { reference: "PO-2478", role: "BUYER", counterparty: "Metro Ingredients", status: "supplier_confirmed", delivery: "2026-09-12", deliveryLocation: "Receiving dock 2, Shah Alam", daysAgo: 2,
    items: [line("1", "Dry ingredients assortment", 100, 220, "cartons")] },
  { reference: "PO-2476", role: "SUPPLIER", counterparty: "Kita Grocer", status: "funded", delivery: "2026-09-08", deliveryLocation: "Kita Grocer DC, Puchong", daysAgo: 3,
    items: [line("1", "Vitamin C 1000mg", 80, 45, "boxes"), line("2", "Zinc tablets 50mg", 120, 32, "boxes")] },
  { reference: "PO-2474", role: "BUYER", counterparty: "Apex Packaging", status: "in_transit", delivery: "2026-09-03", deliveryLocation: "Central warehouse, Shah Alam", daysAgo: 5, carrier: "DHL Express",
    items: [line("1", "Food-grade pouches", 2000, 7.2, "pieces"), line("2", "Printed cartons", 400, 10, "pieces")] },
  { reference: "PO-2471", role: "BUYER", counterparty: "FreshSource Foods", status: "delivered", delivery: "2026-08-29", deliveryLocation: "Receiving dock 1, Shah Alam", daysAgo: 7, carrier: "City-Link Express",
    items: [line("1", "Cooking oil 5L", 100, 300, "cartons")] },
  { reference: "PO-2469", role: "SUPPLIER", counterparty: "Bowl & Co.", status: "dispute_open", delivery: "2026-08-26", deliveryLocation: "Bowl & Co. kitchen, Bangsar", daysAgo: 9, carrier: "GDEX",
    items: [line("1", "Cooking supplies assortment", 100, 98, "units")] },
  { reference: "PO-2466", role: "BUYER", counterparty: "Nordic Cold Chain", status: "negotiation_open", delivery: "2026-08-22", deliveryLocation: "Cold room, Shah Alam", daysAgo: 12, carrier: "Nordic Cold Chain fleet",
    items: [line("1", "Frozen berries 1kg", 300, 18, "packs")] },
  { reference: "PO-2463", role: "SUPPLIER", counterparty: "Harvest Table", status: "settlement_pending", delivery: "2026-08-20", deliveryLocation: "Harvest Table central kitchen", daysAgo: 14, carrier: "Pos Laju",
    items: [line("1", "Olive oil 5L", 60, 95, "tins")] },
  { reference: "PO-2454", role: "BUYER", counterparty: "Metro Ingredients", status: "settled", delivery: "2026-08-14", deliveryLocation: "Receiving dock 2, Shah Alam", daysAgo: 20, carrier: "J&T Express",
    items: [line("1", "Flour 25kg", 200, 62, "bags")] },
];

function daysAgoIso(days: number, hourOffset = 9): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hourOffset, 0, 0, 0);
  return date.toISOString();
}


function sampleReport(order: DemoOrder, disputed: number, buyerValue: number, supplierValue: number, rejected: number, unit: string): MediationReport {
  const buyerAsk = disputed;
  return {
    debateRounds: 2,
    legalContext: [],
    evidenceIndex: [{ id: "BUYER-STATEMENT-1", side: "buyer", kind: "statement" }, { id: "BUYER-DOC-1", side: "buyer", kind: "document_transcript" }, { id: "SUPPLIER-STATEMENT-1", side: "supplier", kind: "statement" }],
    buyer: {
      side: "buyer", buyerValue: buyerAsk, supplierValue: 0,
      issues: ["Whether the damage existed at handover", "Whether damaged quantity is refundable under the policy"],
      evidenceBasis: [{ evidenceId: "BUYER-DOC-1", quote: `${rejected} ${unit} crushed and leaking at handover, noted by driver` }],
      contractBasis: [{ clauseId: "AGREEMENT-2", quote: "Buyer records accepted, missing, and damaged quantities within the inspection window." }],
      policyBasis: [{ clauseId: "DP-7.3", quote: "Where goods arrive damaged and the damage is evidenced within the inspection window in DP-2.1, the damaged quantity is treated as not delivered, and is refundable at the unit price for that line." }],
      application: `The signed delivery order records ${rejected} damaged ${unit} at handover. Under DP-7.3 the damaged quantity is treated as not delivered, so the full disputed amount of ${buyerAsk.toLocaleString("en-US")} SUI is refundable.`,
      concessions: ["The dispatch note shows the goods left the supplier intact, so the damage occurred in carriage rather than in production."],
      inferences: ["The carrier most likely caused the damage during transit."],
      unresolvedQuestions: ["Does the carrier contract assign transit risk to the supplier?"],
    },
    supplier: {
      side: "supplier", buyerValue: 0, supplierValue: disputed,
      issues: ["Whether risk had passed to the buyer before the damage", "Whether the buyer's photos are contemporaneous"],
      evidenceBasis: [{ evidenceId: "SUPPLIER-STATEMENT-1", quote: "Dispatch photos show every carton intact when the goods left our warehouse. The carrier signed for them undamaged." }],
      contractBasis: [{ clauseId: "AGREEMENT-3", quote: "Only accepted quantity is releasable; disputed quantity remains held." }],
      policyBasis: [{ clauseId: "DP-7.6", quote: "Where both sides present evidence of comparable weight on a point, no finding is made on that point, and it does not support a remedy either way." }],
      application: "The goods were intact at dispatch and signed for by the carrier. The buyer has not shown the damage occurred before handover, so no refund is due.",
      concessions: ["The delivery order was signed by the driver and records the damage at the dock."],
      inferences: [],
      unresolvedQuestions: ["Were the receiving photos taken before unloading?"],
    },
    mediator: {
      outcome: "proposal", buyerValue, supplierValue,
      commonGround: [`Both sides agree ${rejected} ${unit} were rejected at inspection.`, "Both sides agree the goods were intact when they left the supplier."],
      findings: [
        { issue: "Condition of goods at handover", finding: "The signed delivery order records the damage at handover, which the supplier does not contradict.", supportingEvidence: [{ evidenceId: "BUYER-DOC-1", quote: `${rejected} ${unit} crushed and leaking at handover, noted by driver` }] },
        { issue: "Who bore the risk in carriage", finding: "The agreement does not allocate transit risk. Part of the loss therefore sits with carriage rather than with either party's fault.", supportingEvidence: [] },
      ],
      contractBasis: [{ clauseId: "AGREEMENT-2", quote: "Buyer records accepted, missing, and damaged quantities within the inspection window." }],
      policyBasis: [{ clauseId: "DP-7.3", quote: "Where goods arrive damaged and the damage is evidenced within the inspection window in DP-2.1, the damaged quantity is treated as not delivered, and is refundable at the unit price for that line." }, { clauseId: "DP-7.6", quote: "Where both sides present evidence of comparable weight on a point, no finding is made on that point, and it does not support a remedy either way." }],
      reasoning: `DP-7.3 makes the evidenced damaged quantity refundable. The unallocated transit risk under DP-7.6 reduces the refund to 60 percent of the disputed ${disputed.toLocaleString("en-US")} SUI: ${buyerValue.toLocaleString("en-US")} SUI back to the buyer and ${supplierValue.toLocaleString("en-US")} SUI released to the supplier. Sample mediation, not produced by the live model.`,
      inferences: ["The damage most likely occurred during carriage."],
      evidenceSufficiency: "moderate", legalRelevance: "direct",
      unresolvedQuestions: ["Did the carrier's proof of delivery record the damage?"],
    },
  };
}

function sampleClaim(order: DemoOrder, status: ClaimView["status"], daysAgo: number): ClaimView {
  const first = order.items[0];
  const rejected = Math.max(1, Math.round(first.quantity * 0.13));
  const disputed = rejected * first.unitPrice;
  const buyerName = order.buyer;
  const supplierName = order.supplier;
  const evidence: ClaimView["evidence"] = [
    { id: "ev-buyer", side: "buyer", statement: `${rejected} ${first.unit} of ${first.description} arrived crushed and leaking. The signed delivery order notes the damage at handover and receiving photos are attached.`, files: 2, submittedAt: daysAgoIso(daysAgo, 9) },
  ];
  const proposals: ClaimProposal[] = [];
  const mediations: ClaimView["mediations"] = [];
  if (status !== "supplier_review") {
    evidence.push({ id: "ev-supplier", side: "supplier", statement: "Dispatch photos show every carton intact when the goods left our warehouse. The carrier signed for them undamaged.", files: 1, submittedAt: daysAgoIso(daysAgo - 1, 11) });
  }
  if (status === "negotiation_open" || status === "settlement_pending") {
    const aiBuyer = Math.round(disputed * 0.6 * 100) / 100;
    proposals.push({
      id: "prop-ai-1", source: "ai", round: 1, buyerValue: aiBuyer, supplierValue: disputed - aiBuyer,
      summary: `Refund ${aiBuyer.toLocaleString("en-US")} SUI to the buyer; release ${(disputed - aiBuyer).toLocaleString("en-US")} SUI to the supplier.`,
      reasoning: `Common ground: both sides agree ${rejected} ${first.unit} were rejected at inspection. Findings: the signed delivery order records damage at handover, which under DP-7.3 treats the damaged quantity as not delivered; the supplier's dispatch photos show the goods intact before carriage, so part of the loss falls on carriage risk shared under the agreement. Policy clauses applied: DP-7.3, DP-7.6.`,
      status: status === "settlement_pending" ? "accepted" : "open", acceptances: status === "settlement_pending" ? ["buyer", "supplier"] : [],
      citations: [{ title: "Dispute Resolution Policy", locator: "DP-7.3", excerpt: "Where goods arrive damaged and the damage is evidenced within the inspection window, the damaged quantity is treated as not delivered, and is refundable at the unit price for that line." }],
      unresolvedIssues: ["Open question: did the carrier's proof of delivery record the damage?"], evidenceSufficiency: "moderate", createdAt: daysAgoIso(daysAgo - 2, 10),
    });
    mediations.push({ id: "run-1", createdAt: daysAgoIso(daysAgo - 2, 10), outcome: "proposal", unresolved: ["Did the carrier's proof of delivery record the damage?"], modelCalls: 5, proposalId: "prop-ai-1", report: sampleReport(order, disputed, aiBuyer, disputed - aiBuyer, rejected, first.unit) });
  }
  return {
    id: `sample-claim-${order.reference.toLowerCase()}`, status,
    totalValue: order.value, disputedValue: disputed, requestedValue: disputed, undisputedReleased: status !== "supplier_review",
    claim: `${rejected} ${first.unit} of ${first.description} were damaged on arrival and cannot be sold.`,
    deadline: daysAgoIso(-2, 18), round: proposals.length ? 1 : 0, maxRounds: 3,
    evidence, proposals, mediations,
    settlement: status === "settlement_pending" ? { buyerValue: proposals[0].buyerValue, supplierValue: proposals[0].supplierValue, executionStatus: "pending_on_chain", proposalId: "prop-ai-1", agreementId: "sample-agreement" } : undefined,
    onchain: { escrowObjectId: "0xsample" },
  };
}

function buildSample(seed: Seed, you: string): DemoOrder {
  const value = seed.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const buyer = seed.role === "BUYER" ? you : seed.counterparty;
  const supplier = seed.role === "SUPPLIER" ? you : seed.counterparty;
  const initiatorRole = seed.initiatorRole ?? "buyer";
  const step = STATUS[seed.status].step;
  const events = [{ at: daysAgoIso(seed.daysAgo), label: "Order created", detail: `${initiatorRole === "buyer" ? buyer : supplier} issued the purchase order${initiatorRole === "supplier" ? " as supplier" : ""}.` }];
  const confirmer = initiatorRole === "buyer" ? supplier : buyer;
  if (step >= 1) events.push({ at: daysAgoIso(seed.daysAgo, 11), label: "Order confirmed", detail: `Confirmed by ${confirmer}, order version 1, terms version ${TERMS.version}.` });
  if (step >= 2) events.push({ at: daysAgoIso(seed.daysAgo, 14), label: "Escrow funded", detail: `${buyer} secured ${value.toLocaleString("en-US")} SUI in escrow.` });
  if (step >= 3) events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 1, 0), 10), label: "Shipped", detail: `${supplier} dispatched the goods${seed.carrier ? ` with ${seed.carrier}` : ""}.` });
  if (step >= 4) events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 2, 0), 15), label: "Delivered", detail: "Delivery was recorded at the agreed location." });

  const order: DemoOrder = {
    id: `sample-${seed.reference.toLowerCase()}`,
    reference: seed.reference,
    role: seed.role,
    initiatorRole,
    counterparty: seed.counterparty,
    buyer,
    supplier,
    item: itemSummary(seed.items),
    items: seed.items,
    status: seed.status,
    value,
    delivery: seed.delivery,
    deliveryLocation: seed.deliveryLocation,
    settlementAsset: "Testnet SUI",
    invited: seed.invited,
    inviteToken: (seed.status === "awaiting_supplier" && seed.role === "BUYER") || (seed.status === "awaiting_buyer" && seed.role === "SUPPLIER") ? `sample-${seed.reference.toLowerCase()}-invite` : undefined,
    inviteExpiresAt: seed.status === "awaiting_supplier" || seed.status === "awaiting_buyer" ? daysAgoIso(-6) : undefined,
    version: Math.max(1, step + 1),
    source: "sample",
    documents: [],
    events,
  };
  if (step >= 1) order.confirmation = { confirmedBy: "sample", confirmedRole: initiatorRole === "buyer" ? "supplier" : "buyer", organizationName: confirmer, orderVersion: 0, termsVersion: TERMS.version, confirmedAt: daysAgoIso(seed.daysAgo, 11) };
  if (step >= 3 && seed.carrier) order.shipment = { carrier: seed.carrier, trackingNumber: `${seed.carrier.split(" ")[0].toUpperCase().slice(0, 3)}${String(seed.daysAgo).padStart(2, "0")}48213MY`, dispatchedAt: daysAgoIso(Math.max(seed.daysAgo - 1, 0), 10), expectedAt: seed.delivery };
  if (step >= 4) order.deliveryRecord = { recordedAt: daysAgoIso(Math.max(seed.daysAgo - 2, 0), 15), recordedBy: "BUYER", reference: `DO-${seed.reference.slice(3)}` };
  if (["dispute_open", "negotiation_open"].includes(seed.status)) {
    const first = seed.items[0];
    const rejected = Math.max(1, Math.round(first.quantity * 0.13));
    order.inspection = {
      lines: [{ lineId: first.id, accepted: first.quantity - rejected, missing: 0, damaged: rejected }, ...seed.items.slice(1).map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 }))],
      note: `${rejected} ${first.unit} arrived damaged and cannot be sold.`,
      recordedAt: daysAgoIso(Math.max(seed.daysAgo - 3, 0), 9),
      acceptedValue: value - rejected * first.unitPrice,
      heldValue: rejected * first.unitPrice,
    };
    order.claim = sampleClaim(order, seed.status === "dispute_open" ? "supplier_review" : "negotiation_open", Math.max(seed.daysAgo - 3, 1));
    order.disputeId = order.claim.id;
    events.push({ at: order.inspection.recordedAt, label: "Claim opened", detail: `${buyer} reported ${rejected} damaged ${first.unit}. ${order.inspection.heldValue.toLocaleString("en-US")} SUI held.` });
    if (seed.status === "negotiation_open") {
      events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 4, 0), 11), label: "Supplier responded", detail: `${supplier} disputed the claim and submitted dispatch evidence.` });
      events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 5, 0), 10), label: "AI mediation proposal", detail: "The mediator proposed a split for both parties to review." });
    }
  }
  if (seed.status === "settlement_pending") {
    const first = seed.items[0];
    const rejected = Math.max(1, Math.round(first.quantity * 0.13));
    order.inspection = { lines: [{ lineId: first.id, accepted: first.quantity - rejected, missing: 0, damaged: rejected }], note: `${rejected} ${first.unit} arrived damaged.`, recordedAt: daysAgoIso(Math.max(seed.daysAgo - 3, 0), 16), acceptedValue: value - rejected * first.unitPrice, heldValue: rejected * first.unitPrice };
    order.claim = sampleClaim(order, "settlement_pending", Math.max(seed.daysAgo - 3, 1));
    order.disputeId = order.claim.id;
    events.push({ at: order.inspection.recordedAt, label: "Claim opened", detail: `${buyer} reported ${rejected} damaged ${first.unit}.` });
    events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 5, 0), 10), label: "Settlement agreed", detail: "Both parties accepted the mediation proposal." });
  }
  if (seed.status === "settled") {
    order.inspection = { lines: seed.items.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 })), note: "", recordedAt: daysAgoIso(Math.max(seed.daysAgo - 3, 0), 16), acceptedValue: value, heldValue: 0 };
    order.settlement = { buyerValue: 0, supplierValue: value, transactionDigest: "sample-settlement-not-on-chain", verifiedOnChain: false, source: "full_acceptance" };
    events.push({ at: daysAgoIso(Math.max(seed.daysAgo - 3, 0), 16), label: "Delivery accepted", detail: "All quantities accepted. The whole escrow was released to the supplier." });
  }
  return order;
}

function storageKey(accountKey: string): string {
  return `payproof_sample_orders_v${VERSION}:${accountKey}`;
}

export function loadSampleOrders(accountKey: string, you: string): DemoOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(accountKey));
    if (raw) return JSON.parse(raw) as DemoOrder[];
  } catch { /* fall through to a fresh set */ }
  const fresh = seeds.map((seed) => buildSample(seed, you));
  saveSampleOrders(accountKey, fresh);
  return fresh;
}

export function saveSampleOrders(accountKey: string, orders: DemoOrder[]): void {
  localStorage.setItem(storageKey(accountKey), JSON.stringify(orders));
}

export function resetSampleOrders(accountKey: string, you: string): DemoOrder[] {
  const fresh = seeds.map((seed) => buildSample(seed, you));
  saveSampleOrders(accountKey, fresh);
  return fresh;
}

export function samplesHidden(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
}

export function setSamplesHidden(hidden: boolean): void {
  localStorage.setItem(HIDE_KEY, hidden ? "1" : "0");
}

export function updateSampleOrder(accountKey: string, you: string, id: string, update: (order: DemoOrder) => DemoOrder): DemoOrder | null {
  const orders = loadSampleOrders(accountKey, you);
  let updated: DemoOrder | null = null;
  const next = orders.map((order) => {
    if (order.id !== id) return order;
    updated = update(order);
    return updated;
  });
  saveSampleOrders(accountKey, next);
  return updated;
}

const eventLabels: Partial<Record<OrderStatus, string>> = {
  supplier_confirmed: "Order confirmed", funded: "Escrow funded", in_transit: "Shipped", delivered: "Delivered",
  dispute_open: "Claim opened", negotiation_open: "Negotiation started", arbitration_pending: "Sent to arbitrator",
  settlement_pending: "Settlement agreed", settled: "Settled", changes_requested: "Changes requested", awaiting_supplier: "Sent for confirmation", awaiting_buyer: "Sent for confirmation",
};

export function withStatus(order: DemoOrder, status: OrderStatus, detail?: string): DemoOrder {
  return {
    ...order,
    status,
    version: order.version + 1,
    events: [...order.events, { at: new Date().toISOString(), label: eventLabels[status] ?? STATUS[status].label, detail }],
  };
}

export function confirmSample(order: DemoOrder, company: string): DemoOrder {
  const role = order.initiatorRole === "buyer" ? "supplier" : "buyer";
  const next = withStatus(order, "supplier_confirmed", `Confirmed by ${company}, order version ${order.version}, terms version ${TERMS.version}.`);
  next.confirmation = { confirmedBy: "you", confirmedRole: role, organizationName: company, orderVersion: order.version, termsVersion: TERMS.version, confirmedAt: new Date().toISOString() };
  return next;
}

export function shipSample(order: DemoOrder, shipment: OrderShipment): DemoOrder {
  const next = withStatus(order, "in_transit", `${order.supplier} dispatched the goods with ${shipment.carrier}, tracking ${shipment.trackingNumber}.`);
  next.shipment = shipment;
  return next;
}

export function deliverSample(order: DemoOrder, by: "BUYER" | "SUPPLIER", reference?: string): DemoOrder {
  const next = withStatus(order, "delivered", reference ? `Delivery recorded, reference ${reference}.` : "Delivery recorded.");
  next.deliveryRecord = { recordedAt: new Date().toISOString(), recordedBy: by, reference };
  return next;
}

export function advanceSample(order: DemoOrder): DemoOrder | null {
  const next = demoNextStatus(order.status);
  if (!next) return null;
  if (next === "supplier_confirmed") return confirmSample(order, order.initiatorRole === "buyer" ? order.supplier : order.buyer);
  if (next === "in_transit") return shipSample(order, { carrier: "DHL Express", trackingNumber: `DHL${Date.now().toString().slice(-8)}MY`, dispatchedAt: new Date().toISOString(), expectedAt: order.delivery });
  if (next === "delivered") return deliverSample(order, "BUYER", `DO-${order.reference.slice(3)}`);
  if (next === "settled" && order.status === "delivered") return recordSampleInspection(order, order.items.map((item) => ({ lineId: item.id, accepted: item.quantity, missing: 0, damaged: 0 })), "");
  if (next === "negotiation_open" && order.claim) return respondSample(order, false, "Dispatch photos show every carton intact when the goods left our warehouse.");
  if (next === "settlement_pending" && order.claim) return agreeSample(order, order.role === "BUYER" ? "buyer" : "supplier");
  if (next === "settled" && order.status === "settlement_pending") return executeSampleSettlement(order);
  return withStatus(order, next, "Moved forward with the demo control.");
}

export function recordSampleInspection(order: DemoOrder, lines: InspectionLine[], note: string, evidenceFiles = 0): DemoOrder {
  const acceptedValue = lines.reduce((sum, entry) => {
    const item = order.items.find((candidate) => candidate.id === entry.lineId);
    return sum + (item ? entry.accepted * item.unitPrice : 0);
  }, 0);
  const heldValue = Math.max(0, order.value - acceptedValue);
  const fullyAccepted = heldValue === 0;
  const inspected: DemoOrder = { ...order, inspection: { lines, note, recordedAt: new Date().toISOString(), acceptedValue, heldValue } };
  if (fullyAccepted) {
    const next = withStatus(inspected, "settled", "Delivery accepted in full. The whole escrow was released to the supplier.");
    next.settlement = { buyerValue: 0, supplierValue: acceptedValue, transactionDigest: "sample-settlement-not-on-chain", verifiedOnChain: false, source: "full_acceptance" };
    return next;
  }
  const next = withStatus(inspected, "dispute_open", `${heldValue.toLocaleString("en-US")} SUI held for the claim. Accepted value released to the supplier.`);
  next.claim = {
    id: `sample-claim-${order.reference.toLowerCase()}`, status: "supplier_review",
    totalValue: order.value, disputedValue: heldValue, requestedValue: heldValue, undisputedReleased: true,
    claim: note, deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), round: 0, maxRounds: 3,
    evidence: [{ id: "ev-buyer", side: "buyer", statement: note, files: evidenceFiles, submittedAt: new Date().toISOString() }],
    proposals: [], mediations: [], onchain: { escrowObjectId: "0xsample" },
  };
  next.disputeId = next.claim.id;
  return next;
}

function withClaim(order: DemoOrder, claim: ClaimView, status: OrderStatus, label: string, detail?: string): DemoOrder {
  return { ...order, claim, status, version: order.version + 1, events: [...order.events, { at: new Date().toISOString(), label, detail }] };
}

export function respondSample(order: DemoOrder, agrees: boolean, statement: string, files = 0): DemoOrder {
  const claim = order.claim!;
  const evidence = [...claim.evidence, { id: `ev-supplier-${Date.now()}`, side: "supplier" as const, statement, files, submittedAt: new Date().toISOString() }];
  if (agrees) {
    const settled: ClaimView = { ...claim, status: "settlement_pending", evidence, settlement: { buyerValue: claim.requestedValue, supplierValue: claim.disputedValue - claim.requestedValue, executionStatus: "pending_on_chain", agreementId: "sample-agreement" } };
    return withClaim(order, settled, "settlement_pending", "Supplier accepted the claim", `${order.supplier} agreed to refund ${claim.requestedValue.toLocaleString("en-US")} SUI.`);
  }
  return withClaim(order, { ...claim, status: "negotiation_open", evidence }, "negotiation_open", "Supplier responded", `${order.supplier} disputed the claim and submitted evidence.`);
}

export function proposeSample(order: DemoOrder, side: "buyer" | "supplier", buyerValue: number, supplierValue: number, summary: string): DemoOrder {
  const claim = order.claim!;
  const proposals = claim.proposals.map((proposal) => proposal.status === "open" ? { ...proposal, status: "superseded" as const } : proposal);
  const round = claim.round + 1;
  proposals.push({ id: `prop-${side}-${Date.now()}`, source: "human", side, round, buyerValue, supplierValue, summary, reasoning: "Proposal made by a party during negotiation.", status: "open", acceptances: [side], citations: [], unresolvedIssues: [], createdAt: new Date().toISOString() });
  if (round > claim.maxRounds) {
    return withClaim(order, { ...claim, proposals, round, status: "arbitration_pending", escalationReason: "Negotiation rounds exhausted" }, "arbitration_pending", "Sent to arbitrator", "The negotiation rounds were used up. The arbitrator decides next.");
  }
  return withClaim(order, { ...claim, proposals, round }, "negotiation_open", `${side === "buyer" ? "Buyer" : "Supplier"} proposed a split`, summary);
}

export function agreeSample(order: DemoOrder, side: "buyer" | "supplier"): DemoOrder {
  const claim = order.claim!;
  const open = claim.proposals.find((proposal) => proposal.status === "open");
  if (!open) return order;
  const acceptances = Array.from(new Set([...open.acceptances, side]));
  const accepted = acceptances.includes("buyer") && acceptances.includes("supplier");
  const proposals = claim.proposals.map((proposal) => proposal.id === open.id ? { ...proposal, acceptances, status: accepted ? "accepted" as const : proposal.status } : proposal);
  if (!accepted) return withClaim(order, { ...claim, proposals }, "negotiation_open", `${side === "buyer" ? "Buyer" : "Supplier"} accepted the proposal`, "Waiting for the other party to accept the same split.");
  const settled: ClaimView = { ...claim, proposals, status: "settlement_pending", settlement: { buyerValue: open.buyerValue, supplierValue: open.supplierValue, executionStatus: "pending_on_chain", proposalId: open.id, agreementId: "sample-agreement" } };
  return withClaim(order, settled, "settlement_pending", "Settlement agreed", `Both parties accepted: ${open.summary}`);
}

export function rejectSample(order: DemoOrder, side: "buyer" | "supplier"): DemoOrder {
  const claim = order.claim!;
  const open = claim.proposals.find((proposal) => proposal.status === "open");
  if (!open) return order;
  const proposals = claim.proposals.map((proposal) => proposal.id === open.id ? { ...proposal, status: "rejected" as const } : proposal);
  const exhausted = claim.round >= claim.maxRounds;
  if (exhausted) return withClaim(order, { ...claim, proposals, status: "arbitration_pending", escalationReason: "Negotiation rounds exhausted" }, "arbitration_pending", "Sent to arbitrator", "No agreement was reached in the allowed rounds.");
  return withClaim(order, { ...claim, proposals }, "negotiation_open", `${side === "buyer" ? "Buyer" : "Supplier"} rejected the proposal`, "The next round is open.");
}

/** Simulated mediation for sample orders. Live orders call the backend. */
export function mediateSample(order: DemoOrder): DemoOrder {
  const claim = order.claim!;
  const buyerValue = Math.round(claim.disputedValue * 0.6 * 100) / 100;
  const supplierValue = Math.round((claim.disputedValue - buyerValue) * 100) / 100;
  const proposals = claim.proposals.map((proposal) => proposal.status === "open" ? { ...proposal, status: "superseded" as const } : proposal);
  const id = `prop-ai-${Date.now()}`;
  proposals.push({
    id, source: "ai", round: claim.round, buyerValue, supplierValue,
    summary: `Refund ${buyerValue.toLocaleString("en-US")} SUI to the buyer; release ${supplierValue.toLocaleString("en-US")} SUI to the supplier.`,
    reasoning: "Common ground: both sides agree the rejected quantity. Findings: the buyer's delivery record evidences damage at handover, which DP-7.3 treats as not delivered; the supplier's dispatch evidence shows the goods intact before carriage, so part of the loss sits with carriage risk. Policy clauses applied: DP-7.3, DP-7.6. Sample mediation, not produced by the live model.",
    status: "open", acceptances: [], citations: [{ title: "Dispute Resolution Policy", locator: "DP-7.3", excerpt: "Where goods arrive damaged and the damage is evidenced within the inspection window, the damaged quantity is treated as not delivered, and is refundable at the unit price for that line." }],
    unresolvedIssues: ["Open question: did the carrier's proof of delivery record the damage?"], evidenceSufficiency: "moderate", createdAt: new Date().toISOString(),
  });
  const first = order.items[0];
  const rejected = order.inspection?.lines.reduce((sum, line) => sum + line.missing + line.damaged, 0) ?? 1;
  const mediations = [...claim.mediations, { id: `run-${Date.now()}`, createdAt: new Date().toISOString(), outcome: "proposal" as const, unresolved: ["Did the carrier's proof of delivery record the damage?"], modelCalls: 5, proposalId: id, report: sampleReport(order, claim.disputedValue, buyerValue, supplierValue, rejected, first.unit) }];
  return withClaim(order, { ...claim, proposals, mediations }, "negotiation_open", "AI mediation proposal", "The mediator proposed a split for both parties to review.");
}

export function escalateSample(order: DemoOrder): DemoOrder {
  const claim = order.claim!;
  return withClaim(order, { ...claim, status: "arbitration_pending", escalationReason: "A party requested arbitration" }, "arbitration_pending", "Sent to arbitrator", "The disputed amount is with the arbitrator.");
}

export function executeSampleSettlement(order: DemoOrder): DemoOrder {
  const claim = order.claim!;
  const settlement = claim.settlement ?? { buyerValue: claim.requestedValue, supplierValue: claim.disputedValue - claim.requestedValue, executionStatus: "pending_on_chain" as const, agreementId: "sample-agreement" };
  const next = withClaim(order, { ...claim, status: "settled", settlement: { ...settlement, executionStatus: "verified_on_chain", transactionDigest: "sample-settlement-not-on-chain" } }, "settled", "Settled", `Refunded ${settlement.buyerValue.toLocaleString("en-US")} SUI to the buyer and released ${settlement.supplierValue.toLocaleString("en-US")} SUI to the supplier.`);
  next.settlement = { buyerValue: settlement.buyerValue, supplierValue: (order.inspection?.acceptedValue ?? 0) + settlement.supplierValue, transactionDigest: "sample-settlement-not-on-chain", verifiedOnChain: false, source: "dispute" };
  return next;
}

export function addSampleDocument(order: DemoOrder, document: OrderDocument): DemoOrder {
  return { ...order, documents: [document, ...order.documents], events: [...order.events, { at: document.uploadedAt, label: "Document attached", detail: document.name }] };
}

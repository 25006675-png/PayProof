import { DomainError, type DomainContext } from "../domain/types.js";

export type DemoStage =
  | "awaiting_confirmation"
  | "awaiting_escrow_funding"
  | "fulfilment_in_progress"
  | "delivered"
  | "supplier_review"
  | "negotiation_open"
  | "proposal_review"
  | "awaiting_sui_settlement"
  | "settled_receipt";

export type DemoExecutionKind =
  | "live_backend"
  | "live_ai_reference"
  | "simulated_wait"
  | "seeded_demo_data"
  | "external_sui_reference";

export interface DemoReference {
  transactionDigest?: string;
  objectId?: string;
  receiptObjectId?: string;
  mediationRunId?: string;
  proposalId?: string;
}

export interface DemoEvent {
  id: string;
  command: DemoCommand;
  executionKind: DemoExecutionKind;
  disclosure: string;
  from: DemoStage;
  to: DemoStage;
  at: string;
  reference?: DemoReference;
}

export interface DemoOrder {
  id: string;
  label: string;
  isHero: boolean;
  stage: DemoStage;
  buyerAccepted: boolean;
  supplierAccepted: boolean;
  references: DemoReference;
  events: DemoEvent[];
}

export type DemoCommand =
  | "confirm_order"
  | "record_escrow_funding"
  | "skip_fulfilment_wait"
  | "seed_buyer_claim"
  | "seed_supplier_counter"
  | "attach_live_mediation"
  | "buyer_accepts"
  | "supplier_accepts"
  | "record_sui_settlement";

export interface DemoAdvanceInput {
  command: DemoCommand;
  reference?: DemoReference;
}

function seededOrders(): DemoOrder[] {
  return [
    { id: "hero-order", label: "Industrial pump — live demo", isHero: true, stage: "awaiting_confirmation", buyerAccepted: false, supplierAccepted: false, references: {}, events: [] },
    { id: "background-confirm", label: "Packaging line", isHero: false, stage: "awaiting_confirmation", buyerAccepted: false, supplierAccepted: false, references: {}, events: [] },
    { id: "background-delivery", label: "Machine components", isHero: false, stage: "fulfilment_in_progress", buyerAccepted: false, supplierAccepted: false, references: {}, events: [] },
    { id: "background-review", label: "Food-grade containers", isHero: false, stage: "supplier_review", buyerAccepted: false, supplierAccepted: false, references: {}, events: [] },
    { id: "background-negotiation", label: "Precision bearings", isHero: false, stage: "negotiation_open", buyerAccepted: false, supplierAccepted: false, references: {}, events: [] },
    { id: "background-settled", label: "Solar inverters", isHero: false, stage: "settled_receipt", buyerAccepted: true, supplierAccepted: true, references: { transactionDigest: "seeded-example-only" }, events: [] },
  ];
}

function requireReference(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new DomainError("DEMO_REFERENCE_REQUIRED", `${name} is required; this action cannot be simulated`, 400);
  return value.trim();
}

export class DemoOrderService {
  private orders = new Map(seededOrders().map((order) => [order.id, order]));

  constructor(private readonly ctx: DomainContext) {}

  list(): DemoOrder[] {
    return [...this.orders.values()].map((order) => structuredClone(order));
  }

  reset(): DemoOrder[] {
    this.orders = new Map(seededOrders().map((order) => [order.id, order]));
    return this.list();
  }

  advance(id: string, input: DemoAdvanceInput): DemoOrder {
    const original = this.orders.get(id);
    if (!original) throw new DomainError("NOT_FOUND", "Demo order not found", 404);
    if (!original.isHero) throw new DomainError("DEMO_BACKGROUND_READ_ONLY", "Seeded background orders are read-only", 409);
    const order = structuredClone(original);
    const from = order.stage;
    let to: DemoStage = from;
    let executionKind: DemoExecutionKind;
    let disclosure: string;
    let reference: DemoReference | undefined;

    switch (input.command) {
      case "confirm_order":
        if (from !== "awaiting_confirmation") throw new DomainError("INVALID_DEMO_STAGE", "Order confirmation is not available at this stage");
        to = "awaiting_escrow_funding";
        executionKind = "live_backend";
        disclosure = "Real backend order confirmation; no on-chain claim is made.";
        break;
      case "record_escrow_funding":
        if (from !== "awaiting_escrow_funding") throw new DomainError("INVALID_DEMO_STAGE", "Escrow funding is not expected at this stage");
        reference = {
          transactionDigest: requireReference(input.reference?.transactionDigest, "Sui transaction digest"),
          objectId: requireReference(input.reference?.objectId, "escrow object ID"),
        };
        order.references = { ...order.references, ...reference };
        to = "fulfilment_in_progress";
        executionKind = "external_sui_reference";
        disclosure = "External Sui references recorded. This harness does not claim the transaction was executed or verified.";
        break;
      case "skip_fulfilment_wait":
        if (from !== "fulfilment_in_progress") throw new DomainError("INVALID_DEMO_STAGE", "Fulfilment wait cannot be skipped at this stage");
        to = "delivered";
        executionKind = "simulated_wait";
        disclosure = "Demo clock advanced; no shipment or blockchain event was fabricated.";
        break;
      case "seed_buyer_claim":
        if (from !== "delivered") throw new DomainError("INVALID_DEMO_STAGE", "Buyer claim can only be seeded after delivery");
        to = "supplier_review";
        executionKind = "seeded_demo_data";
        disclosure = "Pre-written buyer claim and evidence metadata inserted for the demo.";
        break;
      case "seed_supplier_counter":
        if (from !== "supplier_review") throw new DomainError("INVALID_DEMO_STAGE", "Supplier counter can only be seeded during review");
        to = "negotiation_open";
        executionKind = "seeded_demo_data";
        disclosure = "Pre-written supplier counter-evidence inserted for the demo.";
        break;
      case "attach_live_mediation":
        if (from !== "negotiation_open") throw new DomainError("INVALID_DEMO_STAGE", "Live mediation is not expected at this stage");
        reference = {
          mediationRunId: requireReference(input.reference?.mediationRunId, "mediation run ID"),
          proposalId: requireReference(input.reference?.proposalId, "AI proposal ID"),
        };
        order.references = { ...order.references, ...reference };
        to = "proposal_review";
        executionKind = "live_ai_reference";
        disclosure = "References a completed persisted mediation run; the harness did not generate a fake AI response.";
        break;
      case "buyer_accepts":
      case "supplier_accepts": {
        if (from !== "proposal_review") throw new DomainError("INVALID_DEMO_STAGE", "Proposal acceptance is not available at this stage");
        if (input.command === "buyer_accepts") order.buyerAccepted = true;
        else order.supplierAccepted = true;
        to = order.buyerAccepted && order.supplierAccepted ? "awaiting_sui_settlement" : "proposal_review";
        executionKind = "live_backend";
        disclosure = to === "awaiting_sui_settlement"
          ? "Both human acceptances recorded; fund execution is still pending on Sui."
          : "One independent human acceptance recorded; no settlement occurred yet.";
        break;
      }
      case "record_sui_settlement":
        if (from !== "awaiting_sui_settlement") throw new DomainError("INVALID_DEMO_STAGE", "Sui settlement is not expected at this stage");
        reference = {
          transactionDigest: requireReference(input.reference?.transactionDigest, "Sui transaction digest"),
          receiptObjectId: requireReference(input.reference?.receiptObjectId, "settlement receipt object ID"),
        };
        order.references = { ...order.references, ...reference };
        to = "settled_receipt";
        executionKind = "external_sui_reference";
        disclosure = "External Sui settlement references recorded. Production must verify effects against the escrow package before release.";
        break;
    }

    order.stage = to;
    order.events.push({
      id: this.ctx.id(), command: input.command, executionKind, disclosure, from, to,
      at: this.ctx.now().toISOString(), reference,
    });
    this.orders.set(id, order);
    return structuredClone(order);
  }
}

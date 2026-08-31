import { describe, expect, it } from "vitest";
import { DemoOrderService } from "../src/demo/demo-service.js";
import { controlledContext } from "./fixtures.js";

describe("transparent demo order progression", () => {
  it("drives one hero order while labelling every simulated, live, and external step", () => {
    const { ctx } = controlledContext();
    const demo = new DemoOrderService(ctx);
    expect(demo.list().filter((order) => !order.isHero).length).toBeGreaterThanOrEqual(4);

    demo.advance("hero-order", { command: "confirm_order" });
    demo.advance("hero-order", { command: "record_escrow_funding", reference: { transactionDigest: "real-funding-reference", objectId: "0xescrow" } });
    const delivered = demo.advance("hero-order", { command: "skip_fulfilment_wait" });
    expect(delivered.events.at(-1)).toMatchObject({ executionKind: "simulated_wait", from: "fulfilment_in_progress", to: "delivered" });

    demo.advance("hero-order", { command: "seed_buyer_claim" });
    demo.advance("hero-order", { command: "seed_supplier_counter" });
    demo.advance("hero-order", { command: "attach_live_mediation", reference: { mediationRunId: "run-1", proposalId: "proposal-1" } });
    demo.advance("hero-order", { command: "buyer_accepts" });
    const agreed = demo.advance("hero-order", { command: "supplier_accepts" });
    expect(agreed).toMatchObject({ stage: "awaiting_sui_settlement", buyerAccepted: true, supplierAccepted: true });
    expect(agreed.events.at(-1)?.disclosure).toContain("still pending on Sui");

    const settled = demo.advance("hero-order", { command: "record_sui_settlement", reference: { transactionDigest: "real-settlement-reference", receiptObjectId: "0xreceipt" } });
    expect(settled.stage).toBe("settled_receipt");
    expect(settled.events.at(-1)).toMatchObject({ executionKind: "external_sui_reference" });
    expect(new Set(settled.events.map((event) => event.executionKind))).toEqual(new Set([
      "live_backend", "external_sui_reference", "simulated_wait", "seeded_demo_data", "live_ai_reference",
    ]));
  });

  it("cannot skip escrow or settlement without external references", () => {
    const { ctx } = controlledContext();
    const demo = new DemoOrderService(ctx);
    demo.advance("hero-order", { command: "confirm_order" });
    expect(() => demo.advance("hero-order", { command: "record_escrow_funding" })).toThrow("cannot be simulated");
    expect(demo.list().find((order) => order.id === "hero-order")?.stage).toBe("awaiting_escrow_funding");
  });

  it("keeps background examples read-only", () => {
    const { ctx } = controlledContext();
    const demo = new DemoOrderService(ctx);
    expect(() => demo.advance("background-review", { command: "seed_supplier_counter" })).toThrow("read-only");
  });
});

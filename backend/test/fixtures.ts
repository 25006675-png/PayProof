import type { Actor, DomainContext } from "../src/domain/types.js";
import type { OpenDisputeInput } from "../src/domain/dispute-machine.js";

export const BUYER = "11111111-1111-4111-8111-111111111111";
export const SUPPLIER = "22222222-2222-4222-8222-222222222222";
export const ARBITRATOR = "33333333-3333-4333-8333-333333333333";
export const buyer: Actor = { id: BUYER };
export const supplier: Actor = { id: SUPPLIER };
export const arbitrator: Actor = { id: ARBITRATOR };

export function controlledContext(start = "2026-08-31T00:00:00.000Z") {
  let current = new Date(start);
  let sequence = 0;
  const ctx: DomainContext = { now: () => new Date(current), id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };
  return { ctx, set: (value: string) => { current = new Date(value); } };
}

export function openInput(overrides: Partial<OpenDisputeInput> = {}): OpenDisputeInput {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    orderId: "ORDER-100", buyerId: BUYER, supplierId: SUPPLIER, arbitratorId: ARBITRATOR,
    assetType: "USDC", totalEscrowUnits: "100000", disputedUnits: "30000", requestedBuyerUnits: "20000",
    claim: "Delivered machinery does not conform to the agreed specification.",
    tradeTerms: { orderReference: "ORDER-100", description: "Industrial pump, grade A", inspectionTerms: "Inspect within seven days", governingLaw: "Malaysia" },
    negotiationDeadline: "2026-09-03T00:00:00.000Z", maxHumanRounds: 3,
    evidenceStatement: "Inspection report records corrosion and reduced output.", evidenceFiles: [],
    ...overrides,
  };
}

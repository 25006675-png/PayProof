import { describe, expect, it } from "vitest";
import { OrganizationService } from "../src/service/organization-service.js";
import { MemoryOrganizationStore } from "../src/store/organization-store.js";
import { MemoryTradeStore } from "../src/store/trade-store.js";

describe("OrganizationService", () => {
  it("creates one stable default organization with explicit capabilities", async () => {
    const service = new OrganizationService(new MemoryOrganizationStore());
    const actor = { id: "account-1", name: "GreenBite Trading", email: "owner@example.com" };
    const first = await service.workspace(actor);
    const returning = await service.workspace(actor);
    expect(returning.primary.organizationId).toBe(first.primary.organizationId);
    expect(first.primary).toMatchObject({ organizationName: "GreenBite Trading", authority: "owner", canBuy: true, canSupply: true });
  });

  it("rejects authority for organizations outside the actor membership", async () => {
    const service = new OrganizationService(new MemoryOrganizationStore());
    await expect(service.requireCapability({ id: "account-1" }, "buy", crypto.randomUUID()))
      .rejects.toMatchObject({ code: "ORGANIZATION_FORBIDDEN", status: 403 });
  });

  it("renames the primary organization without changing its identity or capabilities", async () => {
    const service = new OrganizationService(new MemoryOrganizationStore());
    const actor = { id: "account-1", name: "Choong Zhuo Lin", email: "owner@example.com" };
    const before = await service.workspace(actor);
    const renamed = await service.renamePrimary(actor, "FreshSource Procurement Sdn. Bhd.");
    expect(renamed.primary).toMatchObject({
      organizationId: before.primary.organizationId,
      organizationName: "FreshSource Procurement Sdn. Bhd.",
      authority: "owner",
      canBuy: true,
      canSupply: true,
    });
    await expect(service.renamePrimary(actor, " ")).rejects.toMatchObject({ code: "INVALID_ORGANIZATION_NAME", status: 400 });
  });

  it("publishes only verified aggregate trade facts after an owner opts in", async () => {
    const organizations = new MemoryOrganizationStore();
    const trades = new MemoryTradeStore();
    const service = new OrganizationService(organizations, trades);
    const actor = { id: "account-1", name: "FreshSource Foods", email: "owner@example.com" };
    const membership = (await service.workspace(actor)).primary;
    await trades.createOrder({
      id: crypto.randomUUID(), reference: "TRUST-1", buyerId: "buyer", buyerOrganizationId: crypto.randomUUID(),
      supplierId: actor.id, supplierOrganizationId: membership.organizationId, arbitratorId: "arbitrator",
      supplierEmail: actor.email, supplierName: membership.organizationName, assetType: "USDC", amountUnits: "100",
      orderHash: "07".repeat(32), description: "Goods", deliveryDate: "2026-09-05", deliveryLocation: "PJ",
      lineItems: [{ id: "1", description: "Goods", quantity: "1", unit: "lot", unitPriceUnits: "100" }],
      releasePlan: { depositUnits: "20", dispatchUnits: "40", deliveryUnits: "40" }, status: "settled", version: 4,
      funding: { packageId: "0x1", escrowObjectId: "0x2", transactionDigest: "fund", buyerAddress: "0xa", supplierAddress: "0xb", arbitratorAddress: "0xc", verificationStatus: "verified_on_chain", fundedAt: "2026-09-01T00:00:00.000Z" },
      settlement: { buyerUnits: "0", supplierUnits: "100", verifiedOnChain: true, source: "full_acceptance" },
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
    });
    await expect(service.publicTrustProfile(membership.organizationSlug)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const published = await service.setTrustPublished(actor, membership.organizationId, true);
    expect(published).toMatchObject({ published: true, newOnPayProof: true, supplier: { fundedOrders: 1, settledOrders: 1, disputes: 0 } });
    expect((await service.publicTrustProfile(membership.organizationSlug)).supplier.disputeFreeRate).toBeUndefined();
  });
});

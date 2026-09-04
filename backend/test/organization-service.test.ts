import { describe, expect, it } from "vitest";
import { OrganizationService } from "../src/service/organization-service.js";
import { MemoryOrganizationStore } from "../src/store/organization-store.js";

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
});

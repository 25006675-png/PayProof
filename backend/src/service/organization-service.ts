import { DomainError, type Actor } from "../domain/types.js";
import type { OrganizationMembership, OrganizationStore } from "../store/organization-store.js";

export class OrganizationService {
  constructor(private readonly store: OrganizationStore) {}

  async workspace(actor: Actor): Promise<{ primary: OrganizationMembership; organizations: OrganizationMembership[] }> {
    const primary = await this.store.ensureDefault(actor.id, actor.name);
    const organizations = await this.store.listForAccount(actor.id);
    return { primary, organizations };
  }

  async create(actor: Actor, name: string): Promise<OrganizationMembership> {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 160) throw new DomainError("INVALID_ORGANIZATION_NAME", "Organization name must be between 2 and 160 characters", 400);
    return this.store.create(actor.id, clean);
  }

  async renamePrimary(actor: Actor, name: string): Promise<{ primary: OrganizationMembership; organizations: OrganizationMembership[] }> {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 160) throw new DomainError("INVALID_ORGANIZATION_NAME", "Company name must be between 2 and 160 characters", 400);
    const { primary, organizations } = await this.workspace(actor);
    if (primary.authority !== "owner" && primary.authority !== "admin")
      throw new DomainError("ORGANIZATION_RENAME_FORBIDDEN", "Only an organization owner or admin can change the company name", 403);
    const renamed = await this.store.rename(actor.id, primary.organizationId, clean);
    return { primary: renamed, organizations: organizations.map((item) => item.organizationId === renamed.organizationId ? renamed : item) };
  }

  async requireCapability(actor: Actor, capability: "buy" | "supply", organizationId?: string): Promise<OrganizationMembership> {
    const { primary, organizations } = await this.workspace(actor);
    const membership = organizationId ? organizations.find((item) => item.organizationId === organizationId) : primary;
    if (!membership) throw new DomainError("ORGANIZATION_FORBIDDEN", "You are not a member of this organization", 403);
    if (capability === "buy" && !membership.canBuy) throw new DomainError("BUY_AUTHORITY_REQUIRED", "Your organization membership cannot create buying orders", 403);
    if (capability === "supply" && !membership.canSupply) throw new DomainError("SUPPLY_AUTHORITY_REQUIRED", "Your organization membership cannot confirm supplying orders", 403);
    return membership;
  }
}

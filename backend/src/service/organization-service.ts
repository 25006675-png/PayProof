import { DomainError, type Actor } from "../domain/types.js";
import type { OrganizationMembership, OrganizationStore } from "../store/organization-store.js";
import type { TradeStore } from "../store/trade-store.js";

export interface TrustRoleSummary {
  fundedOrders: number;
  settledOrders: number;
  disputes: number;
  deadlineClosures: number;
  disputeFreeRate?: number;
  disputeResolutionRate?: number;
}

export interface OrganizationTrustProfile {
  organizationId: string;
  name: string;
  slug: string;
  organizationCreatedAt?: string;
  publishedAt?: string;
  published: boolean;
  newOnPayProof: boolean;
  supplier: TrustRoleSummary;
  buyer: TrustRoleSummary;
}

export class OrganizationService {
  constructor(private readonly store: OrganizationStore, private readonly trades?: TradeStore) {}

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

  async setTrustPublished(actor: Actor, organizationId: string, published: boolean): Promise<OrganizationTrustProfile> {
    const organizations = await this.store.listForAccount(actor.id);
    const membership = organizations.find((item) => item.organizationId === organizationId);
    if (!membership) throw new DomainError("ORGANIZATION_FORBIDDEN", "You are not a member of this organization", 403);
    if (membership.authority !== "owner" && membership.authority !== "admin") {
      throw new DomainError("TRUST_PROFILE_FORBIDDEN", "Only an organization owner or admin can publish the trust profile", 403);
    }
    const updated = await this.store.setTrustPublished(actor.id, organizationId, published ? new Date().toISOString() : undefined);
    return this.buildTrustProfile(updated);
  }

  async trustPreview(actor: Actor, organizationId: string): Promise<OrganizationTrustProfile> {
    const membership = (await this.store.listForAccount(actor.id)).find((item) => item.organizationId === organizationId);
    if (!membership) throw new DomainError("ORGANIZATION_FORBIDDEN", "You are not a member of this organization", 403);
    return this.buildTrustProfile(membership);
  }

  async publicTrustProfile(slug: string): Promise<OrganizationTrustProfile> {
    const organization = await this.store.findBySlug(slug);
    if (!organization?.trustProfilePublishedAt) throw new DomainError("NOT_FOUND", "Published trust profile not found", 404);
    return this.buildTrustProfile({ ...organization, accountId: "", authority: "member", canBuy: false, canSupply: false });
  }

  private async buildTrustProfile(organization: OrganizationMembership): Promise<OrganizationTrustProfile> {
    const orders = this.trades ? await this.trades.listForOrganization(organization.organizationId) : [];
    const eligible = orders.filter((order) => order.funding?.verificationStatus === "verified_on_chain"
      && order.buyerOrganizationId && order.supplierOrganizationId && order.buyerOrganizationId !== order.supplierOrganizationId);
    const summarize = (role: "buyer" | "supplier"): TrustRoleSummary => {
      const roleOrders = eligible.filter((order) => order[`${role}OrganizationId`] === organization.organizationId);
      const settled = roleOrders.filter((order) => order.status === "settled" && order.settlement?.verifiedOnChain);
      const disputes = roleOrders.filter((order) => Boolean(order.disputeId));
      const resolvedDisputes = disputes.filter((order) => order.status === "settled" && order.settlement?.verifiedOnChain);
      const summary: TrustRoleSummary = {
        fundedOrders: roleOrders.length,
        settledOrders: settled.length,
        disputes: disputes.length,
        deadlineClosures: settled.filter((order) => order.settlement?.source === "refund_unshipped" || order.settlement?.source === "claim_uninspected").length,
      };
      if (settled.length >= 5) summary.disputeFreeRate = Math.round(settled.filter((order) => !order.disputeId).length / settled.length * 100);
      if (disputes.length >= 5) summary.disputeResolutionRate = Math.round(resolvedDisputes.length / disputes.length * 100);
      return summary;
    };
    const supplier = summarize("supplier");
    const buyer = summarize("buyer");
    return {
      organizationId: organization.organizationId, name: organization.organizationName, slug: organization.organizationSlug,
      organizationCreatedAt: organization.organizationCreatedAt, publishedAt: organization.trustProfilePublishedAt,
      published: Boolean(organization.trustProfilePublishedAt), newOnPayProof: supplier.fundedOrders + buyer.fundedOrders < 5,
      supplier, buyer,
    };
  }
}

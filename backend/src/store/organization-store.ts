export type OrganizationAuthority = "owner" | "admin" | "member";

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  accountId: string;
  authority: OrganizationAuthority;
  canBuy: boolean;
  canSupply: boolean;
  organizationCreatedAt?: string;
  trustProfilePublishedAt?: string;
}

export type PublicOrganization = Pick<OrganizationMembership, "organizationId" | "organizationName" | "organizationSlug" | "organizationCreatedAt" | "trustProfilePublishedAt">;

export interface OrganizationStore {
  ensureDefault(accountId: string, suggestedName?: string): Promise<OrganizationMembership>;
  listForAccount(accountId: string): Promise<OrganizationMembership[]>;
  create(accountId: string, name: string): Promise<OrganizationMembership>;
  rename(accountId: string, organizationId: string, name: string): Promise<OrganizationMembership>;
  setTrustPublished(accountId: string, organizationId: string, publishedAt?: string): Promise<OrganizationMembership>;
  findBySlug(slug: string): Promise<PublicOrganization | undefined>;
}

export class MemoryOrganizationStore implements OrganizationStore {
  private readonly memberships = new Map<string, OrganizationMembership[]>();

  async ensureDefault(accountId: string, suggestedName?: string): Promise<OrganizationMembership> {
    const existing = this.memberships.get(accountId)?.[0];
    if (existing) return structuredClone(existing);
    const name = suggestedName?.trim() || "My PayProof workspace";
    const membership: OrganizationMembership = {
      organizationId: crypto.randomUUID(), organizationName: name,
      organizationSlug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${accountId.slice(0, 8)}`,
      accountId, authority: "owner", canBuy: true, canSupply: true, organizationCreatedAt: new Date().toISOString(),
    };
    this.memberships.set(accountId, [membership]);
    return structuredClone(membership);
  }

  async listForAccount(accountId: string): Promise<OrganizationMembership[]> {
    return structuredClone(this.memberships.get(accountId) ?? []);
  }

  async create(accountId: string, name: string): Promise<OrganizationMembership> {
    const membership: OrganizationMembership = {
      organizationId: crypto.randomUUID(), organizationName: name.trim(),
      organizationSlug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomUUID().slice(0, 8)}`,
      accountId, authority: "owner", canBuy: true, canSupply: true, organizationCreatedAt: new Date().toISOString(),
    };
    this.memberships.set(accountId, [...(this.memberships.get(accountId) ?? []), membership]);
    return structuredClone(membership);
  }

  async rename(accountId: string, organizationId: string, name: string): Promise<OrganizationMembership> {
    const memberships = this.memberships.get(accountId) ?? [];
    const existing = memberships.find((item) => item.organizationId === organizationId);
    if (!existing) throw new Error("ORGANIZATION_MEMBERSHIP_NOT_FOUND");
    const updated: OrganizationMembership = { ...existing, organizationName: name.trim() };
    this.memberships.set(accountId, memberships.map((item) => item.organizationId === organizationId ? updated : item));
    return structuredClone(updated);
  }


  async setTrustPublished(accountId: string, organizationId: string, publishedAt?: string): Promise<OrganizationMembership> {
    const memberships = this.memberships.get(accountId) ?? [];
    const existing = memberships.find((item) => item.organizationId === organizationId);
    if (!existing) throw new Error("ORGANIZATION_MEMBERSHIP_NOT_FOUND");
    const updated = { ...existing, trustProfilePublishedAt: publishedAt };
    for (const [memberId, values] of this.memberships) {
      this.memberships.set(memberId, values.map((item) => item.organizationId === organizationId ? { ...item, trustProfilePublishedAt: publishedAt } : item));
    }
    return structuredClone(updated);
  }

  async findBySlug(slug: string): Promise<PublicOrganization | undefined> {
    for (const memberships of this.memberships.values()) {
      const found = memberships.find((item) => item.organizationSlug === slug);
      if (found) return structuredClone(found);
    }
    return undefined;
  }
}

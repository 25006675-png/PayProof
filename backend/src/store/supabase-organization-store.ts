import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationMembership, OrganizationStore } from "./organization-store.js";

type Row = {
  organization_id: string; account_id: string; authority: "owner" | "admin" | "member";
  can_buy: boolean; can_supply: boolean;
  payproof_organizations: { name: string; slug: string } | Array<{ name: string; slug: string }>;
};

export class SupabaseOrganizationStore implements OrganizationStore {
  private readonly client: SupabaseClient;
  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private map(row: Row): OrganizationMembership {
    const organization = Array.isArray(row.payproof_organizations) ? row.payproof_organizations[0] : row.payproof_organizations;
    if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
    return {
      organizationId: row.organization_id, organizationName: organization.name, organizationSlug: organization.slug,
      accountId: row.account_id, authority: row.authority, canBuy: row.can_buy, canSupply: row.can_supply,
    };
  }

  async ensureDefault(accountId: string, suggestedName?: string): Promise<OrganizationMembership> {
    const { error } = await this.client.rpc("ensure_personal_organization", { p_account_id: accountId, p_name: suggestedName ?? null });
    if (error) throw new Error(`Supabase organization resolution failed: ${error.message}`);
    const memberships = await this.listForAccount(accountId);
    if (!memberships[0]) throw new Error("ORGANIZATION_MEMBERSHIP_NOT_FOUND");
    return memberships[0];
  }

  async listForAccount(accountId: string): Promise<OrganizationMembership[]> {
    const { data, error } = await this.client.from("payproof_organization_memberships")
      .select("organization_id,account_id,authority,can_buy,can_supply,payproof_organizations(name,slug)")
      .eq("account_id", accountId).order("created_at", { ascending: true });
    if (error) throw new Error(`Supabase organization membership lookup failed: ${error.message}`);
    return (data ?? []).map((row) => this.map(row as unknown as Row));
  }

  async create(accountId: string, name: string): Promise<OrganizationMembership> {
    const { data, error } = await this.client.rpc("create_payproof_organization", { p_account_id: accountId, p_name: name.trim() });
    if (error) throw new Error(`Supabase organization create failed: ${error.message}`);
    const memberships = await this.listForAccount(accountId);
    const created = memberships.find((item) => item.organizationId === data.id);
    if (!created) throw new Error("ORGANIZATION_MEMBERSHIP_NOT_FOUND");
    return created;
  }

  async rename(accountId: string, organizationId: string, name: string): Promise<OrganizationMembership> {
    const { data, error } = await this.client.from("payproof_organizations")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", organizationId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Supabase organization rename failed: ${error.message}`);
    if (!data) throw new Error("ORGANIZATION_NOT_FOUND");
    const memberships = await this.listForAccount(accountId);
    const updated = memberships.find((item) => item.organizationId === organizationId);
    if (!updated) throw new Error("ORGANIZATION_MEMBERSHIP_NOT_FOUND");
    return updated;
  }
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TradeInvite, TradeOrder } from "../domain/trade-types.js";
import type { TradeStore } from "./trade-store.js";

export class SupabaseTradeStore implements TradeStore {
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string) {
    if (!secretKey.startsWith("sb_secret_") && !secretKey.startsWith("eyJ")) {
      throw new Error("A server-side Supabase secret/service-role key is required");
    }
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createOrder(order: TradeOrder): Promise<void> {
    const { error } = await this.client.from("trade_orders").insert({
      id: order.id,
      buyer_id: order.buyerId ?? null,
      buyer_organization_id: order.buyerOrganizationId ?? null,
      supplier_id: order.supplierId ?? null,
      supplier_organization_id: order.supplierOrganizationId ?? null,
      arbitrator_id: order.arbitratorId,
      status: order.status,
      version: order.version,
      aggregate: order,
    });
    if (error) throw new Error(`Supabase trade order create failed: ${error.message}`);
  }

  async getOrder(id: string): Promise<TradeOrder | undefined> {
    const { data, error } = await this.client.from("trade_orders").select("aggregate").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase trade order read failed: ${error.message}`);
    return data?.aggregate as TradeOrder | undefined;
  }

  async listOrders(actorId: string, organizationIds: string[] = []): Promise<TradeOrder[]> {
    const filters = [`buyer_id.eq.${actorId}`, `supplier_id.eq.${actorId}`, `arbitrator_id.eq.${actorId}`];
    for (const id of organizationIds) filters.push(`buyer_organization_id.eq.${id}`, `supplier_organization_id.eq.${id}`);
    const { data, error } = await this.client
      .from("trade_orders")
      .select("aggregate")
      .or(filters.join(","))
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Supabase trade order list failed: ${error.message}`);
    return (data ?? []).map((row) => row.aggregate as TradeOrder);
  }

  async listForOrganization(organizationId: string): Promise<TradeOrder[]> {
    const { data, error } = await this.client.from("trade_orders").select("aggregate")
      .or(`buyer_organization_id.eq.${organizationId},supplier_organization_id.eq.${organizationId}`)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Supabase organization trade lookup failed: ${error.message}`);
    return (data ?? []).map((row) => row.aggregate as TradeOrder);
  }

  async saveOrder(order: TradeOrder, expectedVersion: number): Promise<void> {
    const { data, error } = await this.client.rpc("save_trade_order", {
      p_id: order.id,
      p_expected_version: expectedVersion,
      p_status: order.status,
      p_buyer_id: order.buyerId ?? null,
      p_buyer_organization_id: order.buyerOrganizationId ?? null,
      p_supplier_id: order.supplierId ?? null,
      p_supplier_organization_id: order.supplierOrganizationId ?? null,
      p_aggregate: order,
    });
    if (error) throw new Error(`Supabase trade order save failed: ${error.message}`);
    if (data !== true) throw new Error("OPTIMISTIC_LOCK_CONFLICT");
  }

  async createInvite(invite: TradeInvite): Promise<void> {
    const { error } = await this.client.from("trade_invites").insert({
      id: invite.id,
      order_id: invite.orderId,
      token_hash: invite.tokenHash,
      invited_email: invite.invitedEmail,
      expires_at: invite.expiresAt,
      accepted_by: invite.acceptedBy ?? null,
      accepted_at: invite.acceptedAt ?? null,
      created_at: invite.createdAt,
      delivery_status: invite.deliveryStatus ?? null,
      delivery_message_id: invite.deliveryMessageId ?? null,
      delivery_attempted_at: invite.deliveryAttemptedAt ?? null,
    });
    if (error) throw new Error(`Supabase trade invite create failed: ${error.message}`);
  }

  private mapInvite(row: Record<string, unknown>): TradeInvite {
    return {
      id: String(row.id), orderId: String(row.order_id), tokenHash: String(row.token_hash),
      invitedEmail: String(row.invited_email), expiresAt: String(row.expires_at),
      acceptedBy: row.accepted_by ? String(row.accepted_by) : undefined,
      acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
      createdAt: String(row.created_at),
      deliveryStatus: row.delivery_status ? String(row.delivery_status) as TradeInvite["deliveryStatus"] : undefined,
      deliveryMessageId: row.delivery_message_id ? String(row.delivery_message_id) : undefined,
      deliveryAttemptedAt: row.delivery_attempted_at ? String(row.delivery_attempted_at) : undefined,
    };
  }

  async getInviteByTokenHash(tokenHash: string): Promise<TradeInvite | undefined> {
    const { data, error } = await this.client.from("trade_invites").select("*").eq("token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`Supabase trade invite read failed: ${error.message}`);
    return data ? this.mapInvite(data as Record<string, unknown>) : undefined;
  }

  async getInviteByOrderId(orderId: string): Promise<TradeInvite | undefined> {
    const { data, error } = await this.client.from("trade_invites").select("*").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Supabase trade invite lookup failed: ${error.message}`);
    return data ? this.mapInvite(data as Record<string, unknown>) : undefined;
  }

  async listPendingInvitesByEmail(invitedEmail: string, now: string): Promise<TradeInvite[]> {
    const { data, error } = await this.client.from("trade_invites").select("*")
      .eq("invited_email", invitedEmail).is("accepted_by", null).gt("expires_at", now)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Supabase trade invite lookup failed: ${error.message}`);
    return (data ?? []).map((row) => this.mapInvite(row as Record<string, unknown>));
  }

  async saveInvite(invite: TradeInvite): Promise<void> {
    const { error } = await this.client.from("trade_invites").update({
      expires_at: invite.expiresAt, accepted_by: invite.acceptedBy ?? null, accepted_at: invite.acceptedAt ?? null,
      delivery_status: invite.deliveryStatus ?? null, delivery_message_id: invite.deliveryMessageId ?? null,
      delivery_attempted_at: invite.deliveryAttemptedAt ?? null,
    }).eq("id", invite.id);
    if (error) throw new Error(`Supabase trade invite save failed: ${error.message}`);
  }
}

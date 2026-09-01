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
      buyer_id: order.buyerId,
      supplier_id: order.supplierId ?? null,
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

  async listOrders(actorId: string): Promise<TradeOrder[]> {
    const { data, error } = await this.client
      .from("trade_orders")
      .select("aggregate")
      .or(`buyer_id.eq.${actorId},supplier_id.eq.${actorId},arbitrator_id.eq.${actorId}`)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`Supabase trade order list failed: ${error.message}`);
    return (data ?? []).map((row) => row.aggregate as TradeOrder);
  }

  async saveOrder(order: TradeOrder, expectedVersion: number): Promise<void> {
    const { data, error } = await this.client.rpc("save_trade_order", {
      p_id: order.id,
      p_expected_version: expectedVersion,
      p_status: order.status,
      p_supplier_id: order.supplierId ?? null,
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

  async saveInvite(invite: TradeInvite): Promise<void> {
    const { error } = await this.client.from("trade_invites").update({ expires_at: invite.expiresAt, accepted_by: invite.acceptedBy ?? null, accepted_at: invite.acceptedAt ?? null }).eq("id", invite.id);
    if (error) throw new Error(`Supabase trade invite save failed: ${error.message}`);
  }
}

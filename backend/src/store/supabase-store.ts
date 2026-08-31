import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DisputeAggregate } from "../domain/types.js";
import type { DisputeStore } from "./store.js";

export class SupabaseDisputeStore implements DisputeStore {
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string) {
    if (!secretKey.startsWith("sb_secret_") && !secretKey.startsWith("eyJ")) {
      throw new Error("A server-side Supabase secret/service-role key is required");
    }
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async create(dispute: DisputeAggregate): Promise<void> {
    const { error } = await this.client.from("dispute_aggregates").insert({
      id: dispute.id,
      buyer_id: dispute.buyerId,
      supplier_id: dispute.supplierId,
      arbitrator_id: dispute.arbitratorId,
      status: dispute.status,
      version: dispute.version,
      aggregate: dispute,
    });
    if (error) throw new Error(`Supabase create failed: ${error.message}`);
  }

  async get(id: string): Promise<DisputeAggregate | undefined> {
    const { data, error } = await this.client.from("dispute_aggregates").select("aggregate").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return data?.aggregate as DisputeAggregate | undefined;
  }

  async save(dispute: DisputeAggregate, expectedVersion: number): Promise<void> {
    const { data, error } = await this.client.rpc("save_dispute_aggregate", {
      p_id: dispute.id,
      p_expected_version: expectedVersion,
      p_status: dispute.status,
      p_aggregate: dispute,
    });
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
    if (data !== true) throw new Error("OPTIMISTIC_LOCK_CONFLICT");
  }
}

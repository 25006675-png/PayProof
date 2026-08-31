import type { DisputeAggregate } from "../domain/types.js";

export interface DisputeStore {
  create(dispute: DisputeAggregate): Promise<void>;
  get(id: string): Promise<DisputeAggregate | undefined>;
  save(dispute: DisputeAggregate, expectedVersion: number): Promise<void>;
}

export class MemoryDisputeStore implements DisputeStore {
  private readonly disputes = new Map<string, DisputeAggregate>();

  async create(dispute: DisputeAggregate): Promise<void> {
    if (this.disputes.has(dispute.id)) throw new Error("DISPUTE_ALREADY_EXISTS");
    this.disputes.set(dispute.id, structuredClone(dispute));
  }

  async get(id: string): Promise<DisputeAggregate | undefined> {
    const result = this.disputes.get(id);
    return result ? structuredClone(result) : undefined;
  }

  async save(dispute: DisputeAggregate, expectedVersion: number): Promise<void> {
    const current = this.disputes.get(dispute.id);
    if (!current) throw new Error("DISPUTE_NOT_FOUND");
    if (current.version !== expectedVersion) throw new Error("OPTIMISTIC_LOCK_CONFLICT");
    this.disputes.set(dispute.id, structuredClone(dispute));
  }
}

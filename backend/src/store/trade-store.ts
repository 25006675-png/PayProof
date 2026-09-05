import type { TradeInvite, TradeOrder } from "../domain/trade-types.js";

export interface TradeStore {
  createOrder(order: TradeOrder): Promise<void>;
  getOrder(id: string): Promise<TradeOrder | undefined>;
  listOrders(actorId: string, organizationIds?: string[]): Promise<TradeOrder[]>;
  listForOrganization(organizationId: string): Promise<TradeOrder[]>;
  saveOrder(order: TradeOrder, expectedVersion: number): Promise<void>;
  createInvite(invite: TradeInvite): Promise<void>;
  getInviteByTokenHash(tokenHash: string): Promise<TradeInvite | undefined>;
  getInviteByOrderId(orderId: string): Promise<TradeInvite | undefined>;
  listPendingInvitesByEmail(invitedEmail: string, now: string): Promise<TradeInvite[]>;
  saveInvite(invite: TradeInvite): Promise<void>;
}

export class MemoryTradeStore implements TradeStore {
  private readonly orders = new Map<string, TradeOrder>();
  private readonly invites = new Map<string, TradeInvite>();

  async createOrder(order: TradeOrder): Promise<void> {
    if (this.orders.has(order.id)) throw new Error("TRADE_ORDER_ALREADY_EXISTS");
    this.orders.set(order.id, structuredClone(order));
  }

  async getOrder(id: string): Promise<TradeOrder | undefined> {
    const order = this.orders.get(id);
    return order ? structuredClone(order) : undefined;
  }

  async listOrders(actorId: string, organizationIds: string[] = []): Promise<TradeOrder[]> {
    return [...this.orders.values()]
      .filter((order) => order.buyerId === actorId || order.supplierId === actorId || order.arbitratorId === actorId
        || organizationIds.includes(order.buyerOrganizationId ?? "")
        || organizationIds.includes(order.supplierOrganizationId ?? ""))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((order) => structuredClone(order));
  }

  async listForOrganization(organizationId: string): Promise<TradeOrder[]> {
    return [...this.orders.values()]
      .filter((order) => order.buyerOrganizationId === organizationId || order.supplierOrganizationId === organizationId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((order) => structuredClone(order));
  }

  async saveOrder(order: TradeOrder, expectedVersion: number): Promise<void> {
    const current = this.orders.get(order.id);
    if (!current) throw new Error("TRADE_ORDER_NOT_FOUND");
    if (current.version !== expectedVersion) throw new Error("OPTIMISTIC_LOCK_CONFLICT");
    this.orders.set(order.id, structuredClone(order));
  }

  async createInvite(invite: TradeInvite): Promise<void> {
    if (this.invites.has(invite.id)) throw new Error("TRADE_INVITE_ALREADY_EXISTS");
    this.invites.set(invite.id, structuredClone(invite));
  }

  async getInviteByTokenHash(tokenHash: string): Promise<TradeInvite | undefined> {
    for (const invite of this.invites.values()) {
      if (invite.tokenHash === tokenHash) return structuredClone(invite);
    }
    return undefined;
  }

  async getInviteByOrderId(orderId: string): Promise<TradeInvite | undefined> {
    const latest = [...this.invites.values()]
      .filter((invite) => invite.orderId === orderId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return latest ? structuredClone(latest) : undefined;
  }

  async listPendingInvitesByEmail(invitedEmail: string, now: string): Promise<TradeInvite[]> {
    return [...this.invites.values()]
      .filter((invite) => invite.invitedEmail === invitedEmail && !invite.acceptedBy && invite.expiresAt > now)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((invite) => structuredClone(invite));
  }

  async saveInvite(invite: TradeInvite): Promise<void> {
    if (!this.invites.has(invite.id)) throw new Error("TRADE_INVITE_NOT_FOUND");
    this.invites.set(invite.id, structuredClone(invite));
  }
}

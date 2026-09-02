"use client";

import type { DemoOrder, OrderDelivery, OrderDocument, OrderEvent, OrderInspection, OrderShipment } from "@/lib/demo-orders";

export type Extras = {
  documents: OrderDocument[];
  inspection?: OrderInspection;
  shipment?: OrderShipment;
  deliveryRecord?: OrderDelivery;
  events: OrderEvent[];
};

const key = (orderId: string) => `payproof_order_extras:${orderId}`;

/**
 * Details the backend does not store yet (documents, carrier and tracking,
 * delivery reference) are kept in the browser against the live order id.
 */
export function loadExtras(orderId: string): Extras {
  try {
    const raw = localStorage.getItem(key(orderId));
    if (raw) return { documents: [], events: [], ...(JSON.parse(raw) as Partial<Extras>) };
  } catch { /* ignore */ }
  return { documents: [], events: [] };
}

export function saveExtras(orderId: string, extras: Extras): void {
  localStorage.setItem(key(orderId), JSON.stringify(extras));
}

export function updateExtras(orderId: string, update: (extras: Extras) => Extras): Extras {
  const next = update(loadExtras(orderId));
  saveExtras(orderId, next);
  return next;
}

export function withExtras(order: DemoOrder): DemoOrder {
  if (order.source !== "backend") return order;
  const extras = loadExtras(order.id);
  const known = new Set(order.events.map((event) => `${event.at}|${event.label}`));
  return {
    ...order,
    documents: [...(order.documents ?? []), ...extras.documents.filter((local) => !(order.documents ?? []).some((remote) => remote.sha256 === local.sha256))],
    inspection: order.inspection ?? extras.inspection,
    shipment: order.shipment ?? extras.shipment,
    deliveryRecord: order.deliveryRecord ?? extras.deliveryRecord,
    events: [...order.events, ...extras.events.filter((event) => !known.has(`${event.at}|${event.label}`))],
  };
}

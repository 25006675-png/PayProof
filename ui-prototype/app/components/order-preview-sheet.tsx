"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RoleTag, SampleTag, StatusPill } from "@/app/components/app-shell";
import { type DemoOrder, claimOwner, formatDate, formatOrderMoney as money } from "@/lib/demo-orders";
import { nextAction } from "@/lib/order-status";

export function OrderPreviewSheet({ order, open, onOpenChange }: { order: DemoOrder | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!order) return null;
  const action = nextAction(order.status, order.role, { invited: order.source === "backend" ? Boolean(order.invited) : true, claimOwner: claimOwner(order.claim) });
  const href = `/orders/${encodeURIComponent(order.id)}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={`preview-sheet preview-sheet-${order.role.toLowerCase()}`}>
        <SheetHeader className="preview-head">
          <div className="preview-tags"><StatusPill status={order.status} /><RoleTag role={order.role} compact />{order.source === "sample" && <SampleTag />}</div>
          <SheetTitle>{order.reference}</SheetTitle>
          <SheetDescription>{order.item}, {order.role === "BUYER" ? "from" : "for"} {order.counterparty}.</SheetDescription>
        </SheetHeader>
        <div className="preview-body">
          <div className={`preview-action preview-action-${action.owner}`}>
            <span>{action.owner === "you" ? "Your action" : action.owner === "counterparty" ? `Waiting on ${order.counterparty}` : "No action needed"}</span>
            <strong>{action.title}</strong>
            <p>{action.detail}</p>
          </div>
          <dl className="fact-list">
            <div><dt>Order value</dt><dd><strong>{money(order.value)} {order.currency}</strong></dd></div>
            <div><dt>Expected delivery</dt><dd>{formatDate(order.delivery)}</dd></div>
            <div><dt>Delivery location</dt><dd>{order.deliveryLocation}</dd></div>
            {order.shipment && <div><dt>Shipment</dt><dd>{order.shipment.carrier}<small>Tracking {order.shipment.trackingNumber}</small></dd></div>}
            {order.inspection && order.inspection.heldValue > 0 && <div><dt>Held for claim</dt><dd>{money(order.inspection.heldValue)} {order.currency}</dd></div>}
          </dl>
          <section className="preview-lines">
            <div className="preview-lines-head"><strong>Order lines</strong><span>{order.items.length} {order.items.length === 1 ? "line" : "lines"}</span></div>
            {order.items.slice(0, 4).map((item) => <p key={item.id}><span>{item.description}</span><strong>{money(item.quantity)} {item.unit}</strong></p>)}
            {order.items.length > 4 && <small>{order.items.length - 4} more on the full order.</small>}
          </section>
        </div>
        <div className="preview-actions">
          <Button variant="outline" asChild><a href={href}>Review full order</a></Button>
          {action.owner === "you"
            ? <Button className="btn-primary" asChild><a href={href}>{action.title}<ArrowRight size={14} aria-hidden="true" /></a></Button>
            : <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

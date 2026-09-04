"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell, EmptyArt, HelpHint, Notice, PageTitle, SampleTag, Skeleton, StatusPill } from "@/app/components/app-shell";
import { CreateOrderDialog } from "@/app/components/create-order-dialog";
import { OrderPreviewSheet } from "@/app/components/order-preview-sheet";
import { type DemoOrder, claimOwner, formatDate, formatOrderMoney as money } from "@/lib/demo-orders";
import { PHASES, STATUS, nextAction, phaseOf, type Phase } from "@/lib/order-status";
import { loadSampleOrders, saveSampleOrders } from "@/lib/sample-orders";
import { useWorkspace } from "@/lib/use-workspace";

type RoleFilter = "all" | "buyer" | "supplier";
type PhaseFilter = "all" | "action" | Phase;

function actionFor(order: DemoOrder) {
  return nextAction(order.status, order.role, { invited: order.source === "backend" ? Boolean(order.invited) : true, claimOwner: claimOwner(order.claim) });
}

export default function OrdersPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const [role, setRole] = useState<RoleFilter>("all");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState<DemoOrder[]>([]);
  const [selected, setSelected] = useState<DemoOrder | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("role");
    if (wanted === "buyer" || wanted === "supplier") setRole(wanted);
    if (params.get("action") === "create") setCreateOpen(true);
    const status = params.get("status");
    if (status === "action" || PHASES.some((entry) => entry.id === status)) setPhase(status as PhaseFilter);
  }, []);

  const all = useMemo(() => {
    const known = new Set(workspace.orders.map((order) => order.id));
    return [...created.filter((order) => !known.has(order.id)), ...workspace.orders];
  }, [created, workspace.orders]);

  const counts = useMemo(() => {
    const byPhase: Record<PhaseFilter, number> = { all: all.length, action: 0, confirm: 0, fund: 0, fulfil: 0, claims: 0, done: 0 };
    for (const order of all) {
      byPhase[phaseOf(order.status)] += 1;
      if (actionFor(order).owner === "you") byPhase.action += 1;
    }
    return byPhase;
  }, [all]);

  const visible = useMemo(() => all.filter((order) => {
    if (role !== "all" && order.role.toLowerCase() !== role) return false;
    if (phase === "action" && actionFor(order).owner !== "you") return false;
    if (phase !== "all" && phase !== "action" && phaseOf(order.status) !== phase) return false;
    const haystack = [order.reference, order.buyer, order.supplier, order.item, STATUS[order.status].label].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [all, role, phase, query]);

  const addOrder = (order: DemoOrder) => {
    if (order.source === "sample") saveSampleOrders(workspace.accountKey, [order, ...loadSampleOrders(workspace.accountKey, workspace.company).filter((item) => item.id !== order.id)]);
    else workspace.replaceLiveOrder(order);
    setCreated((current) => [order, ...current.filter((item) => item.id !== order.id)]);
    setPhase("all");
    setNotice(`${order.reference} was sent to ${order.counterparty} for confirmation.`);
  };

  const openOrder = (order: DemoOrder) => {
    if (window.matchMedia("(max-width: 760px)").matches) router.push(`/orders/${encodeURIComponent(order.id)}`);
    else setSelected(order);
  };

  return (
    <AppShell active="orders" company={workspace.company} actionCount={counts.action}>
      <PageTitle title="Orders" description={`${counts.all} purchase ${counts.all === 1 ? "order" : "orders"} where ${workspace.company} is the buyer or the supplier.`}
        actions={<Button className="btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} aria-hidden="true" />New purchase order</Button>} />
      {notice && <Notice tone="success" onDismiss={() => setNotice("")}>{notice}</Notice>}
      {workspace.error && <Notice tone="error">{workspace.error}</Notice>}

      <section className="panel table-panel" aria-label="Order register">
        <div className="phase-tabs" role="tablist" aria-label="Filter by stage">
          {([{ id: "all", label: "All" }, { id: "action", label: "Needs action" }, ...PHASES] as Array<{ id: PhaseFilter; label: string }>).map((tab) => (
            <button key={tab.id} role="tab" type="button" aria-selected={phase === tab.id} className={phase === tab.id ? "phase-tab phase-tab-active" : "phase-tab"} onClick={() => setPhase(tab.id)}>
              {tab.label}<span className={`phase-count ${tab.id === "action" && counts.action > 0 ? "phase-count-hot" : ""}`}>{counts[tab.id]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <div className="segmented" role="radiogroup" aria-label="Filter by role">
            {(["all", "buyer", "supplier"] as const).map((value) => (
              <button key={value} role="radio" type="button" aria-checked={role === value} className={role === value ? "segment segment-active" : "segment"} onClick={() => setRole(value)}>
                {value === "all" ? "Both roles" : value === "buyer" ? "Buying" : "Supplying"}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, company or product" aria-label="Search orders" />
          </label>
          <div className="toolbar-samples">
            <label className="toggle"><input type="checkbox" checked={!workspace.hideSamples} onChange={(event) => workspace.setHideSamples(!event.target.checked)} /><span>Show sample orders</span></label>
            <HelpHint text="Sample orders show every stage of a trade so you can explore the workflow. They belong to your account only and never reach the backend or Sui." />
            {!workspace.hideSamples && <button type="button" className="text-button" onClick={workspace.resetSamples}>Reset samples</button>}
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table register-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Buyer</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Next step</th>
                <th className="num">Value</th>
                <th><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {!workspace.ready ? (
                <tr><td colSpan={7}><Skeleton lines={4} /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="table-empty"><EmptyArt kind="inbox" /><strong>{all.length === 0 ? "No orders yet" : "No orders here"}</strong><span>{all.length === 0 ? "Create a purchase order, or turn on sample orders to explore the workflow." : "Try another stage, company or order number."}</span></td></tr>
              ) : visible.map((order, index) => {
                const action = actionFor(order);
                return (
                  <tr key={order.id} className={`${action.owner === "you" ? "row-action" : ""} row-reveal lift-row`} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
                    <td>
                      {action.owner === "you" && <span className="action-dot" title="Needs your action" aria-hidden="true" />}
                      <a className="row-link" href={`/orders/${encodeURIComponent(order.id)}`}><strong>{order.reference}</strong></a>
                      <small>{order.item}, {order.items.length} {order.items.length === 1 ? "line" : "lines"}</small>
                      {order.source === "sample" && <SampleTag />}
                    </td>
                    <td><span className="cell-party"><strong>{order.buyer}</strong>{order.role === "BUYER" && <small className="side-buying">You · Buying</small>}</span></td>
                    <td><span className="cell-party"><strong>{order.supplier}</strong>{order.role === "SUPPLIER" && <small className="side-supplying">You · Supplying</small>}</span></td>
                    <td><StatusPill status={order.status} /><small>{order.status === "settled" ? "Complete" : `Delivery ${formatDate(order.delivery)}`}</small></td>
                    <td className="next-step"><span className={`owner owner-${action.owner}`}>{action.owner === "you" ? "You" : action.owner === "counterparty" ? order.counterparty : "None"}</span><small>{action.title}</small></td>
                    <td className="num">{money(order.value)} {order.currency}</td>
                    <td><button type="button" className="row-open" onClick={() => openOrder(order)} aria-label={`Open ${order.reference}`}>Open<ArrowRight size={13} aria-hidden="true" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot"><span>{visible.length} of {all.length} orders shown</span></div>
      </section>

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={addOrder} profile={workspace.profile} company={workspace.company} />
      <OrderPreviewSheet order={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </AppShell>
  );
}

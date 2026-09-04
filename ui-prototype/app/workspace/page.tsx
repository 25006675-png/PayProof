"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell, EmptyArt, HelpHint, Notice, PageTitle, RoleTag, SampleTag, Skeleton, StatusPill } from "@/app/components/app-shell";
import { type DemoOrder, claimOwner, formatOrderMoney as money } from "@/lib/demo-orders";
import { nextAction } from "@/lib/order-status";
import { suiDAppKit, SUI_TYPE } from "@/lib/sui-dapp-kit";
import { useWorkspace } from "@/lib/use-workspace";
import { AnimatedAmount, LiftCard } from "@/app/components/motion";

type QueueItem = { key: string; href: string; reference: string; title: string; detail: string; counterparty: string; role: "BUYER" | "SUPPLIER"; value: number; currency: string; status?: string; sample: boolean };

export default function OverviewPage() {
  const workspace = useWorkspace();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    const address = workspace.session?.suiAddress;
    if (!address) { setBalance(null); return; }
    suiDAppKit.getClient("testnet").getBalance({ owner: address, coinType: SUI_TYPE })
      .then((result) => setBalance(Number(result.balance.balance) / 1_000_000_000))
      .catch(() => setBalance(null));
  }, [workspace.session?.suiAddress]);

  const { queue, waiting, ledger } = useMemo(() => {
    const queue: QueueItem[] = workspace.invitations.map((invitation) => ({
      key: `invite-${invitation.orderId}`, href: `/orders/${encodeURIComponent(invitation.orderId)}`, reference: invitation.reference,
      title: "Review and confirm the order", detail: `${invitation.counterpartyName} invited you to ${invitation.invitedRole === "buyer" ? "buy" : "supply"} this order. Delivery ${invitation.deliveryDate}.`,
      counterparty: invitation.counterpartyName, role: invitation.invitedRole === "buyer" ? "BUYER" : "SUPPLIER", value: invitation.value, currency: invitation.currency, status: invitation.invitedRole === "buyer" ? "awaiting_buyer" : "awaiting_supplier", sample: false,
    }));
    const waiting: QueueItem[] = [];
    const isOpen = (order: DemoOrder) => !["settled", "cancelled"].includes(order.status);
    for (const order of workspace.orders) {
      if (!isOpen(order)) continue;
      const action = nextAction(order.status, order.role, { invited: order.source === "backend" ? Boolean(order.invited) : true, claimOwner: claimOwner(order.claim) });
      const item: QueueItem = { key: order.id, href: `/orders/${encodeURIComponent(order.id)}`, reference: order.reference, title: action.title, detail: action.detail, counterparty: order.counterparty, role: order.role, value: order.value, currency: order.currency, status: order.status, sample: order.source === "sample" };
      if (action.owner === "you" && !queue.some((entry) => entry.href === item.href)) queue.push(item);
      else if (action.owner !== "you") waiting.push(item);
    }
    const secured = (role: "BUYER" | "SUPPLIER") => workspace.orders.filter((order) => order.role === role && ["funded", "in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending"].includes(order.status));
    const buying = secured("BUYER");
    const supplying = secured("SUPPLIER");
    const releaseReady = workspace.orders.filter((order) => order.role === "SUPPLIER" && order.status === "settlement_pending");
    return {
      queue, waiting,
      ledger: {
        buying: { value: buying.reduce((sum, order) => sum + order.value, 0), count: buying.length },
        supplying: { value: supplying.reduce((sum, order) => sum + order.value, 0), count: supplying.length },
        release: { value: releaseReady.reduce((sum, order) => sum + (order.inspection?.acceptedValue ?? order.value), 0), count: releaseReady.length },
      },
    };
  }, [workspace.orders, workspace.invitations]);

  return (
    <AppShell active="overview" company={workspace.company} actionCount={queue.length}>
      <PageTitle title="Overview" description={<>{workspace.company}. {queue.length === 0 ? "Nothing needs your action right now." : `${queue.length} ${queue.length === 1 ? "order needs" : "orders need"} your action.`}</>}
        actions={<Button className="btn-primary" asChild><a href="/orders?action=create"><Plus size={15} aria-hidden="true" />New purchase order</a></Button>} />
      {workspace.error && <Notice tone="error">{workspace.error}</Notice>}

      <section className="ledger" aria-label="Money position">
        <LiftCard as="a" className="ledger-cell ledger-wallet" href="/wallet" tilt={2} lift={2}>
          <span className="ledger-icon"><WalletCards size={18} aria-hidden="true" /></span>
          <span className="ledger-label">Available in wallet</span>
          {balance === null ? <strong className="text">Not connected</strong> : <strong><AnimatedAmount value={balance} decimals={2} /> <small>SUI</small></strong>}
          <small>{balance === null ? (workspace.live ? "Sign in with Google or connect a Sui wallet to load the balance." : "Sign in to load your balance.") : "Spendable now. Separate from escrow."}</small>
          <span className="ledger-link">Open wallet<ArrowRight size={13} aria-hidden="true" /></span>
        </LiftCard>
        <div className="ledger-cell">
          <span className="ledger-label">Secured for your purchases<HelpHint text="Total value you have locked in escrow on orders you are buying. Released to suppliers only when you accept delivery or when a claim is settled." /></span>
          <strong><AnimatedAmount value={ledger.buying.value} /> <small>SUI</small></strong>
          <small>{ledger.buying.count} {ledger.buying.count === 1 ? "funded order" : "funded orders"}</small>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Secured for your sales<HelpHint text="Total value buyers have locked in escrow on orders you are supplying. It becomes yours when the buyer accepts delivery." /></span>
          <strong><AnimatedAmount value={ledger.supplying.value} /> <small>SUI</small></strong>
          <small>{ledger.supplying.count} {ledger.supplying.count === 1 ? "funded order" : "funded orders"}</small>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Ready to release to you</span>
          <strong><AnimatedAmount value={ledger.release.value} /> <small>SUI</small></strong>
          <small>{ledger.release.count} {ledger.release.count === 1 ? "settlement" : "settlements"} waiting to be executed</small>
        </div>
      </section>

      <section className="panel" aria-labelledby="queue-title">
        <div className="panel-head">
          <h2 id="queue-title">Needs your action</h2>
          <a className="panel-link" href="/orders?status=action">All orders needing action<ArrowRight size={13} aria-hidden="true" /></a>
        </div>
        {!workspace.ready ? <Skeleton lines={3} /> : queue.length === 0 ? (
          <div className="queue-empty">
            <EmptyArt kind="inbox" />
            <strong>You are up to date</strong>
            <span>New invitations, deliveries to check and shipments to send will appear here.</span>
          </div>
        ) : (
          <ul className="queue">
            {queue.map((item, index) => (
              <li key={item.key} className="row-reveal queue-row-action lift-row" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
                <span className="action-dot" aria-hidden="true" />
                <div className="queue-main">
                  <div className="queue-tags"><RoleTag role={item.role} compact />{item.status && <StatusPill status={item.status} />}{item.sample && <SampleTag />}</div>
                  <strong>{item.title}</strong>
                  <span>{item.reference} with {item.counterparty}. {item.detail}</span>
                </div>
                <div className="queue-side">
                  <strong>{money(item.value)} {item.currency}</strong>
                  <a className="btn btn-primary" href={item.href}>Open order<ArrowRight size={14} aria-hidden="true" /></a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {waiting.length > 0 && (
        <section className="panel panel-quiet" aria-labelledby="waiting-title">
          <div className="panel-head"><h2 id="waiting-title">Waiting on others</h2><a className="panel-link" href="/orders">All orders<ArrowRight size={13} aria-hidden="true" /></a></div>
          <ul className="waiting-list">
            {waiting.slice(0, 6).map((item) => (
              <li key={item.key}>
                <a className="row-link" href={item.href}><strong>{item.reference}</strong></a>
                <span>{item.title}</span>
                {item.status && <StatusPill status={item.status} />}
                <span className="num">{money(item.value)} {item.currency}</span>
              </li>
            ))}
          </ul>
          {waiting.length > 6 && <p className="panel-foot">{waiting.length - 6} more in the order list.</p>}
        </section>
      )}
    </AppShell>
  );
}

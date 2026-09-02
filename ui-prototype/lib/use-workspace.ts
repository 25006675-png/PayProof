"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoOrder } from "@/lib/demo-orders";
import { loadInvitations, loadLiveOrders, type LiveInvitation } from "@/lib/live-orders";
import { loadSession, type DemoSession, type WorkspaceProfile } from "@/lib/payproof-api";
import { loadSampleOrders, resetSampleOrders, samplesHidden, setSamplesHidden, updateSampleOrder } from "@/lib/sample-orders";

export const GUEST_COMPANY = "Your company";

export type Workspace = {
  ready: boolean;
  session: DemoSession | null;
  live: boolean;
  profile?: WorkspaceProfile;
  company: string;
  accountKey: string;
  orders: DemoOrder[];
  liveOrders: DemoOrder[];
  sampleOrders: DemoOrder[];
  invitations: LiveInvitation[];
  error: string;
  hideSamples: boolean;
  setHideSamples: (hidden: boolean) => void;
  resetSamples: () => void;
  updateSample: (id: string, update: (order: DemoOrder) => DemoOrder) => DemoOrder | null;
  replaceLiveOrder: (order: DemoOrder) => void;
  reload: () => Promise<void>;
};

/** Loads live orders for the signed-in account and the account's sample orders. */
export function useWorkspace(): Workspace {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [profile, setProfile] = useState<WorkspaceProfile>();
  const [liveOrders, setLiveOrders] = useState<DemoOrder[]>([]);
  const [sampleOrders, setSampleOrders] = useState<DemoOrder[]>([]);
  const [invitations, setInvitations] = useState<LiveInvitation[]>([]);
  const [error, setError] = useState("");
  const [hideSamples, setHidden] = useState(false);

  const current = session ?? loadSession();
  const accountKey = current?.user.id ?? "guest";
  const company = profile?.primary.organizationName ?? current?.user.name ?? GUEST_COMPANY;

  const reload = useCallback(async () => {
    const active = loadSession();
    setSession(active);
    let orgName = active?.user.name ?? GUEST_COMPANY;
    if (active) {
      try {
        const [live, invited] = await Promise.all([loadLiveOrders(), loadInvitations().catch(() => [])]);
        setLiveOrders(live.orders);
        setProfile(live.profile);
        setInvitations(invited);
        orgName = live.profile.primary.organizationName;
        setError("");
      } catch (cause) {
        setLiveOrders([]);
        setError(cause instanceof Error ? cause.message : "Orders could not be loaded.");
      }
    }
    setHidden(samplesHidden());
    setSampleOrders(loadSampleOrders(active?.user.id ?? "guest", orgName));
    setReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const orders = useMemo(() => hideSamples ? liveOrders : [...liveOrders, ...sampleOrders], [liveOrders, sampleOrders, hideSamples]);

  return {
    ready, session: current, live: Boolean(current), profile, company, accountKey, orders, liveOrders, sampleOrders, invitations, error,
    hideSamples,
    setHideSamples: (hidden) => { setSamplesHidden(hidden); setHidden(hidden); },
    resetSamples: () => setSampleOrders(resetSampleOrders(accountKey, company)),
    updateSample: (id, update) => {
      const updated = updateSampleOrder(accountKey, company, id, update);
      if (updated) setSampleOrders(loadSampleOrders(accountKey, company));
      return updated;
    },
    replaceLiveOrder: (order) => setLiveOrders((currentOrders) => currentOrders.some((item) => item.id === order.id)
      ? currentOrders.map((item) => (item.id === order.id ? order : item))
      : [order, ...currentOrders]),
    reload,
  };
}

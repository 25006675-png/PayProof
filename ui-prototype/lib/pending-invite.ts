"use client";

const KEY = "payproof_pending_invite";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingInvite = { orderId: string; token: string; savedAt: number };

/**
 * The invitation a visitor arrived with, kept while they sign in or sign up so
 * that leaving this page — to the landing page, to Google, or to a new session
 * tomorrow — never strands them away from the order they were invited to.
 */
export function savePendingInvite(orderId: string, token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ orderId, token, savedAt: Date.now() } satisfies PendingInvite));
  } catch {
    // A browser refusing storage still works through the URL it arrived with.
  }
}

export function loadPendingInvite(): PendingInvite | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingInvite;
    if (!pending.orderId || !pending.token || Date.now() - pending.savedAt > MAX_AGE_MS) {
      clearPendingInvite();
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function pendingInviteUrl(pending: PendingInvite): string {
  return `/orders/${encodeURIComponent(pending.orderId)}?invite=${encodeURIComponent(pending.token)}`;
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

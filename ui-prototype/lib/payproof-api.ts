"use client";

export type DemoSession = {
  accessToken: string;
  user: { id: string; email: string; name: string };
  mode: "demo-google" | "supabase";
};

export type TradeLineItem = {
  id: string;
  description: string;
  sku?: string;
  quantity: string;
  unit: string;
  unitPriceUnits: string;
};

export type TradeOrder = {
  id: string;
  reference: string;
  buyerId: string;
  buyerEmail?: string;
  buyerName?: string;
  supplierId?: string;
  supplierEmail: string;
  supplierName: string;
  supplierWalletAddress?: string;
  arbitratorWalletAddress?: string;
  arbitratorId: string;
  assetType: string;
  amountUnits: string;
  orderHash: string;
  description: string;
  deliveryDate: string;
  deliveryLocation: string;
  lineItems: TradeLineItem[];
  status: string;
  inviteId?: string;
  inviteExpiresAt?: string;
  funding?: {
    packageId: string;
    escrowObjectId: string;
    transactionDigest: string;
    buyerAddress: string;
    supplierAddress: string;
    arbitratorAddress: string;
    verificationStatus: "verified_on_chain" | "external_reference";
    fundedAt: string;
  };
  undisputedRelease?: {
    transactionDigest: string;
    verificationStatus: "verified_on_chain" | "external_reference";
    releasedAt: string;
  };
  disputeId?: string;
  settlement?: {
    buyerUnits: string;
    supplierUnits: string;
    transactionDigest?: string;
    receiptObjectId?: string;
    verifiedOnChain: boolean;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Dispute = {
  id: string;
  orderId: string;
  status: string;
  totalEscrowUnits: string;
  disputedUnits: string;
  undisputedReleasedUnits: string;
  requestedBuyerUnits: string;
  evidence: Array<{
    id: string;
    side: "buyer" | "supplier";
    statement: string;
    files: unknown[];
  }>;
  proposals: Array<{
    id: string;
    source: string;
    proposedBy: string;
    proposerSide?: "buyer" | "supplier";
    buyerUnits: string;
    supplierUnits: string;
    summary: string;
    reasoning: string;
    citations: Array<{
      title: string;
      locator: string;
      excerpt: string;
      sourceUrl: string;
    }>;
    evidenceSufficiency?: string;
    legalRelevance?: string;
    acceptances: string[];
    status: string;
  }>;
  mediationRuns: Array<{
    id: string;
    debateRounds: number;
    modelCalls: number;
    buyerFinal?: unknown;
    supplierFinal?: unknown;
    mediatorFinal?: unknown;
    legalContext: Array<{
      title: string;
      locator: string;
      excerpt: string;
      sourceUrl: string;
    }>;
  }>;
  settlement?: {
    buyerUnits: string;
    supplierUnits: string;
    agreementId: string;
    executionStatus: "pending_on_chain" | "verified_on_chain";
    execution?: {
      transactionDigest: string;
      receiptObjectId: string;
      escrowObjectId: string;
      packageId: string;
    };
  };
};

const STORAGE_KEY = "proofpay_demo_session";
const BACKEND_URL = (
  process.env.NEXT_PUBLIC_PAYPROOF_BACKEND_URL || "http://localhost:8787"
).replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function startSupabaseGoogleLogin(): Promise<void> {
  if (!hasSupabaseConfig())
    throw new Error(
      "Supabase Google OAuth is not configured for this frontend build.",
    );
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/workspace` },
  });
  if (error) throw new Error(error.message);
  if (data.url) window.location.assign(data.url);
}

export async function restoreSupabaseSession(): Promise<DemoSession | null> {
  if (!hasSupabaseConfig()) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token || !data.session.user) return null;
  const session: DemoSession = {
    accessToken: data.session.access_token,
    mode: "supabase",
    user: {
      id: data.session.user.id,
      email: data.session.user.email ?? "",
      name: String(
        data.session.user.user_metadata?.full_name ??
          data.session.user.email ??
          "Business user",
      ),
    },
  };
  saveSession(session);
  return session;
}

export function loadSession(): DemoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as DemoSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: DemoSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function signOutSession(): Promise<void> {
  clearSession();
  if (!hasSupabaseConfig()) return;
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  await client.auth.signOut();
}

export async function demoGoogleLogin(
  email: string,
  name: string,
): Promise<DemoSession> {
  const response = await fetch(`${BACKEND_URL}/auth/demo/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as Omit<DemoSession, "mode">;
  const session = { ...payload, mode: "demo-google" as const };
  saveSession(session);
  return session;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  session = loadSession(),
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (session?.accessToken)
    headers.set("authorization", `Bearer ${session.accessToken}`);
  const response = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
    };
    return (
      payload.message || payload.error || `Request failed (${response.status})`
    );
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function backendUrl(): string {
  return BACKEND_URL;
}

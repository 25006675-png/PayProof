"use client";

import { createClient } from "@supabase/supabase-js";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  generateNonce,
  generateRandomness,
  ZkLoginSigner,
  type ZkLoginSignatureInputs,
} from "@mysten/sui/zklogin";
import { suiDAppKit } from "@/lib/sui-dapp-kit";
import { backendUrl, saveSession, type DemoSession } from "@/lib/payproof-api";

const PENDING_KEY = "payproof_zklogin_pending";
const ZKLOGIN_KEY = "payproof_zklogin_session";

type PendingZkLogin = {
  state: string;
  ephemeralSecretKey: string;
  ephemeralPublicKey: string;
  randomness: string;
  maxEpoch: number;
  returnTo: string;
};

export type ZkLoginSession = {
  address: string;
  ephemeralSecretKey: string;
  maxEpoch: number;
  inputs: ZkLoginSignatureInputs;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim();

function supabase() {
  if (!supabaseUrl || !supabaseKey)
    throw new Error("Supabase authentication is not configured for this build.");
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export function hasGoogleZkLoginConfig(): boolean {
  return Boolean(supabaseUrl && supabaseKey && googleClientId);
}

export async function beginGoogleZkLogin(returnTo = "/workspace"): Promise<void> {
  if (!googleClientId)
    throw new Error("Google zkLogin is not configured for this build.");
  const client = suiDAppKit.getClient("testnet");
  const state = crypto.randomUUID();
  const ephemeral = Ed25519Keypair.generate();
  const randomness = generateRandomness();
  const system = await client.core.getCurrentSystemState();
  const maxEpoch = Number(system.systemState.epoch) + 2;
  const nonce = generateNonce(ephemeral.getPublicKey(), maxEpoch, randomness);
  const pending: PendingZkLogin = {
    state,
    ephemeralSecretKey: ephemeral.getSecretKey(),
    ephemeralPublicKey: ephemeral.getPublicKey().toBase64(),
    randomness,
    maxEpoch,
    returnTo: returnTo.startsWith("/") ? returnTo : "/workspace",
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    state,
    prompt: "select_account",
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

function pendingLogin(): PendingZkLogin {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) throw new Error("This Google sign-in request has expired. Start again from PayProof.");
  return JSON.parse(raw) as PendingZkLogin;
}

export async function completeGoogleZkLogin(hash: string): Promise<string> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) throw new Error(providerError);
  const idToken = params.get("id_token");
  const state = params.get("state");
  const pending = pendingLogin();
  if (!idToken || !state || state !== pending.state)
    throw new Error("Google returned an invalid or mismatched sign-in response.");

  // The Google ID token carries Sui's nonce. Supabase validates the token's
  // signature, issuer and audience here; nonce binding is independently and
  // authoritatively checked by the PayProof zkLogin backend.
  const { data, error } = await supabase().auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error || !data.session) {
    if (error?.message.includes("nonce in id_token")) {
      throw new Error(
        "Google reached PayProof, but Supabase nonce checking is still enabled. In Supabase, open Authentication > Providers > Google and enable Skip nonce check, then try again.",
      );
    }
    throw new Error(error?.message ?? "Supabase could not create the PayProof session.");
  }

  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/v1/auth/zklogin/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({
        googleIdToken: idToken,
        ephemeralPublicKey: pending.ephemeralPublicKey,
        randomness: pending.randomness,
        maxEpoch: pending.maxEpoch,
      }),
    });
  } catch {
    throw new Error(
      "Google sign-in succeeded, but the PayProof service is unavailable. Start the backend on port 8787, then return to sign in and try again.",
    );
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message ?? `zkLogin setup failed (${response.status}).`);
  }
  const completed = await response.json() as {
    address: string;
    maxEpoch: number;
    inputs: ZkLoginSignatureInputs;
  };
  const zkSession: ZkLoginSession = {
    ...completed,
    ephemeralSecretKey: pending.ephemeralSecretKey,
  };
  sessionStorage.setItem(ZKLOGIN_KEY, JSON.stringify(zkSession));
  sessionStorage.removeItem(PENDING_KEY);
  const appSession: DemoSession = {
    accessToken: data.session.access_token,
    mode: "supabase",
    suiAddress: completed.address,
    user: {
      id: data.session.user.id,
      email: data.session.user.email ?? "",
      name: String(data.session.user.user_metadata?.full_name ?? data.session.user.email ?? "Business user"),
    },
  };
  saveSession(appSession);
  history.replaceState(null, "", window.location.pathname);
  return pending.returnTo;
}

export function loadZkLoginSession(): ZkLoginSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ZKLOGIN_KEY);
    return raw ? JSON.parse(raw) as ZkLoginSession : null;
  } catch {
    return null;
  }
}

/** A zkLogin proof is minted for a fixed maxEpoch and stops verifying once the chain passes it.
 *  Signing with an expired session fails with "Invalid user signature: General cryptographic error". */
export async function zkLoginSessionExpired(session: ZkLoginSession): Promise<boolean> {
  try {
    const system = await suiDAppKit.getClient("testnet").core.getCurrentSystemState();
    return Number(system.systemState.epoch) > session.maxEpoch;
  } catch {
    // If the epoch cannot be read, let the transaction attempt decide rather than blocking it.
    return false;
  }
}

export function clearZkLoginSession(): void {
  sessionStorage.removeItem(PENDING_KEY);
  sessionStorage.removeItem(ZKLOGIN_KEY);
}

export function zkLoginSigner(session: ZkLoginSession): ZkLoginSigner {
  return new ZkLoginSigner({
    ephemeralSigner: Ed25519Keypair.fromSecretKey(session.ephemeralSecretKey),
    maxEpoch: session.maxEpoch,
    inputs: session.inputs,
    legacyAddress: false,
    address: session.address,
  });
}

export async function authenticateConnectedWallet(input: {
  address: string;
  sign: (message: Uint8Array) => Promise<{ signature: string }>;
}): Promise<DemoSession> {
  const challengeResponse = await fetch(`${backendUrl()}/auth/wallet/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: input.address }),
  });
  if (!challengeResponse.ok)
    throw new Error(`Could not create a wallet sign-in request (${challengeResponse.status}).`);
  const challenge = await challengeResponse.json() as { id: string; message: string };
  const { signature } = await input.sign(new TextEncoder().encode(challenge.message));
  const verifyResponse = await fetch(`${backendUrl()}/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.id, address: input.address, signature }),
  });
  if (!verifyResponse.ok) {
    const payload = await verifyResponse.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message ?? `Wallet verification failed (${verifyResponse.status}).`);
  }
  const verified = await verifyResponse.json() as {
    accessToken: string;
    account: { id: string; verifiedSuiAddress: string };
  };
  const session: DemoSession = {
    accessToken: verified.accessToken,
    mode: "wallet",
    suiAddress: verified.account.verifiedSuiAddress,
    user: { id: verified.account.id, email: "", name: "Sui wallet user" },
  };
  saveSession(session);
  return session;
}

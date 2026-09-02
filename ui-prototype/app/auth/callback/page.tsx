"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";
import { completeGoogleZkLogin } from "@/lib/auth";
import { clearPendingInvite, loadPendingInvite, pendingInviteUrl } from "@/lib/pending-invite";

/**
 * A visitor who started at an invitation should land back on it even when they
 * signed in from somewhere else entirely; anything already carrying an invite
 * is left alone.
 */
function resumeTarget(returnTo: string): string {
  if (returnTo.includes("invite=")) return returnTo;
  const pending = loadPendingInvite();
  if (!pending) return returnTo;
  clearPendingInvite();
  return pendingInviteUrl(pending);
}

export default function GoogleAuthCallback() {
  const router = useRouter();
  const [error, setError] = useState("");
  const completionStarted = useRef(false);

  useEffect(() => {
    if (completionStarted.current) return;
    completionStarted.current = true;
    void completeGoogleZkLogin(window.location.hash)
      .then((returnTo) => router.replace(resumeTarget(returnTo)))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Google sign-in could not be completed."));
  }, [router]);

  return (
    <main className="auth-callback-shell">
      <section className="auth-callback-panel" aria-live="polite">
        {error ? <CircleAlert className="auth-callback-error-icon" aria-hidden="true" /> : <LoaderCircle className="auth-callback-spinner" aria-hidden="true" />}
        <h1>{error ? "Sign-in needs attention" : "Creating your PayProof account"}</h1>
        <p>{error || "Verifying Google, deriving your Sui address and preparing transaction signing."}</p>
        {error ? <a href="/#access">Return to sign in</a> : <span><ShieldCheck size={15} /> No password or wallet seed is stored by PayProof.</span>}
      </section>
    </main>
  );
}

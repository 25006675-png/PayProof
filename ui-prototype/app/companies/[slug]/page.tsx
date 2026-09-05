"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Logo, Notice, Skeleton } from "@/app/components/app-shell";
import { TrustProfileView } from "@/app/components/trust-profile";
import { loadPublicTrustProfile, type OrganizationTrustProfile } from "@/lib/payproof-api";

export default function PublicTrustPage() {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<OrganizationTrustProfile>();
  const [error, setError] = useState("");
  useEffect(() => { if (slug) loadPublicTrustProfile(slug).then(setProfile).catch((cause) => setError(cause instanceof Error ? cause.message : "This trust profile is not available.")); }, [slug]);
  return <div className="public-trust-shell"><header><Logo /><span>Verified company activity</span></header><main>{error ? <Notice tone="error">{error}</Notice> : profile ? <TrustProfileView profile={profile} /> : <section className="panel"><Skeleton lines={6} /></section>}</main><footer>ProofPay publishes transaction-derived facts only. Commercial records remain private.</footer></div>;
}

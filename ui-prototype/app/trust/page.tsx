"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { AppShell, Notice, PageTitle, Skeleton } from "@/app/components/app-shell";
import { TrustProfileView } from "@/app/components/trust-profile";
import { Button } from "@/components/ui/button";
import { loadTrustProfile, setTrustProfilePublished, type OrganizationTrustProfile } from "@/lib/payproof-api";
import { useWorkspace } from "@/lib/use-workspace";

export default function TrustSettingsPage() {
  const workspace = useWorkspace();
  const [profile, setProfile] = useState<OrganizationTrustProfile>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!workspace.profile?.primary.organizationId) return;
    loadTrustProfile(workspace.profile.primary.organizationId).then(setProfile).catch((cause) => setError(cause instanceof Error ? cause.message : "The trust profile could not be loaded."));
  }, [workspace.profile?.primary.organizationId]);
  const update = async (published: boolean) => {
    if (!profile) return;
    setSaving(true); setError("");
    try { setProfile(await setTrustProfilePublished(profile.organizationId, published)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The publishing setting could not be changed."); }
    finally { setSaving(false); }
  };
  const publicUrl = profile && typeof window !== "undefined" ? `${window.location.origin}/companies/${profile.slug}` : "";
  return (
    <AppShell active="none" company={workspace.company}>
      <PageTitle title="Trust profile" description="Publish verified company activity without exposing commercial records." actions={profile && (
        <Button className={profile.published ? "" : "btn-primary"} variant={profile.published ? "outline" : "default"} disabled={saving} onClick={() => void update(!profile.published)}>{saving ? "Saving" : profile.published ? "Unpublish profile" : "Publish profile"}</Button>
      )} />
      {error && <Notice tone="error">{error}</Notice>}
      {!profile ? <section className="panel"><Skeleton lines={5} /></section> : <>
        <section className="panel trust-publish">
          <div><strong>{profile.published ? "Profile is shareable" : "Profile is private"}</strong><span>{profile.published ? "Anyone with the link can view the verified summary." : "Only company owners and admins can preview it."}</span></div>
          {profile.published && <div className="trust-link"><code>{publicUrl}</code><Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(publicUrl); setCopied(true); }}><Copy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy profile link"}</Button><Button variant="outline" size="sm" asChild><a href={publicUrl} target="_blank" rel="noreferrer">Open profile<ExternalLink size={14} aria-hidden="true" /></a></Button></div>}
        </section>
        <TrustProfileView profile={profile} />
      </>}
    </AppShell>
  );
}

"use client";

import { CheckCircle2 } from "lucide-react";
import type { OrganizationTrustProfile, TrustRoleSummary } from "@/lib/payproof-api";

function RoleFacts({ title, facts }: { title: string; facts: TrustRoleSummary }) {
  return (
    <section className="trust-role" aria-labelledby={`trust-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="trust-role-head">
        <h2 id={`trust-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h2>
        <span>{facts.fundedOrders} verified {facts.fundedOrders === 1 ? "order" : "orders"}</span>
      </div>
      <dl className="trust-facts">
        <div><dt>Funded orders</dt><dd>{facts.fundedOrders}</dd></div>
        <div><dt>Settled on Sui</dt><dd>{facts.settledOrders}</dd></div>
        <div><dt>Orders with disputes</dt><dd>{facts.disputes}</dd></div>
        <div><dt>Deadline closures</dt><dd>{facts.deadlineClosures}</dd></div>
        <div><dt>Dispute-free completion</dt><dd>{facts.disputeFreeRate === undefined ? "Shown after 5 settlements" : `${facts.disputeFreeRate}%`}</dd></div>
        <div><dt>Dispute resolution</dt><dd>{facts.disputeResolutionRate === undefined ? "Shown after 5 disputes" : `${facts.disputeResolutionRate}%`}</dd></div>
      </dl>
    </section>
  );
}

export function TrustProfileView({ profile }: { profile: OrganizationTrustProfile }) {
  return (
    <div className="trust-profile">
      <header className="trust-identity">
        <span className="trust-verified"><CheckCircle2 size={16} aria-hidden="true" />Verified PayProof organization</span>
        <h1>{profile.name}</h1>
        <p>{profile.newOnPayProof ? "New on PayProof. Counts are shown now; rates appear when enough verified history exists." : "Activity below is calculated from confirmed, on-chain-verified orders."}</p>
        <dl>
          {profile.organizationCreatedAt && <div><dt>Organization since</dt><dd>{new Date(profile.organizationCreatedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</dd></div>}
          {profile.publishedAt && <div><dt>Profile published</dt><dd>{new Date(profile.publishedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</dd></div>}
        </dl>
      </header>
      <div className="trust-roles">
        <RoleFacts title="As supplier" facts={profile.supplier} />
        <RoleFacts title="As buyer" facts={profile.buyer} />
      </div>
      <p className="trust-privacy">No order values, counterparties, references, wallet addresses, or evidence are included in this profile.</p>
    </div>
  );
}

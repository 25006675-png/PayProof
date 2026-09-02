import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { renderMarkdown } from "@/lib/markdown";

const DOCUMENTS = {
  terms: { file: "terms-of-service.md", title: "Platform Terms of Service" },
  "dispute-policy": { file: "dispute-policy.md", title: "Dispute Resolution Policy" },
} as const;

type Slug = keyof typeof DOCUMENTS;

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = DOCUMENTS[doc as Slug];
  return { title: entry ? `ProofPay · ${entry.title}` : "ProofPay" };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = DOCUMENTS[doc as Slug];
  if (!entry) notFound();
  // docs/ is the canonical copy for both the product and the dispute engine.
  const source = await readFile(path.join(process.cwd(), "..", "docs", entry.file), "utf8");

  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a className="logo" href="/">
          <span className="logo-mark brand-logo-mark">
            <img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" />
          </span>
          <span>ProofPay</span>
        </a>
        <nav className="legal-nav">
          <a className={doc === "terms" ? "legal-nav-active" : ""} href="/legal/terms">Terms of Service</a>
          <a className={doc === "dispute-policy" ? "legal-nav-active" : ""} href="/legal/dispute-policy">Dispute Policy</a>
        </nav>
      </header>
      <main className="legal-main">
        <article className="legal-document" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
      </main>
    </div>
  );
}

"use client";

import { useState } from "react";
import { FileText, Paperclip, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsentDialog, EmptyArt, FileField, HelpHint, Notice } from "@/app/components/app-shell";
import { type DemoOrder, type DocumentKind, type ExtractedPurchaseOrder, type OrderDocument, formatOrderMoney as money, sha256Hex } from "@/lib/demo-orders";
import type { EvidenceFileInput } from "@/lib/dispute-actions";
import { openOrderDocument, uploadOrderDocument } from "@/lib/live-orders";
import { withExtras } from "@/lib/local-order-extras";
import { addSampleDocument } from "@/lib/sample-orders";

export const documentLabels: Record<DocumentKind, string> = {
  internal_agreement: "Internal agreement",
  purchase_order: "Purchase order document",
  dispatch_evidence: "Dispatch evidence",
  delivery_evidence: "Delivery evidence",
  inspection_evidence: "Inspection evidence",
  claim_evidence: "Claim evidence",
};

export async function extractPurchaseOrder(file: File): Promise<ExtractedPurchaseOrder> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/extract-po", { method: "POST", body });
  const payload = (await response.json()) as ExtractedPurchaseOrder & { message?: string };
  if (!response.ok) throw new Error(payload.message || "The document could not be read.");
  return payload;
}

/** Reads an evidence file into plain text for the claim record and the AI mediator. */
export async function transcribeEvidence(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", "transcript");
  const response = await fetch("/api/extract-po", { method: "POST", body });
  const payload = (await response.json()) as { transcript?: string; documentType?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || "The evidence file could not be read.");
  return `${payload.documentType ? `[${payload.documentType}] ` : ""}${payload.transcript ?? ""}`.trim();
}

export async function buildDocument(file: File, kind: DocumentKind, uploadedBy: "BUYER" | "SUPPLIER", extracted?: ExtractedPurchaseOrder, transcript?: string): Promise<OrderDocument> {
  return { id: crypto.randomUUID(), kind, name: file.name, size: file.size, sha256: await sha256Hex(file), uploadedAt: new Date().toISOString(), uploadedBy, extracted, transcript };
}

/** Signs the file's SHA-256 into the order's escrow and returns the transaction digest. */
export type Anchor = (sha256: string, kind: DocumentKind) => Promise<string>;

/**
 * Attach a file to an order. Live orders upload to the backend so both parties
 * can open the file; sample orders keep it in the browser. With an `anchor`, a
 * funded live order first binds the file's hash to the escrow on Sui.
 */
export async function attachFile(order: DemoOrder, file: File, kind: DocumentKind, role: "BUYER" | "SUPPLIER", extras: { transcript?: string; extracted?: ExtractedPurchaseOrder; anchorTransactionDigest?: string } = {}, anchor?: Anchor): Promise<DemoOrder> {
  if (order.source === "backend") {
    let anchorTransactionDigest = extras.anchorTransactionDigest;
    if (!anchorTransactionDigest && anchor && order.funding) anchorTransactionDigest = await anchor(await sha256Hex(file), kind);
    return withExtras(await uploadOrderDocument(order.id, file, kind, { ...extras, anchorTransactionDigest }));
  }
  return addSampleDocument(order, await buildDocument(file, kind, role, extras.extracted, extras.transcript));
}

/** Transcribes and attaches an evidence file, returning the updated order and the record the claim endpoints expect. */
export async function prepareEvidence(order: DemoOrder, file: File, role: "BUYER" | "SUPPLIER", anchor?: Anchor): Promise<{ order: DemoOrder; input: EvidenceFileInput }> {
  const transcript = await transcribeEvidence(file).catch(() => undefined);
  const next = await attachFile(order, file, "claim_evidence", role, { transcript }, anchor);
  const sha256 = await sha256Hex(file);
  const stored = next.documents.find((document) => document.sha256 === sha256);
  return { order: next, input: { storagePath: stored?.storagePath ?? `browser://${sha256}`, sha256, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, transcript } };
}

export function DocumentLink({ order, document }: { order: DemoOrder; document: OrderDocument }) {
  const [error, setError] = useState("");
  if (document.url) return <a href={document.url} target="_blank" rel="noreferrer">{document.name}</a>;
  if (!document.remote) return <span className="muted" title="Kept in this browser only">{document.name}</span>;
  return (
    <>
      <button type="button" onClick={() => openOrderDocument(order.id, document.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not open"))}>{document.name}</button>
      {error && <small className="form-error">{error}</small>}
    </>
  );
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Match each extracted line to an order line by description overlap. */
export function compareLines(order: DemoOrder, extracted: ExtractedPurchaseOrder) {
  return order.items.map((item) => {
    const words = normalise(item.description).split(" ").filter((word) => word.length > 2);
    let best: { line: ExtractedPurchaseOrder["lines"][number]; score: number } | null = null;
    for (const line of extracted.lines) {
      const target = normalise(line.description);
      const score = words.filter((word) => target.includes(word)).length / Math.max(words.length, 1);
      if (score > 0.4 && (!best || score > best.score)) best = { line, score };
    }
    const matched = best?.line ?? null;
    return { item, matched, quantityMatches: matched ? matched.quantity === item.quantity : false, priceMatches: matched ? matched.unitPrice === null || Math.abs(matched.unitPrice - item.unitPrice) < 0.005 : false };
  });
}

export function ExtractionComparison({ order, document, onClose }: { order: DemoOrder; document: OrderDocument; onClose?: () => void }) {
  const extracted = document.extracted;
  if (!extracted) return null;
  const comparison = compareLines(order, extracted);
  const mismatches = comparison.filter((entry) => !entry.matched || !entry.quantityMatches || !entry.priceMatches).length;
  return (
    <div className="extraction" role="region" aria-label="Purchase order comparison">
      <div className="extraction-head">
        <div>
          <strong>{mismatches === 0 ? "The document matches this order" : `${mismatches} ${mismatches === 1 ? "line differs" : "lines differ"} from this order`}</strong>
          <small>Read from {document.name}{extracted.reference ? `, reference ${extracted.reference}` : ""}. Check any difference before you confirm.</small>
        </div>
        {onClose && <Button variant="outline" size="sm" onClick={onClose}>Close</Button>}
      </div>
      <table className="data-table">
        <thead><tr><th>Order line</th><th>On this order</th><th>In the document</th><th>Result</th></tr></thead>
        <tbody>
          {comparison.map(({ item, matched, quantityMatches, priceMatches }) => (
            <tr key={item.id}>
              <td><strong>{item.description}</strong>{matched && matched.description !== item.description && <small>Read as {matched.description}</small>}</td>
              <td>{money(item.quantity)} {item.unit}<small>{money(item.unitPrice)} {order.currency} each</small></td>
              <td>{matched ? <>{money(matched.quantity)} {matched.unit}<small>{matched.unitPrice === null ? "No unit price" : `${money(matched.unitPrice)} each`}</small></> : <span className="muted">Not found</span>}</td>
              <td>{!matched ? <span className="pill pill-attention">Missing</span> : quantityMatches && priceMatches ? <span className="pill pill-success">Matches</span> : <span className="pill pill-danger">{quantityMatches ? "Price differs" : "Quantity differs"}</span>}</td>
            </tr>
          ))}
          {extracted.lines.filter((line) => !comparison.some((entry) => entry.matched === line)).map((line, index) => (
            <tr key={`extra-${index}`}>
              <td><span className="muted">Not on this order</span></td>
              <td><span className="muted">0</span></td>
              <td>{money(line.quantity)} {line.unit}<small>{line.description}</small></td>
              <td><span className="pill pill-attention">Extra line</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {extracted.warnings.length > 0 && <ul className="extraction-warnings">{extracted.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </div>
  );
}

/** Read-only list of everything attached to the order, with one secondary way to add more. */
export function DocumentsPanel({ order, role, company, onOrderChange, busy }: { order: DemoOrder; role: "BUYER" | "SUPPLIER"; company: string; onOrderChange: (order: DemoOrder) => void; busy?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<DocumentKind>("internal_agreement");
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showing, setShowing] = useState<OrderDocument | null>(null);

  const confirm = async () => {
    if (!file) return;
    setWorking(true);
    setError("");
    try {
      const extracted = kind === "purchase_order" ? await extractPurchaseOrder(file) : undefined;
      const next = await attachFile(order, file, kind, role, { extracted });
      onOrderChange(next);
      setAdding(false);
      setFile(null);
      if (extracted) setShowing(next.documents.find((document) => document.extracted && document.name === file.name) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be attached.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="documents-title">
      <div className="panel-head">
        <h2 id="documents-title">Documents<HelpHint text="Files stay between the two parties. Only a SHA-256 fingerprint of each file is kept with the order record, so either side can later prove a file was not altered." /></h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setError(""); setFile(null); setAdding(true); }}><Paperclip size={14} aria-hidden="true" />Add document</Button>
      </div>
      {order.documents.length === 0 ? (
        <div className="panel-illustrated">
          <EmptyArt kind="documents" />
          <div><strong>Nothing attached yet</strong><span>The purchase order file, the internal agreement and any evidence you attach along the way appear here.</span></div>
        </div>
      ) : (
        <ul className="document-list">
          {order.documents.map((document) => (
            <li key={document.id}>
              <FileText size={16} aria-hidden="true" />
              <div>
                <strong>{document.name}</strong>
                <small>{documentLabels[document.kind]}, {(document.size / 1024).toFixed(0)} KB, added by {document.uploadedBy === "BUYER" ? order.buyer : order.supplier} on {new Date(document.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small>
                <code title="SHA-256 fingerprint">{document.sha256.slice(0, 16)}</code>
              </div>
              <div className="document-actions">
                {document.url && <Button variant="outline" size="sm" asChild><a href={document.url} target="_blank" rel="noreferrer">View</a></Button>}
                {!document.url && document.remote && <Button variant="outline" size="sm" onClick={() => openOrderDocument(order.id, document.id).catch((cause) => setError(cause instanceof Error ? cause.message : "The document could not be opened."))}>View</Button>}
                {document.extracted && <Button variant="outline" size="sm" onClick={() => setShowing(showing?.id === document.id ? null : document)}><ScanSearch size={14} aria-hidden="true" />{showing?.id === document.id ? "Hide comparison" : "Compare with order"}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {showing && <ExtractionComparison order={order} document={showing} onClose={() => setShowing(null)} />}
      {error && !adding && <Notice tone="error">{error}</Notice>}

      <ConsentDialog open={adding} onOpenChange={setAdding} company={company}
        title="Add a document"
        description="Attach a file to this order. Purchase order files are read once so their quantities can be checked against the order."
        clauses={["The document is genuine, unaltered and relates to this order.", "You are authorised by your company to share it with the other party.", "Only the file fingerprint is kept with the order record. The file itself is not published to Sui."]}
        confirmLabel={kind === "purchase_order" ? "Attach and read quantities" : "Attach document"} busy={working} onConfirm={confirm}>
        <label className="field"><span>Document type</span>
          <select className="select" value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)}>
            <option value="internal_agreement">Internal agreement</option>
            <option value="purchase_order">Purchase order document</option>
            <option value="dispatch_evidence">Dispatch evidence</option>
            <option value="delivery_evidence">Delivery evidence</option>
            <option value="inspection_evidence">Inspection evidence</option>
          </select>
        </label>
        <FileField label="Choose the file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" onFile={setFile} file={file} />
        {error && <Notice tone="error">{error}</Notice>}
      </ConsentDialog>
    </section>
  );
}

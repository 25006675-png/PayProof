import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface CorpusSource {
  id: string;
  kind: "statute" | "judgment";
  title: string;
  file: string;
  sourceUrl: string;
  notes?: string;
  court?: string;
  caseNumber?: string;
}

export interface LegalPassage {
  id: string;
  sourceId: string;
  title: string;
  locator: string;
  sourceUrl: string;
  text: string;
  kind?: "statute" | "judgment";
  score?: number;
}

export interface LegalRetriever {
  retrieve(query: string, limit?: number): Promise<LegalPassage[]>;
}

export async function loadCorpus(corpusDir: string): Promise<LegalPassage[]> {
  const manifest = JSON.parse(await readFile(path.join(corpusDir, "manifest.json"), "utf8")) as { sources: CorpusSource[] };
  const passages: LegalPassage[] = [];
  for (const source of manifest.sources) {
    const text = await readFile(path.join(corpusDir, source.file), "utf8");
    for (const [index, chunk] of chunkDocument(text).entries()) {
      const paragraph = source.kind === "judgment" ? chunk.match(/^\[(\d+)\]/m)?.[1] : undefined;
      const section = source.kind === "statute" ? chunk.match(/^(\d+[A-Z]?)\.\s+[^\n]+/m)?.[0] : undefined;
      const locator = paragraph ? `paragraph ${paragraph}` : section ? section.slice(0, 160) : `${source.kind === "judgment" ? "judgment" : "statute"} chunk ${index + 1}`;
      passages.push({
        id: toUuid(createHash("sha256").update(`${source.id}:${index}:${chunk}`).digest("hex")),
        sourceId: source.id, title: source.title, locator, sourceUrl: source.sourceUrl, text: chunk, kind: source.kind,
      });
    }
  }
  return passages;
}

function toUuid(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function chunkDocument(text: string, targetChars = 1800, overlapParagraphs = 1): string[] {
  const paragraphs = text.replace(/\r/g, "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const paragraph of paragraphs) {
    if (current.length && size + paragraph.length > targetChars) {
      chunks.push(current.join("\n\n"));
      current = current.slice(-overlapParagraphs);
      size = current.reduce((sum, item) => sum + item.length, 0);
    }
    current.push(paragraph);
    size += paragraph.length;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

const STOP = new Set(["the", "and", "for", "that", "with", "from", "this", "was", "are", "were", "has", "have", "into"]);
function terms(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((term) => !STOP.has(term)) ?? [];
}

export class LocalLegalRetriever implements LegalRetriever {
  constructor(private readonly passages: LegalPassage[]) {}
  async retrieve(query: string, limit = 8): Promise<LegalPassage[]> {
    const queryTerms = new Set(terms(query));
    return this.passages
      .map((passage) => {
        const bodyTerms = terms(passage.text);
        const hits = bodyTerms.reduce((sum, term) => sum + (queryTerms.has(term) ? 1 : 0), 0);
        const phraseBonus = [...queryTerms].reduce((sum, term) => sum + (passage.text.toLowerCase().includes(term) ? 2 : 0), 0);
        return { ...passage, score: hits + phraseBonus };
      })
      .filter((passage) => (passage.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }
}

export function isSubstantiveLegalPassage(passage: LegalPassage): boolean {
  const normalized = passage.text.replace(/\s+/g, " ").trim();
  if (normalized.length < 180) return false;
  if (/arrangement of sections/i.test(normalized) || /\.{4,}\s*\d+/.test(normalized)) return false;
  const numberedLines = passage.text.match(/^\s*\d+[A-Z]?\.\s+/gm)?.length ?? 0;
  if (/^\s*section\s*$/im.test(passage.text) && numberedLines >= 8) return false;
  return true;
}

/**
 * Preserve semantic ranking while guaranteeing source diversity when the candidate
 * set contains it. This prevents one long statute from crowding out remedies and
 * precedent merely because it has more near-duplicate chunks.
 */
export function balanceLegalPassages(candidates: LegalPassage[], limit = 8): LegalPassage[] {
  const ranked = candidates.filter(isSubstantiveLegalPassage).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const bySource = new Map<string, LegalPassage[]>();
  for (const passage of ranked) {
    const group = bySource.get(passage.sourceId) ?? [];
    group.push(passage);
    bySource.set(passage.sourceId, group);
  }
  const result: LegalPassage[] = [];
  const sources = [...bySource.keys()].sort((a, b) => ((bySource.get(b)?.[0]?.score ?? 0) - (bySource.get(a)?.[0]?.score ?? 0)));
  let depth = 0;
  while (result.length < limit) {
    let added = false;
    for (const source of sources) {
      const candidate = bySource.get(source)?.[depth];
      if (candidate && result.length < limit) {
        result.push(candidate);
        added = true;
      }
    }
    if (!added) break;
    depth += 1;
  }
  return result;
}

export async function selectRelevantLegalPassages(passages: LegalPassage[], perQuery = 10): Promise<LegalPassage[]> {
  const retriever = new LocalLegalRetriever(passages);
  const queries = [
    "sale by description conformity quality fitness purpose merchantable examination inspection defects acceptance rejection buyer seller",
    "compensation loss damage breach contract naturally arose mitigation remote remedy refund price",
    "Puncak Niaga NZ Wheels defective goods acceptable quality entitled reject repair evidence",
  ];
  const selected = new Map<string, LegalPassage>();
  for (const query of queries) {
    for (const passage of await retriever.retrieve(query, perQuery * 2)) {
      if (isSubstantiveLegalPassage(passage)) selected.set(passage.id, passage);
    }
  }
  return balanceLegalPassages([...selected.values()], 25);
}

export async function corpusFiles(corpusDir: string): Promise<string[]> {
  return (await readdir(corpusDir)).filter((name) => name.endsWith(".md"));
}

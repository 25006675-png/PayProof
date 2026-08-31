import { balanceLegalPassages, type LegalPassage, type LegalRetriever } from "../rag/legal-rag.js";
import type { GeminiEmbedder } from "./gemini.js";

export class QdrantLegalIndex implements LegalRetriever {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly collection: string,
    private readonly embedder: GeminiEmbedder,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init?: RequestInit) {
    const response = await this.fetcher(`${this.url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "api-key": this.apiKey, ...init?.headers },
    });
    if (!response.ok) throw new Error(`Qdrant request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<any>;
  }

  async ensureCollection(): Promise<void> {
    const check = await this.fetcher(`${this.url.replace(/\/$/, "")}/collections/${this.collection}`, { headers: { "api-key": this.apiKey } });
    if (check.status === 404) {
      await this.request(`/collections/${this.collection}`, { method: "PUT", body: JSON.stringify({ vectors: { size: 768, distance: "Cosine" } }) });
    } else if (!check.ok) throw new Error(`Qdrant collection check failed (${check.status})`);
  }

  async upsert(passages: LegalPassage[]): Promise<void> {
    await this.ensureCollection();
    for (let offset = 0; offset < passages.length; offset += 4) {
      const batch = passages.slice(offset, offset + 4);
      const vectors = await this.embedder.embedMany(batch.map((passage) => passage.text));
      const points = batch.map((passage, index) => ({ id: passage.id, vector: vectors[index], payload: passage }));
      await this.request(`/collections/${this.collection}/points?wait=true`, { method: "PUT", body: JSON.stringify({ points }) });
      if (offset + 4 < passages.length) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  private async pointIds(): Promise<string[]> {
    const ids: string[] = [];
    let offset: string | number | undefined;
    do {
      const result = await this.request(`/collections/${this.collection}/points/scroll`, {
        method: "POST",
        body: JSON.stringify({ limit: 256, offset, with_payload: false, with_vector: false }),
      });
      ids.push(...(result.result?.points ?? []).map((point: { id: string | number }) => String(point.id)));
      offset = result.result?.next_page_offset;
    } while (offset !== undefined && offset !== null);
    return ids;
  }

  /** Replace the curated set semantically: stale passages are deleted before new vectors are upserted. */
  async synchronize(passages: LegalPassage[]): Promise<{ total: number; upserted: number; retained: number; deleted: number }> {
    await this.ensureCollection();
    const desired = new Set(passages.map((passage) => passage.id));
    const existing = new Set(await this.pointIds());
    const stale = [...existing].filter((id) => !desired.has(id));
    const missing = passages.filter((passage) => !existing.has(passage.id));
    // Upsert first: if embedding or Qdrant fails, the previously usable index remains intact.
    await this.upsert(missing);
    for (let offset = 0; offset < stale.length; offset += 256) {
      await this.request(`/collections/${this.collection}/points/delete?wait=true`, {
        method: "POST",
        body: JSON.stringify({ points: stale.slice(offset, offset + 256) }),
      });
    }
    return { total: passages.length, upserted: missing.length, retained: passages.length - missing.length, deleted: stale.length };
  }

  async retrieve(query: string, limit = 8): Promise<LegalPassage[]> {
    const vector = await this.embedder.embed(query);
    const candidateLimit = Math.max(limit * 4, 24);
    const body = await this.request(`/collections/${this.collection}/points/query`, {
      method: "POST", body: JSON.stringify({ query: vector, limit: candidateLimit, with_payload: true }),
    });
    const candidates = (body.result?.points ?? []).map((point: any) => ({ ...point.payload, score: point.score })) as LegalPassage[];
    return balanceLegalPassages(candidates, limit);
  }
}

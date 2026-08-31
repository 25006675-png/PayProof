import type { LegalPassage, LegalRetriever } from "../rag/legal-rag.js";
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

  async retrieve(query: string, limit = 8): Promise<LegalPassage[]> {
    const vector = await this.embedder.embed(query);
    const body = await this.request(`/collections/${this.collection}/points/query`, {
      method: "POST", body: JSON.stringify({ query: vector, limit, with_payload: true }),
    });
    return (body.result?.points ?? []).map((point: any) => ({ ...point.payload, score: point.score })) as LegalPassage[];
  }
}

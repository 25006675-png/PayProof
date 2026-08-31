import { describe, expect, it } from "vitest";
import { QdrantLegalIndex } from "../src/integrations/qdrant.js";
import type { LegalPassage } from "../src/rag/legal-rag.js";

const passage = (id: string, sourceId: string, score = 1): LegalPassage => ({
  id, sourceId, score, title: sourceId, locator: "section 1", sourceUrl: `https://example.test/${sourceId}`,
  text: "This is a substantive verified legal passage about contractual quality, remedies, and resulting loss. ".repeat(4),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Qdrant legal index", () => {
  it("deletes stale point IDs when synchronizing the curated corpus", async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith("/collections/law") && !init?.method) return json({ result: { status: "green" } });
      if (url.endsWith("/points/scroll")) return json({ result: { points: [{ id: "stale" }], next_page_offset: null } });
      return json({ result: true });
    };
    const embedder = { embedMany: async (texts: string[]) => texts.map(() => Array(768).fill(0)) } as any;
    const index = new QdrantLegalIndex("https://qdrant.test", "secret", "law", embedder, fetcher);
    const result = await index.synchronize([passage("keep", "sale")]);
    expect(result).toEqual({ total: 1, upserted: 1, retained: 0, deleted: 1 });
    expect(calls.find((call) => call.url.includes("/points/delete"))?.body).toEqual({ points: ["stale"] });
    expect(calls.find((call) => call.method === "PUT" && call.url.includes("/points?"))?.body.points[0].id).toBe("keep");
    const upsertIndex = calls.findIndex((call) => call.method === "PUT" && call.url.includes("/points?"));
    const deleteIndex = calls.findIndex((call) => call.url.includes("/points/delete"));
    expect(upsertIndex).toBeLessThan(deleteIndex);
  });

  it("requests a wider candidate pool then returns a source-balanced top set", async () => {
    const candidates = [
      ...Array.from({ length: 12 }, (_, index) => passage(`sale-${index}`, "sale", 100 - index)),
      passage("contract", "contracts", 70), passage("case", "case", 60),
    ];
    let queryLimit = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      queryLimit = body.limit;
      return json({ result: { points: candidates.map((item) => ({ score: item.score, payload: item })) } });
    };
    const embedder = { embed: async () => Array(768).fill(0) } as any;
    const index = new QdrantLegalIndex("https://qdrant.test", "secret", "law", embedder, fetcher);
    const result = await index.retrieve("defective goods", 5);
    expect(queryLimit).toBe(24);
    expect(new Set(result.map((item) => item.sourceId))).toEqual(new Set(["sale", "contracts", "case"]));
  });
});

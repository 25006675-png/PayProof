import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chunkDocument, loadCorpus, LocalLegalRetriever, selectRelevantLegalPassages } from "../src/rag/legal-rag.js";

const corpusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/corpus");

describe("legal corpus", () => {
  it("loads downloaded statutes and selected Malaysian judgment with traceable metadata", async () => {
    const passages = await loadCorpus(corpusDir);
    expect(passages.length).toBeGreaterThan(100);
    expect(new Set(passages.map((item) => item.sourceId))).toEqual(new Set(["my-act-382-2006", "my-act-136-2006", "puncak-niaga-v-nz-wheels-2011-ca"]));
    expect(passages.every((item) => item.id && item.sourceUrl && item.locator)).toBe(true);
    expect(passages.every((item) => /^[a-f0-9-]{36}$/.test(item.id))).toBe(true);
    expect(passages.some((item) => item.locator.startsWith("paragraph "))).toBe(true);
  });

  it("retrieves merchantable-quality and compensation passages from the real corpus", async () => {
    const retriever = new LocalLegalRetriever(await loadCorpus(corpusDir));
    const quality = await retriever.retrieve("merchantable quality fitness purpose buyer examined goods section 16", 10);
    expect(quality.some((item) => item.text.toLowerCase().includes("merchantable"))).toBe(true);
    expect(quality.some((item) => item.sourceId === "my-act-382-2006")).toBe(true);
    const damages = await retriever.retrieve("compensation loss damage breach contract section 74 naturally arose", 10);
    expect(damages.some((item) => item.sourceId === "my-act-136-2006")).toBe(true);
  });

  it("creates overlapping chunks without empty content", () => {
    const chunks = chunkDocument("one paragraph words\n\ntwo paragraph words\n\nthree paragraph words", 25, 1);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(Boolean)).toBe(true);
    expect(chunks[1]).toContain("two paragraph words");
  });

  it("builds a focused ingestion set containing statutes and case authority", async () => {
    const relevant = await selectRelevantLegalPassages(await loadCorpus(corpusDir));
    expect(relevant.length).toBeGreaterThanOrEqual(15);
    expect(relevant.length).toBeLessThan(50);
    expect(new Set(relevant.map((item) => item.sourceId))).toEqual(new Set(["my-act-382-2006", "my-act-136-2006", "puncak-niaga-v-nz-wheels-2011-ca"]));
  });
});

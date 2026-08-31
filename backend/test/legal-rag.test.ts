import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { balanceLegalPassages, chunkDocument, isSubstantiveLegalPassage, loadCorpus, LocalLegalRetriever, selectRelevantLegalPassages } from "../src/rag/legal-rag.js";

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
    expect(relevant).toHaveLength(25);
    expect(new Set(relevant.map((item) => item.sourceId))).toEqual(new Set(["my-act-382-2006", "my-act-136-2006", "puncak-niaga-v-nz-wheels-2011-ca"]));
  });

  it("balances a ranked result so statutes and case authority are all represented", () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => ({ id: `sale-${index}`, sourceId: "sale", title: "Sale Act", locator: `s${index}`, sourceUrl: "https://example.test/sale", text: "A substantive legal passage concerning goods quality and buyer remedies. ".repeat(4), score: 100 - index })),
      { id: "contract", sourceId: "contracts", title: "Contracts Act", locator: "s74", sourceUrl: "https://example.test/contracts", text: "A substantive legal passage concerning compensation for breach and resulting loss. ".repeat(4), score: 70 },
      { id: "case", sourceId: "case", title: "Selected judgment", locator: "p30", sourceUrl: "https://example.test/case", text: "A substantive judgment passage applying the relevant legal provisions to defective goods. ".repeat(4), score: 60 },
    ];
    const result = balanceLegalPassages(candidates, 5);
    expect(new Set(result.map((item) => item.sourceId))).toEqual(new Set(["sale", "contracts", "case"]));
  });

  it("excludes table-of-contents chunks that list section names without operative text", () => {
    const toc = {
      id: "toc", sourceId: "contracts", title: "Contracts Act", locator: "chunk 1", sourceUrl: "https://example.test",
      text: `Laws of Malaysia ACT 136\nSection\n49. Application for performance\n50. Place for performance\n51. Performance in manner\n52. Reciprocal promises\n53. Order of performance\n54. Liability of party\n55. Effect of default\n56. Effect of failure\n57. Impossible act\n58. Reciprocal promise`,
    };
    expect(isSubstantiveLegalPassage(toc)).toBe(false);
  });
});

import { config } from "../src/config.js";
import { GeminiEmbedder } from "../src/integrations/gemini.js";
import { QdrantLegalIndex } from "../src/integrations/qdrant.js";
import { loadCorpus, selectRelevantLegalPassages } from "../src/rag/legal-rag.js";

const corpus = await loadCorpus(config.corpusDir);
const passages = await selectRelevantLegalPassages(corpus);
console.log(`Selected ${passages.length} relevant passages from ${corpus.length} verified corpus passages.`);
const index = new QdrantLegalIndex(
  config.qdrantUrl(), config.qdrantApiKey(), config.legalCollection,
  new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel),
);
const result = await index.synchronize(passages);
console.log(`Synchronized ${result.total} passages into ${config.legalCollection}: ${result.upserted} embedded, ${result.retained} retained, ${result.deleted} stale removed.`);

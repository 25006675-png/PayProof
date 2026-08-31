import { config } from "../src/config.js";
import { GeminiEmbedder, GeminiJsonModel } from "../src/integrations/gemini.js";

const model = new GeminiJsonModel(config.geminiApiKey(), config.geminiModel);
const generated = await model.generateJson<{ ok: boolean; purpose: string }>(
  "Return valid JSON only. Do not add markdown.",
  'Return exactly this semantic content as JSON: ok is true and purpose is "PayProof connectivity test".',
);
if (generated.ok !== true || generated.purpose !== "PayProof connectivity test") {
  throw new Error("Gemini structured generation returned unexpected content");
}

const embedder = new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel);
const vector = await embedder.embed("Malaysian sale of goods merchantable quality dispute");
if (vector.length !== 768 || vector.some((value) => !Number.isFinite(value))) {
  throw new Error(`Gemini embedding validation failed; received ${vector.length} dimensions`);
}
const batch = await embedder.embedMany(["merchantable quality", "compensation for breach"]);
if (batch.length !== 2 || batch.some((item) => item.length !== 768)) throw new Error("Gemini batch embedding validation failed");

console.log(`Gemini structured generation (${config.geminiModel}): passed.`);
console.log(`Gemini embedding (${config.embeddingModel}, ${vector.length} dimensions): passed.`);
console.log("Gemini batch embedding: passed.");

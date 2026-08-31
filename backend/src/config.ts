import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env"), override: false });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabasePublishableKey: () => required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  qdrantUrl: () => required("QDRANT_URL"),
  qdrantApiKey: () => required("QDRANT_API_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
  legalCollection: process.env.LEGAL_COLLECTION ?? "payproof_malaysia_law_v1",
  store: process.env.BACKEND_STORE ?? "memory",
  port: Number(process.env.PORT ?? 8787),
  demoMode: process.env.PAYPROOF_DEMO_MODE === "true",
  corpusDir: path.resolve(here, "../../docs/corpus"),
};

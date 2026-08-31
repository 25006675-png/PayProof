import { serve } from "@hono/node-server";
import { MediationOrchestrator } from "./ai/mediation.js";
import { createApp } from "./api/app.js";
import { SupabaseTokenVerifier } from "./api/supabase-auth.js";
import { config } from "./config.js";
import { DemoOrderService } from "./demo/demo-service.js";
import { GeminiEmbedder, GeminiJsonModel } from "./integrations/gemini.js";
import { QdrantLegalIndex } from "./integrations/qdrant.js";
import { DisputeService, systemContext } from "./service/dispute-service.js";
import { MemoryDisputeStore } from "./store/store.js";
import { SupabaseDisputeStore } from "./store/supabase-store.js";

const store = config.store === "supabase"
  ? new SupabaseDisputeStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryDisputeStore();
const service = new DisputeService(store, systemContext);
const verifier = new SupabaseTokenVerifier(config.supabaseUrl(), config.supabasePublishableKey());
let mediator: MediationOrchestrator | undefined;
if (process.env.GEMINI_API_KEY) {
  const embedder = new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel);
  const retriever = new QdrantLegalIndex(config.qdrantUrl(), config.qdrantApiKey(), config.legalCollection, embedder);
  mediator = new MediationOrchestrator(new GeminiJsonModel(config.geminiApiKey(), config.geminiModel), retriever, systemContext);
}
const demo = config.demoMode ? new DemoOrderService(systemContext) : undefined;
const app = createApp(service, verifier, mediator, demo);
serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(`PayProof dispute backend listening on http://localhost:${port}`));

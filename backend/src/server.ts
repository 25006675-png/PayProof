import { serve } from "@hono/node-server";
import { MediationOrchestrator } from "./ai/mediation.js";
import { createApp } from "./api/app.js";
import { SupabaseTokenVerifier } from "./api/supabase-auth.js";
import { DemoAwareTokenVerifier } from "./api/demo-auth.js";
import { config } from "./config.js";
import { DemoOrderService } from "./demo/demo-service.js";
import { GeminiEmbedder, GeminiJsonModel } from "./integrations/gemini.js";
import { QdrantLegalIndex } from "./integrations/qdrant.js";
import { createSuiSettlementVerifier } from "./integrations/sui-settlement.js";
import { GrpcSuiFundingVerifier } from "./integrations/sui-funding.js";
import { DisputeService, systemContext } from "./service/dispute-service.js";
import { MemoryDisputeStore } from "./store/store.js";
import { SupabaseDisputeStore } from "./store/supabase-store.js";
import { MemoryTradeStore } from "./store/trade-store.js";
import { SupabaseTradeStore } from "./store/supabase-trade-store.js";
import { TradeService } from "./service/trade-service.js";

const store = config.store === "supabase"
  ? new SupabaseDisputeStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryDisputeStore();
const service = new DisputeService(store, systemContext);
const supabaseVerifier = new SupabaseTokenVerifier(config.supabaseUrl(), config.supabasePublishableKey());
const verifier = new DemoAwareTokenVerifier(supabaseVerifier, config.demoMode);
let mediator: MediationOrchestrator | undefined;
if (process.env.GEMINI_API_KEY) {
  const embedder = new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel);
  const retriever = new QdrantLegalIndex(config.qdrantUrl(), config.qdrantApiKey(), config.legalCollection, embedder);
  mediator = new MediationOrchestrator(new GeminiJsonModel(config.geminiApiKey(), config.geminiModel), retriever, systemContext);
}
const demo = config.demoMode ? new DemoOrderService(systemContext) : undefined;
const tradeStore = config.store === "supabase"
  ? new SupabaseTradeStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryTradeStore();
const settlementVerifier = config.suiEscrowVerifierEnabled
  ? createSuiSettlementVerifier({ packageId: config.suiEscrowPackageId, network: config.suiNetwork, baseUrl: config.suiRpcUrl })
  : undefined;
const fundingVerifier = config.suiEscrowVerifierEnabled
  ? new GrpcSuiFundingVerifier({ packageId: config.suiEscrowPackageId, network: config.suiNetwork, baseUrl: config.suiRpcUrl })
  : undefined;
const trades = new TradeService(tradeStore, service, systemContext, process.env.INVITE_BASE_URL ?? "http://localhost:3000/workspace", fundingVerifier);
const app = createApp(service, verifier, mediator, demo, settlementVerifier, trades, config.demoMode);
serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(`PayProof dispute backend listening on http://localhost:${port}`));

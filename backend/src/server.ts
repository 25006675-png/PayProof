import { serve } from "@hono/node-server";
import { MediationOrchestrator } from "./ai/mediation.js";
import { loadPolicyCorpus } from "./policy/policy-corpus.js";
import { createApp } from "./api/app.js";
import { SupabaseTokenVerifier } from "./api/supabase-auth.js";
import { CompositeTokenVerifier, MappedSupabaseTokenVerifier } from "./api/identity-auth.js";
import { DemoAwareTokenVerifier } from "./api/demo-auth.js";
import { config } from "./config.js";
import { DemoOrderService } from "./demo/demo-service.js";
import { MemoryDocumentStore, SupabaseDocumentStore } from "./store/document-store.js";
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
import { IdentityService } from "./service/identity-service.js";
import { SupabaseIdentityStore } from "./store/supabase-identity-store.js";
import { EnokiSponsor } from "./integrations/enoki-sponsor.js";
import { EnokiZkLoginIssuer, GoogleOidcTokenVerifier, HttpZkProofProvider, ZkLoginService } from "./service/zklogin-service.js";
import { OrganizationService } from "./service/organization-service.js";
import { MemoryOrganizationStore } from "./store/organization-store.js";
import { SupabaseOrganizationStore } from "./store/supabase-organization-store.js";
import { DisabledInvitationEmailSender, ResendInvitationEmailSender, SmtpInvitationEmailSender } from "./integrations/invitation-email.js";

const store = config.store === "supabase"
  ? new SupabaseDisputeStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryDisputeStore();
const service = new DisputeService(store, systemContext);
const supabaseVerifier = new SupabaseTokenVerifier(config.supabaseUrl(), config.supabasePublishableKey());
const sessionSecret = config.payProofSessionSecret();
const saltSecret = config.zkLoginSaltMasterKey();
const identity = sessionSecret && saltSecret
  ? new IdentityService(new SupabaseIdentityStore(config.supabaseUrl(), config.supabaseSecretKey()), {
      sessionSecret,
      zkLoginSaltSecret: saltSecret,
    })
  : undefined;
const mappedSupabaseVerifier = identity
  ? new MappedSupabaseTokenVerifier(supabaseVerifier, identity)
  : supabaseVerifier;
const productionVerifier = identity
  ? new CompositeTokenVerifier(mappedSupabaseVerifier, identity)
  : mappedSupabaseVerifier;
const verifier = new DemoAwareTokenVerifier(productionVerifier, config.demoMode);
const googleClientIds = config.googleOauthClientIds();
const proverUrl = config.zkLoginProverUrl();
const enokiKey = config.enokiPrivateKey();
// Enoki hosts the prover and the salt, so it wins when configured. The raw prover
// stays as the fallback for a locally hosted setup.
const zkLogin = identity && googleClientIds.length > 0 && (enokiKey || proverUrl)
  ? new ZkLoginService(
      identity,
      new GoogleOidcTokenVerifier(googleClientIds),
      proverUrl ? new HttpZkProofProvider(proverUrl) : undefined,
      enokiKey ? new EnokiZkLoginIssuer(enokiKey, config.suiNetwork) : undefined,
    )
  : undefined;
if (enokiKey) console.log(`zkLogin proofs issued by Enoki on ${config.suiNetwork}`);
const sponsor = enokiKey ? new EnokiSponsor(enokiKey, config.suiNetwork, config.suiEscrowPackageId) : undefined;
if (sponsor) console.log(`Gas sponsored by Enoki for ${config.suiEscrowPackageId}::escrow`);
let mediator: MediationOrchestrator | undefined;
if (process.env.GEMINI_API_KEY) {
  const embedder = new GeminiEmbedder(config.geminiApiKey(), config.embeddingModel);
  // Statute and case law are retrieved for the human arbitration package only.
  const candidateAuthorities = new QdrantLegalIndex(config.qdrantUrl(), config.qdrantApiKey(), config.legalCollection, embedder);
  const policy = await loadPolicyCorpus(config.disputePolicyFile);
  console.log(`Dispute policy v${policy.version} loaded with ${policy.clauses.length} quotable clauses`);
  mediator = new MediationOrchestrator(
    new GeminiJsonModel(config.geminiApiKey(), config.geminiModel), policy, systemContext, undefined, candidateAuthorities,
  );
}
const demo = config.demoMode ? new DemoOrderService(systemContext) : undefined;
const tradeStore = config.store === "supabase"
  ? new SupabaseTradeStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryTradeStore();
const organizations = new OrganizationService(config.store === "supabase"
  ? new SupabaseOrganizationStore(config.supabaseUrl(), config.supabaseSecretKey())
  : new MemoryOrganizationStore());
const smtpHost = config.smtpHost();
const smtpUser = config.smtpUser();
const smtpPassword = config.smtpPassword();
const invitationFrom = config.invitationEmailFrom();
const invitationEmail = smtpHost && smtpUser && smtpPassword && invitationFrom
  ? new SmtpInvitationEmailSender({
      host: smtpHost,
      port: config.smtpPort(),
      secure: config.smtpSecure(),
      user: smtpUser,
      password: smtpPassword,
      from: invitationFrom,
    })
  : config.resendApiKey() && invitationFrom
    ? new ResendInvitationEmailSender(config.resendApiKey()!, invitationFrom)
    : new DisabledInvitationEmailSender();
console.log("Invitation email sender", invitationEmail instanceof SmtpInvitationEmailSender
  ? `SMTP ${smtpHost}:${config.smtpPort()} (${config.smtpSecure() ? "implicit TLS" : "STARTTLS"})`
  : invitationEmail instanceof ResendInvitationEmailSender ? "Resend" : "disabled — invitations will report not_configured");
const settlementVerifier = config.suiEscrowVerifierEnabled
  ? createSuiSettlementVerifier({ packageId: config.suiEscrowPackageId, network: config.suiNetwork, baseUrl: config.suiRpcUrl })
  : undefined;
const fundingVerifier = config.suiEscrowVerifierEnabled
  ? new GrpcSuiFundingVerifier({ packageId: config.suiEscrowPackageId, network: config.suiNetwork, baseUrl: config.suiRpcUrl })
  : undefined;
const documentStore = config.store === "supabase"
  ? new SupabaseDocumentStore(config.supabaseUrl(), config.supabaseSecretKey(), config.documentsBucket)
  : new MemoryDocumentStore();
const trades = new TradeService(tradeStore, service, systemContext, process.env.INVITE_BASE_URL ?? "http://localhost:3000/orders", fundingVerifier, organizations, invitationEmail, documentStore);
const app = createApp(service, verifier, mediator, demo, settlementVerifier, trades, config.demoMode, identity, zkLogin, organizations, sponsor);
serve({ fetch: app.fetch, port: config.port }, ({ port }) => console.log(`PayProof dispute backend listening on http://localhost:${port}`));

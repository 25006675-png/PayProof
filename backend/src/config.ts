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

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const config = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabasePublishableKey: () => required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  payProofSessionSecret: () => optional("PAYPROOF_SESSION_SECRET"),
  zkLoginSaltMasterKey: () => optional("ZKLOGIN_SALT_MASTER_KEY"),
  googleOauthClientIds: () => optional("GOOGLE_OAUTH_CLIENT_ID")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
  zkLoginProverUrl: () => optional("ZKLOGIN_PROVER_URL"),
  enokiPrivateKey: () => optional("ENOKI_PRIVATE_KEY"),
  qdrantUrl: () => required("QDRANT_URL"),
  qdrantApiKey: () => required("QDRANT_API_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
  legalCollection: process.env.LEGAL_COLLECTION ?? "payproof_malaysia_law_v1",
  disputePolicyFile: process.env.DISPUTE_POLICY_FILE ?? fileURLToPath(new URL("../../docs/dispute-policy.md", import.meta.url)),
  store: process.env.BACKEND_STORE ?? "memory",
  documentsBucket: process.env.PAYPROOF_DOCUMENTS_BUCKET ?? "payproof-documents",
  port: Number(process.env.PORT ?? 8787),
  demoMode: process.env.PAYPROOF_DEMO_MODE === "true",
  suiEscrowVerifierEnabled: process.env.SUI_ESCROW_VERIFIER_ENABLED === "true",
  suiNetwork: process.env.SUI_NETWORK ?? "testnet",
  suiRpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
  suiEscrowPackageId: process.env.SUI_ESCROW_PACKAGE_ID ?? "0x09016642916e5558256e4d5dbc2745c4eb4585c0f163a7f96d99438c77960501",
  resendApiKey: () => optional("RESEND_API_KEY"),
  brevoApiKey: () => optional("BREVO_API_KEY"),
  invitationEmailFrom: () => optional("INVITATION_EMAIL_FROM"),
  smtpHost: () => optional("SMTP_HOST"),
  smtpPort: () => Number(optional("SMTP_PORT") ?? 465),
  smtpSecure: () => optional("SMTP_SECURE") !== "false",
  smtpUser: () => optional("SMTP_USER"),
  smtpPassword: () => optional("SMTP_PASS"),
  corpusDir: path.resolve(here, "../../docs/corpus"),
};

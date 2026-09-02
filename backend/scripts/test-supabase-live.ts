import { createClient } from "@supabase/supabase-js";
import { config } from "../src/config.js";

const client = createClient(config.supabaseUrl(), config.supabaseSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const table = await client
  .from("dispute_aggregates")
  .select("id", { count: "exact", head: true });
const tradeTable = await client
  .from("trade_orders")
  .select("id,buyer_organization_id,supplier_organization_id", { count: "exact", head: true });
const accountTable = await client
  .from("payproof_accounts")
  .select("id", { count: "exact", head: true });
const identityTable = await client
  .from("payproof_sui_identities")
  .select("address", { count: "exact", head: true });
const walletChallengeTable = await client
  .from("wallet_auth_challenges")
  .select("id")
  .limit(1);
const organizationTable = await client.from("payproof_organizations").select("id", { count: "exact", head: true });
const membershipTable = await client.from("payproof_organization_memberships").select("organization_id", { count: "exact", head: true });
const invitationDeliverySchema = await client.from("trade_invites").select("delivery_status,delivery_message_id,delivery_attempted_at", { count: "exact", head: true });
const buckets = await client.storage.listBuckets();
const rpc = await client.rpc("save_dispute_aggregate", {
  p_id: "00000000-0000-0000-0000-000000000000",
  p_expected_version: 0,
  p_status: "supplier_review",
  p_aggregate: { version: 0 },
});
const walletChallengeRpc = await client.rpc("consume_wallet_challenge", {
  p_id: "00000000-0000-0000-0000-000000000000",
  p_used_at: new Date().toISOString(),
});
const tradeRpc = await client.rpc("save_trade_order", {
  p_id: "00000000-0000-0000-0000-000000000000", p_expected_version: 0,
  p_status: "awaiting_supplier", p_supplier_id: null, p_supplier_organization_id: null,
  p_aggregate: { version: 0 },
});

const evidenceBucket = buckets.data?.find((bucket) => bucket.id === "dispute-evidence");
const errors = [table.error?.message, tradeTable.error?.message, accountTable.error?.message, identityTable.error?.message, walletChallengeTable.error?.message, organizationTable.error?.message, membershipTable.error?.message, invitationDeliverySchema.error?.message, buckets.error?.message, rpc.error?.message, walletChallengeRpc.error?.message, tradeRpc.error?.message].filter(Boolean);
const result = {
  tableReachable: !table.error,
  rowCount: table.count,
  tradeTableReachable: !tradeTable.error,
  tradeSchemaError: tradeTable.error ? { code: tradeTable.error.code, message: tradeTable.error.message, details: tradeTable.error.details } : null,
  identitySchemaReachable: !accountTable.error && !identityTable.error && !walletChallengeTable.error && !walletChallengeRpc.error,
  organizationSchemaReachable: !organizationTable.error && !membershipTable.error && !tradeRpc.error,
  invitationDeliverySchemaReachable: !invitationDeliverySchema.error,
  bucketReachable: !buckets.error,
  evidenceBucket: evidenceBucket
    ? {
        id: evidenceBucket.id,
        public: evidenceBucket.public,
        fileSizeLimit: evidenceBucket.file_size_limit,
      }
    : null,
  rpcReachable: !rpc.error,
  rpcNoMatch: rpc.data === false,
  errors,
};

console.log(JSON.stringify(result, null, 2));

if (errors.length > 0 || !evidenceBucket || evidenceBucket.public || rpc.data !== false) {
  process.exitCode = 1;
}

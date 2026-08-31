import { createClient } from "@supabase/supabase-js";
import { config } from "../src/config.js";

const client = createClient(config.supabaseUrl(), config.supabaseSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const table = await client
  .from("dispute_aggregates")
  .select("id", { count: "exact", head: true });
const buckets = await client.storage.listBuckets();
const rpc = await client.rpc("save_dispute_aggregate", {
  p_id: "00000000-0000-0000-0000-000000000000",
  p_expected_version: 0,
  p_status: "supplier_review",
  p_aggregate: { version: 0 },
});

const evidenceBucket = buckets.data?.find((bucket) => bucket.id === "dispute-evidence");
const errors = [table.error?.message, buckets.error?.message, rpc.error?.message].filter(Boolean);
const result = {
  tableReachable: !table.error,
  rowCount: table.count,
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

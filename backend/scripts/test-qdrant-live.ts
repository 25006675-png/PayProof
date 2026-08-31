import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";

const collection = `payproof_connectivity_${Date.now()}`;
const base = config.qdrantUrl().replace(/\/$/, "");
const headers = { "content-type": "application/json", "api-key": config.qdrantApiKey() };
async function request(path: string, init: RequestInit) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`Qdrant live test failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<any>;
}

try {
  await request(`/collections/${collection}`, { method: "PUT", body: JSON.stringify({ vectors: { size: 2, distance: "Cosine" } }) });
  const pointId = randomUUID();
  await request(`/collections/${collection}/points?wait=true`, {
    method: "PUT", body: JSON.stringify({ points: [{ id: pointId, vector: [1, 0], payload: { purpose: "isolated connectivity test" } }] }),
  });
  const result = await request(`/collections/${collection}/points/query`, {
    method: "POST", body: JSON.stringify({ query: [1, 0], limit: 1, with_payload: true }),
  });
  if (result.result?.points?.[0]?.id !== pointId) throw new Error("Qdrant live query did not return the inserted point");
  console.log("Qdrant create, upsert, vector query, and result validation: passed.");
} finally {
  if (!collection.startsWith("payproof_connectivity_")) throw new Error("Refusing to clean up an unexpected Qdrant collection");
  const response = await fetch(`${base}/collections/${collection}`, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404) throw new Error(`Qdrant cleanup failed (${response.status})`);
  console.log("Temporary Qdrant test collection removed.");
}

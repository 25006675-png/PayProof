import { config } from "../src/config.js";

async function check(name: string, url: string, headers: HeadersInit): Promise<boolean> {
  try {
    const response = await fetch(url, { headers });
    console.log(`${name}: ${response.ok ? "reachable" : `failed (${response.status})`}`);
    return response.ok;
  } catch (error) {
    console.log(`${name}: failed (${error instanceof Error ? error.message : "unknown error"})`);
    return false;
  }
}

const supabase = await check("Supabase", `${config.supabaseUrl()}/auth/v1/settings`, { apikey: config.supabasePublishableKey() });
const qdrant = await check("Qdrant", `${config.qdrantUrl().replace(/\/$/, "")}/collections`, { "api-key": config.qdrantApiKey() });
if (!process.env.GEMINI_API_KEY) console.log("Gemini: skipped (GEMINI_API_KEY is not configured; the supplied JWT is a Qdrant key)");
else {
  const gemini = await check("Gemini", `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}`, { "x-goog-api-key": config.geminiApiKey() });
  if (!gemini) process.exitCode = 1;
}
if (!supabase || !qdrant) process.exitCode = 1;

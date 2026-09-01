import { createHash } from "node:crypto";
import { DomainError, type Actor } from "../domain/types.js";
import type { TokenVerifier } from "./app.js";

const DEMO_PREFIX = "demo-google.";

function uuidFromEmail(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function encodeProfile(email: string, name: string): string {
  return Buffer.from(JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim() }), "utf8").toString("base64url");
}

function decodeProfile(value: string): { email: string; name: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { email?: unknown; name?: unknown };
    if (typeof parsed.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) throw new Error("invalid email");
    return { email: parsed.email.trim().toLowerCase(), name: typeof parsed.name === "string" ? parsed.name.trim() : parsed.email.trim() };
  } catch {
    throw new DomainError("UNAUTHORIZED", "Invalid demo session", 401);
  }
}

export function issueDemoGoogleSession(email: string, name: string): { accessToken: string; user: Actor & { email: string; name: string } } {
  const profile = decodeProfile(encodeProfile(email, name));
  return { accessToken: `${DEMO_PREFIX}${encodeProfile(profile.email, profile.name)}`, user: { id: uuidFromEmail(profile.email), email: profile.email, name: profile.name } };
}

export function verifyDemoGoogleToken(token: string): Actor {
  if (!token.startsWith(DEMO_PREFIX)) throw new DomainError("UNAUTHORIZED", "Invalid or expired user token", 401);
  const profile = decodeProfile(token.slice(DEMO_PREFIX.length));
  return { id: uuidFromEmail(profile.email), email: profile.email, name: profile.name };
}

export class DemoAwareTokenVerifier implements TokenVerifier {
  constructor(private readonly fallback: TokenVerifier, private readonly enabled: boolean) {}

  async verify(token: string): Promise<Actor> {
    if (this.enabled && token.startsWith(DEMO_PREFIX)) return verifyDemoGoogleToken(token);
    return this.fallback.verify(token);
  }
}

export { DEMO_PREFIX, uuidFromEmail };


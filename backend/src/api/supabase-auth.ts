import { createClient } from "@supabase/supabase-js";
import { DomainError } from "../domain/types.js";
import type { TokenVerifier } from "./app.js";

export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly url: string, private readonly publishableKey: string) {}
  async verify(token: string) {
    const client = createClient(this.url, this.publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new DomainError("UNAUTHORIZED", "Invalid or expired user token", 401);
    return { id: data.user.id };
  }
}

import { decodeJwt } from "jose";
import { DomainError, type Actor } from "../domain/types.js";
import type { IdentityService } from "../service/identity-service.js";
import type { TokenVerifier } from "./app.js";

export class MappedSupabaseTokenVerifier implements TokenVerifier {
  constructor(
    private readonly supabase: TokenVerifier,
    private readonly identity: IdentityService,
  ) {}

  async verify(token: string): Promise<Actor> {
    const supabaseActor = await this.supabase.verify(token);
    const account = await this.identity.resolveSupabaseUser(supabaseActor);
    return {
      id: account.id,
      email: account.email,
      name: account.name,
    };
  }
}

export class CompositeTokenVerifier implements TokenVerifier {
  constructor(
    private readonly supabase: TokenVerifier,
    private readonly identity: IdentityService,
  ) {}

  async verify(token: string): Promise<Actor> {
    try {
      if (decodeJwt(token).iss === "payproof")
        return await this.identity.verifySession(token);
    } catch {
      // Supabase performs the authoritative validation for all non-PayProof tokens.
    }
    try {
      return await this.supabase.verify(token);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("UNAUTHORIZED", "Invalid or expired user token", 401);
    }
  }
}

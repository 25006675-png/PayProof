export type IdentityKind = "zklogin" | "wallet";

export interface PayProofAccount {
  id: string;
  supabaseUserId?: string;
  email?: string;
  name?: string;
  verifiedSuiAddress?: string;
}

export interface WalletChallenge {
  id: string;
  address: string;
  message: string;
  expiresAt: string;
  usedAt?: string;
}

export interface IdentityStore {
  upsertSupabaseAccount(input: {
    supabaseUserId: string;
    email?: string;
    name?: string;
  }): Promise<PayProofAccount>;
  findAccountById(id: string): Promise<PayProofAccount | undefined>;
  findAccountByAddress(address: string): Promise<PayProofAccount | undefined>;
  createWalletAccount(address: string): Promise<PayProofAccount>;
  linkSuiAddress(input: {
    accountId: string;
    address: string;
    kind: IdentityKind;
    issuer?: string;
    audience?: string;
  }): Promise<PayProofAccount>;
  createChallenge(challenge: WalletChallenge): Promise<void>;
  getChallenge(id: string): Promise<WalletChallenge | undefined>;
  consumeChallenge(id: string, usedAt: string): Promise<boolean>;
}

export class MemoryIdentityStore implements IdentityStore {
  private readonly accounts = new Map<string, PayProofAccount>();
  private readonly supabaseAccounts = new Map<string, string>();
  private readonly addressAccounts = new Map<string, string>();
  private readonly challenges = new Map<string, WalletChallenge>();

  async upsertSupabaseAccount(input: {
    supabaseUserId: string;
    email?: string;
    name?: string;
  }): Promise<PayProofAccount> {
    const existingId = this.supabaseAccounts.get(input.supabaseUserId);
    if (existingId) {
      const existing = this.accounts.get(existingId)!;
      const updated = { ...existing, email: input.email, name: input.name };
      this.accounts.set(existingId, updated);
      return structuredClone(updated);
    }
    const account: PayProofAccount = {
      id: crypto.randomUUID(),
      supabaseUserId: input.supabaseUserId,
      email: input.email,
      name: input.name,
    };
    this.accounts.set(account.id, account);
    this.supabaseAccounts.set(input.supabaseUserId, account.id);
    return structuredClone(account);
  }

  async findAccountById(id: string): Promise<PayProofAccount | undefined> {
    const account = this.accounts.get(id);
    return account ? structuredClone(account) : undefined;
  }

  async findAccountByAddress(address: string): Promise<PayProofAccount | undefined> {
    const id = this.addressAccounts.get(address);
    return id ? structuredClone(this.accounts.get(id)!) : undefined;
  }

  async createWalletAccount(address: string): Promise<PayProofAccount> {
    const existing = await this.findAccountByAddress(address);
    if (existing) return existing;
    const account: PayProofAccount = {
      id: crypto.randomUUID(),
      verifiedSuiAddress: address,
    };
    this.accounts.set(account.id, account);
    this.addressAccounts.set(address, account.id);
    return structuredClone(account);
  }

  async linkSuiAddress(input: {
    accountId: string;
    address: string;
    kind: IdentityKind;
    issuer?: string;
    audience?: string;
  }): Promise<PayProofAccount> {
    const account = this.accounts.get(input.accountId);
    if (!account) throw new Error("PAYPROOF_ACCOUNT_NOT_FOUND");
    const owner = this.addressAccounts.get(input.address);
    if (owner && owner !== input.accountId) throw new Error("SUI_ADDRESS_ALREADY_LINKED");
    const updated = { ...account, verifiedSuiAddress: input.address };
    this.accounts.set(input.accountId, updated);
    this.addressAccounts.set(input.address, input.accountId);
    return structuredClone(updated);
  }

  async createChallenge(challenge: WalletChallenge): Promise<void> {
    this.challenges.set(challenge.id, structuredClone(challenge));
  }

  async getChallenge(id: string): Promise<WalletChallenge | undefined> {
    const challenge = this.challenges.get(id);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async consumeChallenge(id: string, usedAt: string): Promise<boolean> {
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.usedAt) return false;
    this.challenges.set(id, { ...challenge, usedAt });
    return true;
  }
}

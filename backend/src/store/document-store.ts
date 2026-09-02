import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Where the bytes of attached documents live. Metadata stays on the order aggregate. */
export interface DocumentStore {
  put(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
}

export class MemoryDocumentStore implements DocumentStore {
  private readonly files = new Map<string, { bytes: Uint8Array; mimeType: string }>();

  async put(path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    this.files.set(path, { bytes: new Uint8Array(bytes), mimeType });
  }

  async get(path: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined> {
    const file = this.files.get(path);
    return file ? { bytes: new Uint8Array(file.bytes), mimeType: file.mimeType } : undefined;
  }
}

/** Private Supabase Storage bucket. Only the backend holds the key, so access control stays in the trade service. */
export class SupabaseDocumentStore implements DocumentStore {
  private readonly client: SupabaseClient;
  private ensured = false;

  constructor(url: string, secretKey: string, private readonly bucket = "payproof-documents") {
    if (!secretKey.startsWith("sb_secret_") && !secretKey.startsWith("eyJ")) {
      throw new Error("A server-side Supabase secret/service-role key is required");
    }
    this.client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async ensureBucket(): Promise<void> {
    if (this.ensured) return;
    const { error } = await this.client.storage.createBucket(this.bucket, { public: false, fileSizeLimit: 8 * 1024 * 1024 });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Supabase document bucket setup failed: ${error.message}`);
    this.ensured = true;
  }

  async put(path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    await this.ensureBucket();
    const { error } = await this.client.storage.from(this.bucket).upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`Supabase document upload failed: ${error.message}`);
  }

  async get(path: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined> {
    await this.ensureBucket();
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error) {
      if (/not found|404/i.test(error.message)) return undefined;
      throw new Error(`Supabase document download failed: ${error.message}`);
    }
    return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type || "application/octet-stream" };
  }
}

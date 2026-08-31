export interface JsonModel {
  generateJson<T>(system: string, input: string, jsonSchema?: Record<string, unknown>): Promise<T>;
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function requestWithRetry(fetcher: typeof fetch, url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === attempts - 1) return response;
      lastError = new Error(`Transient Gemini response ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, [500, 1_500][attempt] ?? 1_500));
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini request failed after retries");
}

export class GeminiJsonModel implements JsonModel {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gemini-3.1-flash-lite",
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  }

  async generateJson<T>(system: string, input: string, jsonSchema?: Record<string, unknown>): Promise<T> {
    const response = await requestWithRetry(this.fetcher,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: input }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${await response.text()}`);
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new Error("Gemini returned no JSON content");
    return JSON.parse(text) as T;
  }
}

export class GeminiEmbedder {
  constructor(private readonly apiKey: string, private readonly model = "gemini-embedding-2", private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  }
  async embed(text: string): Promise<number[]> {
    const response = await requestWithRetry(this.fetcher,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:embedContent`,
      {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
      },
    );
    if (!response.ok) throw new Error(`Gemini embedding failed (${response.status}): ${await response.text()}`);
    const body = await response.json() as { embedding?: { values?: number[] } };
    if (!body.embedding?.values?.length) throw new Error("Gemini returned no embedding");
    return body.embedding.values;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const response = await requestWithRetry(this.fetcher,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
      {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        })) }),
      },
    );
    if (!response.ok) throw new Error(`Gemini batch embedding failed (${response.status}): ${await response.text()}`);
    const body = await response.json() as { embeddings?: Array<{ values?: number[] }> };
    const vectors = body.embeddings?.map((embedding) => embedding.values ?? []) ?? [];
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== 768)) {
      throw new Error("Gemini returned an invalid batch embedding response");
    }
    return vectors;
  }
}

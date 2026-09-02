import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/csv"]);

const schema = {
  type: "object",
  properties: {
    reference: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    buyerName: { type: ["string", "null"] },
    deliveryDate: { type: ["string", "null"], description: "ISO date YYYY-MM-DD when present" },
    deliveryLocation: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitPrice: { type: ["number", "null"] },
        },
        required: ["description", "quantity", "unit", "unitPrice"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["reference", "supplierName", "buyerName", "deliveryDate", "deliveryLocation", "currency", "lines", "warnings"],
};

const transcriptSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "Everything legible in the document, in reading order. For photos, a factual description of what is visible, including damage, labels, counts and dates." },
    documentType: { type: "string", description: "For example delivery order, invoice, photo, email, contract." },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["transcript", "documentType", "warnings"],
};

const extractInstructions = `You extract structured data from business purchase orders. Return only what the document states.
Rules:
- One entry per product line. Keep the description as written, trimmed.
- quantity is the ordered quantity as a number. unit is the unit of measure as written (for example cartons, drums, pcs). Use "units" when no unit is given.
- unitPrice is the unit price as a number without currency symbols, or null when absent.
- deliveryDate must be ISO YYYY-MM-DD or null.
- Put anything unclear, unreadable, or inconsistent (for example line totals that do not match quantity times price) into warnings as short sentences.
- Never invent lines, quantities, or prices.`;

const transcriptInstructions = `You transcribe evidence documents for a commercial dispute record. Reproduce the legible text faithfully and, for images, describe only what is visible: item counts, condition, damage, labels, signatures, stamps, dates. Do not judge who is right and do not add anything that is not in the document. Note anything unreadable in warnings.`;

async function generate(apiKey: string, model: string, system: string, parts: Array<Record<string, unknown>>, responseSchema: Record<string, unknown>) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: responseSchema, temperature: 0, maxOutputTokens: 6144 },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return { error: NextResponse.json({ error: "EXTRACTION_FAILED", message: `The document could not be read (${response.status}).`, detail: detail.slice(0, 500) }, { status: 502 }) };
  }
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) return { error: NextResponse.json({ error: "EMPTY", message: "No content could be extracted from this document." }, { status: 502 }) };
  try {
    return { data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { error: NextResponse.json({ error: "INVALID_JSON", message: "The extraction result could not be parsed." }, { status: 502 }) };
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "NOT_CONFIGURED", message: "Document reading is not configured. Set GEMINI_API_KEY for the web app." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const mode = form?.get("mode") === "transcript" ? "transcript" : "purchase_order";
  if (!(file instanceof File)) return NextResponse.json({ error: "NO_FILE", message: "Attach a file." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "FILE_SIZE", message: "The file must be between 1 byte and 8 MB." }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.has(mime)) return NextResponse.json({ error: "FILE_TYPE", message: "Upload a PDF, PNG, JPEG, WebP, CSV or plain text file." }, { status: 400 });

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  const bytes = Buffer.from(await file.arrayBuffer());
  const parts: Array<Record<string, unknown>> = mime.startsWith("text/")
    ? [{ text: `${mode === "transcript" ? "Evidence document" : "Purchase order document"}:\n\n${bytes.toString("utf8").slice(0, 60_000)}` }]
    : [{ inlineData: { mimeType: mime, data: bytes.toString("base64") } }, { text: mode === "transcript" ? "Transcribe this evidence document." : "Extract the purchase order lines from this document." }];

  const result = mode === "transcript"
    ? await generate(apiKey, model, transcriptInstructions, parts, transcriptSchema)
    : await generate(apiKey, model, extractInstructions, parts, schema);
  if (result.error) return result.error;
  if (mode === "purchase_order" && !Array.isArray(result.data?.lines)) return NextResponse.json({ error: "INVALID_JSON", message: "The extraction result could not be parsed." }, { status: 502 });
  return NextResponse.json({ ...result.data, model, fileName: file.name, fileSize: file.size, mimeType: mime });
}

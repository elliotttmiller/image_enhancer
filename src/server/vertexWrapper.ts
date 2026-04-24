import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

/** Normalise a raw role string to the only two values Vertex accepts. */
function toVertexRole(raw: unknown): "user" | "model" {
  const r = String(raw ?? "").toLowerCase();
  if (r === "model" || r === "assistant" || r === "bot" || r === "system") return "model";
  return "user"; // covers "user", "", unknown
}

/** Convert a single message `content` value to a Vertex `parts` array. */
function toParts(content: unknown): { text?: string; inlineData?: { mimeType: string; data: string } }[] {
  if (!content) return [];

  // Already an array of part-like objects
  if (Array.isArray(content)) {
    return content.flatMap((item) => {
      if (!item) return [];
      if (typeof item === "string") return [{ text: item } as { text?: string; inlineData?: { mimeType: string; data: string } }];
      if (item.inlineData?.data) return [{ inlineData: { mimeType: item.inlineData.mimeType ?? "image/png", data: item.inlineData.data } } as { text?: string; inlineData?: { mimeType: string; data: string } }];
      if (item.text) return [{ text: item.text } as { text?: string; inlineData?: { mimeType: string; data: string } }];
      // Anthropic-style image part
      if ((item.type === "image" || item.type === "input_image") && (item.data || item.inlineData?.data)) {
        return [{ inlineData: { mimeType: item.mimeType ?? item.inlineData?.mimeType ?? "image/png", data: item.data ?? item.inlineData?.data } } as { text?: string; inlineData?: { mimeType: string; data: string } }];
      }
      return [];
    });
  }

  if (typeof content === "string") return [{ text: content }];
  if (typeof content === "object") {
    const obj = content as Record<string, any>;
    if (obj.text) return [{ text: obj.text }];
  }
  return [];
}

/**
 * Convert any of the three incoming shapes to the canonical Vertex `contents` array:
 *
 *   Shape A  –  contents: Content[]                   (already correct, roles may need normalising)
 *   Shape B  –  contents: { parts: Part[] }           (single object, no role — wrap as user)
 *   Shape C  –  messages: { role, content }[]         (chat-style — map to Content[])
 *
 * Returns a `Content[]` ready to pass straight to the SDK.
 */
function buildContents(request: Record<string, any>): { role: "user" | "model"; parts: any[] }[] {
  const { contents, messages } = request;

  // ── Shape A: contents is already an array ─────────────────────────────────
  if (Array.isArray(contents)) {
    return contents.map((item: any) => ({
      role: toVertexRole(item?.role),
      parts: Array.isArray(item?.parts) ? item.parts : toParts(item?.content ?? item?.parts),
    }));
  }

  // ── Shape B: contents is { parts: [...] } ─────────────────────────────────
  if (contents && typeof contents === "object" && Array.isArray(contents.parts)) {
    return [{ role: "user", parts: contents.parts }];
  }

  // ── Shape C: messages array ───────────────────────────────────────────────
  if (Array.isArray(messages) && messages.length > 0) {
    return messages.map((m: any) => ({
      role: toVertexRole(m?.role ?? m?.author?.role),
      parts: toParts(m?.content),
    }));
  }

  // ── Fallback: nothing usable ──────────────────────────────────────────────
  throw new Error("[VertexService] Cannot build contents: request has no valid `contents` or `messages` field.");
}

// ---------------------------------------------------------------------------
// VertexService
// ---------------------------------------------------------------------------

export class VertexService {
  private ai: any;
  private project: string;
  private location: string;

  constructor() {
    const project =
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID;
    const location =
      process.env.VERTEX_LOCATION ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "global";

    if (!project || !location) {
      throw new Error(
        "Missing Vertex project or location. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (VERTEX_* are also supported)."
      );
    }

    this.project = project;
    this.location = location;

    // Remove any stray legacy Gemini API key so the SDK does not accidentally use it.
    if (process.env.GEMINI_API_KEY) {
      delete process.env.GEMINI_API_KEY;
    }

    const explicitAuth = process.env.GOOGLE_API_KEY || process.env.GOOGLE_CREDENTIALS_JSON;
    const looksLikeJson = typeof explicitAuth === 'string' && explicitAuth.trim().startsWith('{');

    if (looksLikeJson) {
      const credentialsPath = path.join(process.cwd(), ".temp-google-credentials.json");
      try {
        fs.writeFileSync(credentialsPath, explicitAuth);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
        console.info("[VertexService] Using explicit service account JSON for authentication (temporary file)");
      } catch (err) {
        throw new Error("Failed to write GOOGLE_CREDENTIALS_JSON to disk: " + String(err));
      }
    } else if (explicitAuth) {
      console.info("[VertexService] Using explicit Vertex AI API key for authentication.");
    } else {
      console.info("[VertexService] Using Application Default Credentials (ADC)");
    }

    const clientOptions: any = {
      vertexai: true,
      project: this.project,
      location: this.location,
    };

    if (!looksLikeJson && explicitAuth) {
      clientOptions.apiKey = explicitAuth;
    }

    this.ai = new GoogleGenAI(clientOptions as any);
  }

  // ---------------------------------------------------------------------------
  // Response text extraction
  // ---------------------------------------------------------------------------

  private extractText(response: any): string {
    if (!response) return "";
    if (typeof response === "string") return response;
    if (response.text) return typeof response.text === "function" ? response.text() : response.text;
    if (response.outputText) return response.outputText;

    if (Array.isArray(response.candidates) && response.candidates.length) {
      return response.candidates
        .map((c: any) => c?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? c?.text ?? "")
        .join("\n");
    }
    if (Array.isArray(response.output) && response.output.length) {
      return response.output
        .map((o: any) => o?.content?.text ?? o?.text ?? (typeof o === "string" ? o : ""))
        .join("\n");
    }
    if (Array.isArray(response.generations) && response.generations.length) {
      return response.generations.map((g: any) => g?.text ?? "").join("\n");
    }

    return JSON.stringify(response);
  }

  // ---------------------------------------------------------------------------
  // generateContent — main entry point
  // ---------------------------------------------------------------------------

  async generateContent(request: any, opts?: { maxAttempts?: number; timeoutMs?: number }) {
    const maxAttempts = opts?.maxAttempts ?? 3;
    const timeoutMs = opts?.timeoutMs ?? 60_000;

  const preferredModels = ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image", "gemini-2.5-flash"];
    const attemptedModels = new Set<string>();

    let attempt = 0;
    let lastErr: any = null;

    while (++attempt <= maxAttempts) {
      try {
        // ── 1. Resolve model ────────────────────────────────────────────────
        let model: string = request.model;
        if (!model || !preferredModels.includes(model)) {
          model = preferredModels.find((m) => !attemptedModels.has(m)) ?? preferredModels[0];
          console.info(`[VertexService] defaulting to preferred model ${model}`);
        }
        attemptedModels.add(model);

        // ── 2. Build the canonical `contents` array ─────────────────────────
        //
        //  This is the single source of truth for content normalisation.
        //  buildContents() handles all three incoming shapes and always returns
        //  Content[] = { role: "user"|"model", parts: Part[] }[]
        //
        const contents = buildContents(request);

        // ── 3. Forward only the fields the SDK actually understands ─────────
        //  Crucially: drop `messages`, drop any stale top-level `contents`,
        //  and keep `config` (systemInstruction, temperature, etc.) as-is.
        const sdkRequest: Record<string, any> = {
          model,
          contents,
        };

        if (request.config) sdkRequest.config = request.config;
        if (request.generationConfig) sdkRequest.generationConfig = request.generationConfig;
        if (request.safetySettings) sdkRequest.safetySettings = request.safetySettings;

          console.info("[VertexService] calling generateContent with model:", model);
        try { console.debug("[VertexService] sdkRequest:", JSON.stringify({ ...sdkRequest, contents: sdkRequest.contents })); } catch { /* ignore */ }

        // ── 4. Call SDK with timeout ────────────────────────────────────────
        const callPromise = this.ai.models.generateContent(sdkRequest);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Vertex request timeout")), timeoutMs)
        );
        const response = await Promise.race([callPromise, timeoutPromise]);

        const text = this.extractText(response);
        return { ...response, text };

      } catch (err: any) {
        lastErr = err;
        const status = err?.status ?? err?.code ?? err?.response?.status;

        // Model not found → try next preferred model immediately
        const isModelNotFound = status === 404 || /not found/i.test(err?.message ?? "");
        if (isModelNotFound) {
          const nextModel = preferredModels.find((m) => !attemptedModels.has(m));
          if (nextModel) {
            attemptedModels.add(nextModel);
            request = { ...request, model: nextModel };
            console.info(`[VertexService] model not found; retrying with ${nextModel}`);
            attempt--; // don't burn a retry slot on a model-switch
            continue;
          }
        }

        // Retry on 429, 5xx, timeout, or transient network errors
        const shouldRetry =
          status === 429 ||
          (typeof status === "number" && status >= 500) ||
          /timeout/i.test(err?.message ?? "") ||
          /ECONNRESET|ENOTFOUND/.test(err?.message ?? "");

        if (attempt >= maxAttempts || !shouldRetry) throw err;

        const backoff = Math.min(1_000 * Math.pow(2, attempt - 1), 30_000);
        const wait = backoff + Math.floor(Math.random() * 300);
        console.warn(`[VertexService] attempt=${attempt} failed (status=${status}). Retrying in ${wait}ms.`, err?.message ?? err);
        await sleep(wait);
      }
    }

    throw lastErr ?? new Error("Failed to call Vertex AI generateContent");
  }
}
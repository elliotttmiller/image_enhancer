const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined)?.trim() || "/api";
const REQUEST_TIMEOUT_MS = 90000;

async function postJson(path: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  const model = typeof body === "object" && body !== null && "model" in body ? String((body as any).model) : "unknown";
  console.log(`[VertexClient] POST ${path} model=${model}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    window.clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Vertex request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`);
    }
    throw error;
  }
  window.clearTimeout(timeoutId);

  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return text ? { error: { message: text } } : null;
  });

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log(`[VertexClient] ${response.status} ${path} model=${model} duration=${elapsedMs}ms`);

  if (!response.ok) {
    const message =
      payload?.error?.message
      || payload?.message
      || `Vertex proxy request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

export class GoogleGenAI {
  models: {
    generateContent: (req: any) => Promise<any>
  };

  constructor(_opts?: any) {
    this.models = {
      generateContent: async (req: any) => postJson("/models/generate-content", req),
    };
  }
}

const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined)?.trim() || "/api";

async function postJson(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return text ? { error: { message: text } } : null;
  });

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

import { GoogleGenAI as GoogleGenAISDK } from "@google/genai";

let sdkInstance: GoogleGenAISDK | null = null;

function getApiKey(): string {
  const env = (import.meta as any).env ?? {};
  const apiKey = (env.VITE_GOOGLE_API_KEY as string | undefined)?.trim()
    || (env.VITE_GOOGLE_CREDENTIALS_JSON as string | undefined)?.trim();

  if (!apiKey) {
    throw new Error(
      "Missing VITE_GOOGLE_API_KEY. Configure a browser-safe Gemini API key for this static deployment."
    );
  }

  return apiKey;
}

function getSdk(): GoogleGenAISDK {
  if (!sdkInstance) {
    sdkInstance = new GoogleGenAISDK({ apiKey: getApiKey() });
  }
  return sdkInstance;
}

export class GoogleGenAI {
  models: {
    generateContent: (req: any) => Promise<any>
  };

  constructor(opts?: any) {
    this.models = {
      generateContent: async (req: any) => getSdk().models.generateContent(req),
    };
  }
}

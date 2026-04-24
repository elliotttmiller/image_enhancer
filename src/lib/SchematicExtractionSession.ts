import { GoogleGenAI } from "./vertex-client";
import { STAGE_2_SYSTEM, STAGE_4_SYSTEM, STAGE_6_SYSTEM } from "./prompts";
import { normalizedToPixelBBox, normalizedToPixelPoint, bboxCenter } from "./coordUtils";

export class SchematicExtractionSession {
  constructor(
    private schematicId: string,
    private knownPrefixes: string[]
  ) {}

  async run(base64Image: string, imgW: number, imgH: number): Promise<any[]> {
  // Frontend uses a shim that posts to the server endpoint; do not reference
  // client-side API keys here. The shim ignores opts and always POSTs to /api/vertex/generate.
  const ai = new GoogleGenAI();
    const model = ai.models;

    // Stage 2: Style Classifier
    const stage2Response = await model.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image } },
          { text: "Analyze this technical schematic diagram and provide classification JSON." }
        ]
      },
      config: {
        systemInstruction: STAGE_2_SYSTEM,
        responseMimeType: "application/json"
      }
    });

    const stage2Meta = JSON.parse(stage2Response.text || "{}");

    // Stage 4: Per-Crop OCR (Simplified for now)
    const stage4Response = await model.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image } },
          { text: `Analyze the image and extract labels. Context: ${JSON.stringify(stage2Meta)}` }
        ]
      },
      config: {
        systemInstruction: STAGE_4_SYSTEM,
        responseMimeType: "application/json"
      }
    });

    const stage4Results = JSON.parse(stage4Response.text || "[]");

    // Stage 6: Full-Image QA
    const stage6Response = await model.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image } },
          { text: `Validate the following extractions: ${JSON.stringify(stage4Results)}` }
        ]
      },
      config: {
        systemInstruction: STAGE_6_SYSTEM,
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(stage6Response.text || "[]");
  }
}

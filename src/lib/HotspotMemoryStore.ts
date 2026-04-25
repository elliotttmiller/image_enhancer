// Use JSON Schema string literals here to avoid bundling server SDKs into the client.
import { GoogleGenAI } from "./vertex-client";
import { RawHotspot } from "../types";
import { drawHotspotsOnImage } from "./hotspotOverlay";

export class HotspotMemoryStore {
  private history: any[] = [];
  private model: string;

  constructor(model: string = "gemini-2.5-flash-image") {
    this.model = model;
  }

  async refine(base64Image: string, mimeType: string, instruction: string, currentHotspots: RawHotspot[]): Promise<RawHotspot[]> {
    console.log("[DEBUG] HotspotMemoryStore.refine: Starting");

    const prompt = `Analyze this technical schematic diagram.

TASK: Review the existing hotspots and refine them with surgical precision.

CRITICAL INSTRUCTIONS FOR PRECISION:
1. Bounding Box Format: [ymin, xmin, ymax, xmax] normalized to 0-1000.
2. Pixel-Perfect Alignment: The bounding box MUST tightly enclose only the label text or the bubble containing the text. Do not include leader lines, arrows, or surrounding geometry.
3. Corrections:
   a. Identify any misplaced bounding boxes and correct them to be pixel-perfect.
   b. Identify any missing hotspots and add them.
   c. Remove any false positives (e.g., text that is not a callout label).
   d. Correct any incorrect labels.
4. Preservation: PRESERVE the 'part_box_2d' field from the existing hotspots if it exists and is accurate.
5. Verification: Re-verify each bounding box against the image to ensure it is pixel-perfect.

Existing Hotspots (JSON): ${JSON.stringify(currentHotspots)}

Output ONLY the refined list in the requested JSON format. Do not generate any images or any other content.`;

    const ai = new GoogleGenAI();
    console.log("[DEBUG] HotspotMemoryStore.refine: Calling Gemini");

    const response = await ai.models.generateContent({
      model: this.model,
      contents: [
        ...this.history,
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      config: {
        systemInstruction: "You are a precision optical engineering analyst specializing in technical schematic diagrams. Your task is to review and refine existing hotspot extractions. Accuracy is critical.",
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              box_2d: { type: "array", items: { type: "number" } },
              part_box_2d: { type: "array", items: { type: "number" } },
              confidence: { type: "number" },
            },
            required: ["label", "box_2d", "confidence"],
          },
        },
      },
    });
    
    const text = response.text?.trim();
    console.log(`[DEBUG] HotspotMemoryStore.refine: Received response text (length: ${text?.length})`);
    if (!text) {
      console.error("[DEBUG] HotspotMemoryStore.refine: No text in response");
      throw new Error("No refined hotspots returned from analysis.");
    }

    // Update history
    this.history.push({ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] });
    this.history.push({ role: "model", parts: [{ text }] });

    try {
      const parsed = JSON.parse(text);
      console.log(`[DEBUG] HotspotMemoryStore.refine: Parsed ${parsed.length} hotspots`);
      if (!Array.isArray(parsed)) {
        throw new Error("Response is not an array");
      }
      return parsed.map((item: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        label: item.label,
        box_2d: item.box_2d,
        part_box_2d: item.part_box_2d,
        confidence: item.confidence,
      })) as RawHotspot[];
    } catch (e) {
      console.error("[DEBUG] HotspotMemoryStore.refine: Failed to parse JSON", e);
      throw new Error("Failed to parse refined hotspots JSON: " + (e instanceof Error ? e.message : String(e)));
    }
  }
}

let instance: HotspotMemoryStore | null = null;
export function getHotspotMemoryStore(): HotspotMemoryStore {
  if (!instance) {
    instance = new HotspotMemoryStore("gemini-2.5-flash-image");
  }
  return instance;
}

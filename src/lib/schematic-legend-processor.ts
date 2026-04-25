// Avoid importing the server-only `@google/genai` runtime in files that may
// be bundled for the browser. Use JSON Schema string literals instead.
import { GoogleGenAI } from "./vertex-client";
import { withRetry } from "./gemini";
import { STAGE_2_SYSTEM, STAGE_4_SYSTEM, STAGE_6_SYSTEM } from "./prompts";

export interface ExtractedHotspot {
  id: string;
  label: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  polygon_2d?: [number, number][]; // Array of [y, x] points normalized 0-1000
  shape?: string;
  description?: string;
  partNumber?: string;
}

export interface LegendEntry {
  label: string;
  description: string;
  partNumber?: string;
  quantity?: number;
}

export interface PageClassification {
  pageIndex: number;
  type: 'SCHEMATIC' | 'LEGEND' | 'OTHER';
}

export interface CorrelatedData {
  hotspots: {
    id: string;
    label: string;
    box_2d: [number, number, number, number];
    description?: string;
    partNumber?: string;
  }[];
  schematicPageIndex: number;
  legendPageIndex?: number;
  updatedJsonData?: any;
  mapping?: Record<string, string>;
}

export async function classifyPage(base64Image: string, mimeType: string): Promise<PageClassification['type']> {
  const prompt = `Analyze this page from a technical document.
Classify the page type as either 'SCHEMATIC', 'LEGEND', or 'OTHER'.
- 'SCHEMATIC': Contains a diagram, drawing, or illustration of parts, usually with callout numbers/labels pointing to parts.
- 'LEGEND': Contains a table or list mapping callout numbers/labels to part names, descriptions, or part numbers.
- 'OTHER': Anything else (title page, blank page, general text).

Return ONLY a JSON object with a single key "type" containing one of the three string values.`;

  return withRetry(async (attempt, model) => {
  const ai = new GoogleGenAI();
    
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: prompt }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ['SCHEMATIC', 'LEGEND', 'OTHER']
            }
          },
          required: ["type"]
        }
      }
    });

    const result = JSON.parse(response.text || '{"type": "OTHER"}');
    return result.type as PageClassification['type'];
  }, 'text');
}

export interface ExtractedLabel {
  rawText: string;
  cleanLabel: string;
  quantity: number;
}

export async function extractSchematicLabels(base64Image: string, mimeType: string): Promise<ExtractedLabel[]> {
  const prompt = `Analyze this schematic diagram. Extract all the part label callouts pointing to parts in the diagram.
If a callout includes a quantity indicator (e.g., "2x 4700", "4700 (2)", "3X 1234"), separate the base label from the quantity.
Return a JSON array of objects, each with:
- 'rawText': the exact text found on the diagram (e.g., "2x 4700")
- 'cleanLabel': the clean part number/code without the quantity (e.g., "4700")
- 'quantity': the quantity indicated (number, default to 1 if not specified)`;

  return withRetry(async (attempt, model) => {
  const ai = new GoogleGenAI();
    
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: prompt }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rawText: { type: "string" },
              cleanLabel: { type: "string" },
              quantity: { type: "number" }
            },
            required: ["rawText", "cleanLabel", "quantity"]
          }
        }
      }
    });

    return JSON.parse(response.text || '[]');
  }, 'text');
}

export async function extractSchematicData(base64Image: string, mimeType: string): Promise<ExtractedHotspot[]> {
  return withRetry(async (attempt, model) => {
  const ai = new GoogleGenAI();
    
    // Stage 2: Style Classifier
    const stage2Response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: "Analyze this technical schematic diagram and provide classification JSON." }
        ]
      }],
      config: {
        systemInstruction: STAGE_2_SYSTEM,
        responseMimeType: "application/json"
      }
    });

    const stage2Meta = JSON.parse(stage2Response.text || "{}");

    const hotspotSchema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "A unique identifier for this hotspot" },
          label: { type: "string", description: "The text of the callout label" },
          box_2d: {
            type: "array",
            items: { type: "number" },
            description: "The bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000"
          },
          polygon_2d: {
            type: "array",
            items: {
              type: "array",
              items: { type: "number" }
            },
            description: "An array of [y, x] points normalized to 0-1000 that trace the exact outline of the hotspot shape."
          },
          shape: { type: "string", description: "The geometric shape of the component ('rectangle', 'square', 'circle', 'hexagon', 'triangle', etc.)" }
        },
        required: ["id", "label", "box_2d", "shape"]
      }
    };

    // Stage 4: Per-Crop OCR
    const stage4Response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: `Analyze the image and extract labels. Context: ${JSON.stringify(stage2Meta)}` }
        ]
      }],
      config: {
        systemInstruction: STAGE_4_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: hotspotSchema
      }
    });

    const stage4Results = JSON.parse(stage4Response.text || "[]");

    // Stage 6: Full-Image QA
    const stage6Response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: `Validate the following extractions: ${JSON.stringify(stage4Results)}` }
        ]
      }],
      config: {
        systemInstruction: STAGE_6_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: hotspotSchema
      }
    });

    return JSON.parse(stage6Response.text || "[]");
  }, 'text');
}

export async function auditAndUpdateJson(base64Image: string, mimeType: string, hotspots: ExtractedHotspot[], existingJsonData: any): Promise<{ updatedJsonData: any, mapping: Record<string, string> }> {
  return withRetry(async (attempt, model) => {
    // 1. Map hotspots to part IDs using AI
    const mappingPrompt = `Map the following extracted hotspots to the part IDs in the provided JSON.
    Return a JSON object where keys are the part IDs from the JSON and values are the corresponding hotspot ID.
    
    JSON Parts:
    ${JSON.stringify(existingJsonData.parts, null, 2)}
    
    Hotspots:
    ${JSON.stringify(hotspots, null, 2)}
    
    Return ONLY the mapping JSON object.`;

  const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: mappingPrompt }
        ]
      }],
      config: {
        responseMimeType: "application/json"
      }
    });

    const mapping = JSON.parse(response.text || '{}');

    // 2. Update coordinates in TS
    const updatedJsonData = JSON.parse(JSON.stringify(existingJsonData)); // Deep clone
    
    console.log("[DEBUG] auditAndUpdateJson: updatedJsonData parts before update:", updatedJsonData.parts);

    for (const [partId, hotspotId] of Object.entries(mapping)) {
      const hotspot = hotspots.find(h => h.id === hotspotId);
      if (hotspot && updatedJsonData.coordinates[partId]) {
        const ymin = hotspot.box_2d[0];
        const xmin = hotspot.box_2d[1];
        const ymax = hotspot.box_2d[2];
        const xmax = hotspot.box_2d[3];
        
        const x_pct = (((xmin + xmax) / 2) / 1000) * 100;
        const y_pct = (((ymin + ymax) / 2) / 1000) * 100;
        
        const width_pct = ((xmax - xmin) / 1000) * 100;
        const height_pct = ((ymax - ymin) / 1000) * 100;

        const imgWidth = updatedJsonData.image_natural_width || 1000;
        const imgHeight = updatedJsonData.image_natural_height || 1000;
        
        updatedJsonData.coordinates[partId].x_pct = x_pct;
        updatedJsonData.coordinates[partId].y_pct = y_pct;
      }
    }
    
    console.log("[DEBUG] auditAndUpdateJson: updatedJsonData parts after update:", updatedJsonData.parts);
    
    return { updatedJsonData, mapping };
  }, 'text');
}

export async function extractLegendData(base64Image: string, mimeType: string): Promise<LegendEntry[]> {
  const prompt = `Analyze this legend/key table page.
Extract the table mapping the callout labels to their part names/descriptions, part numbers, and quantities (if available).
Return a JSON array of objects, each with 'label' (the callout number/code), 'description' (the part name/description), 'quantity' (as a number), and optionally 'partNumber'.`;

  return withRetry(async (attempt, model) => {
  const ai = new GoogleGenAI();
    
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: prompt }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              description: { type: "string" },
              partNumber: { type: "string" },
              quantity: { type: "number" }
            },
            required: ["label", "description"]
          }
        }
      }
    });

    return JSON.parse(response.text || '[]');
  }, 'text');
}

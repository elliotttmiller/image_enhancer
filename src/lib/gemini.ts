// gemini.ts
// Production Grade — v3.1
// Elite prompt architecture, circuit-breaker resilience, precision generation

import { GoogleGenAI } from "./vertex-client";
import { SchematicExtractionSession } from "./SchematicExtractionSession";
import {
  AspectRatio,
  AspectRatioOption,
  ImageSize,
  ModelVersion,
  OutputQuality,
  ErrorCode,
  AppError,
  ValidationResult,
  GenerationMetadata,
  ProcessingComplexity,
  ImageMimeType,
  RawHotspot,
} from "../types";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCallTime = 0;
export const rateLimit = async () => {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < 12000) {
    await sleep(12000 - elapsed);
  }
  lastCallTime = Date.now();
};

// ============================================================================
// PART 1: SCHEMATIC ENHANCER — STYLE SYSTEM & PROMPTS
// ============================================================================

export type SchematicStyle =
  | "modern"
  | "blueprint"
  | "patent"
  | "artistic"
  | "minimalist"
  | "isometric"
  | "vintage"
  | "realistic"
  | "production"
  | "hybrid-realism";

export interface StyleDescriptor {
  /** Injected verbatim into the generation prompt */
  prompt: string;
  /** Blend weight when multiple styles are selected (0.0–1.0) */
  weight: number;
  /** Short human-readable description for UI display */
  label: string;
  /** Temperature offset applied on top of the base value */
  temperatureDelta: number;
}

const STYLE_REGISTRY: Record<SchematicStyle, StyleDescriptor> = {
  "hybrid-realism": {
    label: "Hybrid CAD Realism",
    temperatureDelta: -0.05, // Lower temp for extreme geometric precision
    weight: 1.0,
    prompt: `
STYLE — Hybrid CAD Realism (Premium Exploded View):
  • Target Aesthetic: High-end 3D CAD technical render (e.g., KeyShot technical mode or SolidWorks RealView).
  • Material Realism: Semi-realistic. Apply accurate physical material properties (e.g., brushed aluminum, matte black anodized metal, glossy polymer, molded rubber) but keep them PERFECTLY CLEAN and pristine. 
  • Prohibition: NO photographic noise, NO dirt, NO scratches, NO hyper-realistic micro-textures.
  • Lighting: Soft, even studio global illumination. Smooth, perfect gradients on cylindrical and spherical surfaces. 
  • Shadows: Subtle self-shadowing/ambient occlusion to show depth, but ZERO cast shadows on the background.
  • Edges: Retain ultra-crisp, thin (1px) silhouette edges and form-break lines around components to preserve the strict "diagram" aesthetic.
  • Background: STRICTLY pure white (#FFFFFF).`,
  },

  modern: {
    label: "Modern CAD",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — Modern CAD Technical Drawing:
  • Background: pure white (#FFFFFF), zero bleed.
  • Stroke weights: outer contour 2–3 px, primary features 1–2 px, fine detail 0.5–1 px.
  • Colour: monochrome black (#000000); optional single accent (#0055CC) for dimension arrows only.
  • Shading: subtle ambient occlusion in recessed geometry only; no gradient fills.
  • Aesthetic: ISO 128 / ASME Y14.3 compliant; professional engineering CAD output.`,
  },

  blueprint: {
    label: "Blueprint",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — Classic Engineering Blueprint:
  • Background: deep blueprint blue (#1A3A5C), uniform flat fill.
  • Lines: crisp white (#FFFFFF), weight 1–2 px; hairlines at 0.5 px.
  • Grid: 5 mm reference grid overlay at 15% white opacity.
  • Contrast ratio: minimum 10:1 (WCAG AAA equivalent for technical drawings).`,
  },

  patent: {
    label: "Patent Drawing",
    temperatureDelta: -0.05,
    weight: 1.0,
    prompt: `
STYLE — US Patent Office Illustration (37 CFR 1.84 compliant):
  • Ink: solid black (#000000) ONLY — no grey, no gradients, no colour.
  • Shading technique: parallel hatching at 45° (section views), stippling for curved surfaces.
  • Line weights: outlines 0.35 mm, section lines 0.18 mm, centre lines 0.18 mm dashed.
  • No decorative borders, logos, or non-standard annotation styles.`,
  },

  artistic: {
    label: "Artistic Technical",
    temperatureDelta: +0.1,
    weight: 0.9,
    prompt: `
STYLE — Technical Art / Marker-Style Rendering:
  • Line quality: varied stroke weight (0.5–4 px) for visual hierarchy and depth.
  • Shading: warm marker-style gradients with hard-edge termination; avoid soft airbrush.
  • Highlight: sharp white specular on radii and edges.
  • Priority: mechanical accuracy preserved; artistic treatment is supplementary.`,
  },

  minimalist: {
    label: "Minimalist",
    temperatureDelta: -0.1,
    weight: 1.0,
    prompt: `
STYLE — Minimalist Line Art:
  • Background: pure white (#FFFFFF).
  • Strokes: single weight, uniform 0.75 px, solid black (#000000).
  • Zero shading, zero fills, zero gradients, zero textures.
  • Geometry only: every non-essential decorative line removed.`,
  },

  isometric: {
    label: "Isometric",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — True Isometric Technical Projection:
  • Projection: 30° isometric (IEC 60617 dimetric variant acceptable for complex assemblies).
  • Perspective distortion: strictly forbidden — all axes must be mathematically correct.
  • Hidden lines: optional 0.25 px dashed grey (#BDBDBD).`,
  },

  vintage: {
    label: "Vintage",
    temperatureDelta: +0.05,
    weight: 0.95,
    prompt: `
STYLE — Early 20th-Century Engineering Drawing:
  • Background: aged cream / yellowed paper (#EDE5C8) with subtle irregular grain texture.
  • Ink: warm sepia (#3D2B1A) with natural ink-spread variation (±5% stroke width).
  • Imperfections: slight letter-press impression, minor ink bleed at intersections.`,
  },

  realistic: {
    label: "Enhanced Realism",
    temperatureDelta: +0.05,
    weight: 0.90,
    prompt: `
STYLE — Enhanced Realistic Schematic (NOT a photograph):
  • Target: A modernized, highly realistic technical diagram that clearly communicates physical materials while remaining a structural schematic.
  • Materials: Apply realistic textures (e.g., brushed steel, matte rubber, glossy polymer) directly to the schematic geometry.
  • Lighting: Single soft directional source from upper-left to give 3D volume to the diagram parts.
  • Edges: Retain crisp 1-2 px silhouette lines on all parts to preserve the "diagram" aesthetic.
  • PROHIBITED: Photography-style bokeh, HDR tone mapping, or removing the diagrammatic nature of the image.`,
  },

  production: {
    label: "Production Illustration",
    temperatureDelta: -0.05,
    weight: 1.0,
    prompt: `
STYLE — Production-Grade Technical Illustration:
  • Target aesthetic: SolidWorks "Technical Illustration" render mode — unambiguously 3D, unambiguously technical, never photographic.
  • Geometry: ultra-precise line work — perfectly straight edges, perfect circles, consistent arc radii.
  • Shading model: Lambert diffuse shading with a single overhead-left light source.
  • Overall result: the illustration must be immediately recognisable as a professional technical drawing, not a 3D render and not a flat CAD print.`,
  },
};

/**
 * Canonical system role for SCHEMATICS.
 */
const SCHEMATIC_SYSTEM_ROLE = `You are a Principal Industrial Design Engineer and Senior Technical Illustrator with 25 years of experience.
Your expertise spans mechanical assemblies, engineering drawing standards (ISO 128, ASME Y14.3), and CAD technical illustration.

CRITICAL OUTPUT STANDARD:
You are enhancing an original/old schematic diagram. You must output a highly realistic, modernized schematic diagram. 
It must look like a premium technical illustration (e.g., SolidWorks Technical Render) — clearly 3D through precise shading, material-differentiated, geometrically exact — but NEVER a standard photograph. 
Errors in geometry, missing parts, or missing/altered callouts are production defects and are completely unacceptable.`.trim();

/** Quality tier system prompts */
const QUALITY_DIRECTIVES: Record<OutputQuality, string> = {
  standard:
    "Output Quality: Standard. Balanced fidelity and generation speed. Acceptable minor geometric simplifications on sub-5mm features.",
  high:
    "Output Quality: High. Enhanced line precision, complete component inventory, sharp intersections. No visible approximations on any visible feature.",
  maximum:
    `Output Quality: Maximum — Production Ready.
  VISUAL BENCHMARK: The output must be indistinguishable from a professional illustration produced by a senior technical artist.
  GEOMETRY & PRECISION: Absolute perfection — every line straight, every circle perfect, every thread consistent. The exploded view layout MUST remain exactly as it is in the source image.
  COMPLETENESS: Zero omissions. Every fastener, bearing, seal, and sub-component present.`,
};

function buildSchematicEnhancePrompt(
  config: SchematicEnhancementConfig,
  styleBlock: string,
  labelDirective: string,
  hasReferenceImages: boolean = false
): string {
  return `
<ROLE>
${SCHEMATIC_SYSTEM_ROLE}
</ROLE>

<INTERNAL_ANALYSIS>
Step 1: INVENTORY - Mentally scan the input schematic. Count every distinct component, fastener, and structural member.
Step 2: TOPOLOGY - Identify how components connect. Understand the assembly hierarchy and the exact exploded-view layout.
Step 3: GEOMETRY - Note every circle, arc, angle, and symmetry axis.
Step 4: ANNOTATION - Identify all callout bubbles, reference numbers, and leader lines. Identify all outer page borders, title blocks, and branding.
Step 5: GENERATION PLAN - Re-draw the assembly at higher fidelity, preserving perfect geometry and callouts, while erasing all page-level branding.
</INTERNAL_ANALYSIS>

<PRIMARY_TASK>
RE-ENGINEER and ENHANCE the schematic provided in the attached image.
You are COMPLETELY RE-DRAWING the assembly from scratch at higher fidelity, making it look more realistic and enhanced, while STRICTLY maintaining its exact layout, geometry, and identity as a schematic diagram.
</PRIMARY_TASK>

<MANDATORY_REQUIREMENTS>

1. COMPLETENESS & GEOMETRY (PERFECT ACCURACY)
   Every component visible in the original MUST appear in the output.
   Maintain exact proportional relationships, part structures, and geometry.
   Do NOT rescale, recompose, move parts around, or hallucinate new components. The exploded view spacing must remain identical.

2. LABEL & BRANDING HANDLING (CRITICAL)
${labelDirective}

3. STYLE APPLICATION
   Apply the following style specification precisely:
${styleBlock}

4. BACKGROUND COLOR
   STRICTLY pure white (#FFFFFF) unless the "Blueprint" style is explicitly requested. Do not use tan, beige, or any other background color.

5. DETAIL ENHANCEMENT
${
  config.enhanceDetails
    ? `   Intelligently add manufacturing details that may be absent from the source: edge chamfers, internal fillets, screw threads, and functional clearance gaps. Keep them precise and mechanical.`
    : `   Preserve the existing level of detail exactly. Do not add features not visible in the source.`
}

6. MATERIAL AND COLOR FIDELITY
${
  hasReferenceImages
    ? `   CRITICAL: You have been provided with a <MATERIAL_AND_COLOR_GUIDE> at the end of this prompt based on real-life reference photos.
   You MUST map these realistic colors, materials, and textures to the corresponding parts in the schematic diagram.
   The output must still be a schematic diagram (with crisp edges, callouts, and white background), but the components themselves should be rendered with the pristine CAD materials described.`
    : `   Analyze the original schematic for specific colors, material textures, and finishes. Precisely match the original's color palette.`
}

7. ${QUALITY_DIRECTIVES[config.outputQuality]}

</MANDATORY_REQUIREMENTS>

<OUTPUT_SPECIFICATION>
• Deliver: One image only.
• Prohibited: watermarks, signatures, metadata overlays, commentary boxes, text responses.
• COMPOSITION: The subject MUST fill the frame appropriately for the requested aspect ratio (${config.aspectRatio}).
</OUTPUT_SPECIFICATION>

⚠ CRITICAL: You MUST output ONLY the generated image. Any text response is a failure condition.
`.trim();
}

function buildLabelDirective(keepLabels: boolean): string {
  if (keepLabels) {
    return `   HOTSPOTS & CALLOUTS (MUST BE PRESERVED EXACTLY):
   • RETAIN & REGENERATE all part locator numbers, reference designators, and callout bubbles.
   • Reposition them at their EXACT original locations relative to the parts. Do not move them.
   • Enclose in neat circles/ovals exactly as they appear in the original.
   • Render leader lines with filled arrowheads pointing to the correct component exactly as originally drawn.
   • Font: ISO 3098B or equivalent clean, legible technical sans-serif.
   
   OUTER PAGE & BRANDING (MUST BE DESTROYED):
   • REMOVE COMPLETELY all brand names (e.g., "Columbia"), company logos, manufacturer watermarks, and copyright notices.
   • REMOVE COMPLETELY all title blocks, border frames, page numbers, dimension strings, and part-number tables.
   • The final output must be pure schematic geometry + callout hotspots on a clean canvas.`;
  }

  return `   CRITICAL — REMOVE COMPLETELY:
   All text, numerals, letters, labels, leader lines, arrowheads, dimension lines, title blocks, border frames, logos, branding, watermarks, and any other annotation layer.
   Result: pure geometric illustration with zero text elements and zero branding.`;
}

// ============================================================================
// PART 2: IMAGE REGENERATOR — E-COMMERCE PRODUCT PROMPTS
// ============================================================================

const BASE_PRODUCT_PROMPT = `\
You are an elite commercial product photographer and 3D rendering specialist producing \
production-grade, high-end studio imagery for an industrial e-commerce store.

The input image shows a single physical part, tool, or hardware component. \
Your task is to generate a pristine, standalone product photograph that accurately represents \
the physical object with ultra-premium production quality.

CRITICAL DISTINCTION (ANTI-SCHEMATIC FIREWALL):
This is a PRODUCT PHOTOGRAPH for an online store, NOT a schematic diagram.
• DO NOT include any diagrammatic lines, dimensions, rulers, labels, leader lines, or text.
• DO NOT include any borders, title blocks, or outer page details.
• If the input image has text, numbers, or schematic elements, completely IGNORE AND REMOVE THEM.
• Output ONLY the photorealistic physical object.

OUTPUT STANDARD (APPLY TO ALL RENDERS):
• Background: Pure white (#FFFFFF), infinite/seamless studio sweep. No gradients or vignettes.
• Lighting: Professional e-commerce studio lighting. Soft directional key light from upper-left, secondary fill light, no harsh clipping.
• Shadow: A realistic, subtle, sharp-edged contact shadow grounding the object to the surface.
• Focus: Edge-to-edge sharp focus on the entire part. No depth-of-field blur.
• Material Fidelity: Hyper-realistic physical textures (e.g., brushed steel, matte black oxide, glossy polymer, brass) at 4K-grade resolution.
`;

const CLONE_PRODUCT_PROMPT = `\
${BASE_PRODUCT_PROMPT}

MODE: PRECISION STUDIO RECREATION (1:1 CLONE)

Recreate this part as a pristine new studio render that EXACTLY matches the \
source image's camera angle, perspective, and spatial composition. \
This is a fresh rendering that elevates production quality while preserving every physical characteristic.

GEOMETRY & COMPOSITION:
• Camera angle, elevation, and perspective: identical to source.
• Object position and orientation within the frame: identical.
• All structural features (holes, slots, threads, teeth, ridges): reproduced at their correct scale and 3D depth.

PRODUCTION UPGRADES:
• Material surface: sharper texture definition, accurate metallic/polymer reflections.
• Lighting: cleaner, more dramatic studio key light revealing surface geometry.
• Background: pristine seamless white with accurate soft contact shadow.
`;

const CREATIVE_PRODUCT_PROMPT = `\
${BASE_PRODUCT_PROMPT}

MODE: PREMIUM COMMERCIAL SHOWCASE (CREATIVE ANGLE)

Transform this part into a stunning, high-end commercial 3D render. \
The result must be a COMPLETELY NEW and UNIQUE professional showcase image that visually transcends the original snapshot.

MANDATORY AESTHETIC TRANSFORMATIONS:
• Camera Angle & Perspective: Shift the perspective significantly to show off the part's best features (e.g., rotate 15-35 degrees, isometric tilt). DO NOT trace or reuse the original 2D silhouette. 
• Studio Lighting: Implement dramatic, cinematic studio lighting. Introduce striking directional light, bright edge-rim lighting, and soft-box reflections to make the form pop.
• Drop Shadow: Gorgeous, soft-tapered commercial contact shadow on a pristine white background.

MECHANICAL INTEGRITY (STRICT CONSTRAINTS):
• Object Count: EXACTLY match the number of parts in the original (e.g., 1 part = 1 part. NO duplicates).
• Core Dimensions: Maintain all accurate structural scale, hole placements, and 3D bends.
• NO HALLUCINATED HARDWARE: Do NOT add any handles, mounts, extra bolts, or structural extensions that do not explicitly exist in the source image.
`;

function buildProductPrompt(
  mode: 'creative' | 'clone',
  customPrompt: string = ""
): string {
  const base = mode === 'clone' ? CLONE_PRODUCT_PROMPT : CREATIVE_PRODUCT_PROMPT;
  if (!customPrompt.trim()) return base;
  return `${base}\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt.trim()}`;
}

// ============================================================================
// CONFIGURATION & TYPES
// ============================================================================

export interface SchematicEnhancementConfig {
  styles: SchematicStyle[];
  keepLabels: boolean;
  aspectRatio: AspectRatioOption;
  imageSize: ImageSize;
  model: ModelVersion;
  customPrompt: string;
  preserveGeometry: boolean;
  enhanceDetails: boolean;
  outputQuality: OutputQuality;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const MODEL_DEFAULTS: Record<
  ModelVersion,
  { temperature: number; topP: number; topK: number }
> = {
  "gemini-2.5-flash": { temperature: 0.55, topP: 0.90, topK: 32 },
  "gemini-2.5-flash-image": { temperature: 0.50, topP: 0.88, topK: 32 },
  "gemini-3.1-flash-image-preview": { temperature: 0.50, topP: 0.88, topK: 32 },
  "gemini-3-pro-image-preview": { temperature: 0.52, topP: 0.88, topK: 32 },
};

function getModelDefaults(model: string) {
  if (MODEL_DEFAULTS[model as ModelVersion]) return MODEL_DEFAULTS[model as ModelVersion];
  return model.includes('image') ? MODEL_DEFAULTS['gemini-2.5-flash-image'] : MODEL_DEFAULTS['gemini-2.5-flash'];
}

function resolveSchematicTemperature(
  model: ModelVersion,
  styles: SchematicStyle[],
  quality: OutputQuality
): number {
  const base = getModelDefaults(model).temperature;
  const styleDelta = styles.reduce((acc, s) => acc + (STYLE_REGISTRY[s]?.temperatureDelta ?? 0), 0) / Math.max(styles.length, 1);
  const qualityDelta = quality === "maximum" ? -0.10 : quality === "high" ? -0.05 : 0;
  return Math.max(0.1, Math.min(1.0, base + styleDelta + qualityDelta));
}

// ============================================================================
// ERROR HANDLING & RETRY ENGINE
// ============================================================================

function classifyError(raw: unknown, attempt: number): AppError {
  let msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw);
  const lc = msg.toLowerCase();
  
  const retryable = !(
    lc.includes("api_key_service_blocked") ||
    lc.includes("service_blocked") ||
    lc.includes("api_key_invalid") ||
    lc.includes("api key not valid") ||
    lc.includes("api_key") ||
    lc.includes("api key") ||
    lc.includes("authentication") ||
    lc.includes("billing") ||
    lc.includes("permission")
  );
  let code = ErrorCode.UNKNOWN;
  if (lc.includes("api_key_service_blocked") || lc.includes("service_blocked")) {
    code = ErrorCode.API_SERVICE_BLOCKED;
    msg = "The configured Google API key is blocked from calling the Gemini Developer API (`generativelanguage.googleapis.com`). Enable Gemini Developer API access for this key/project or replace it with a key that is allowed to call Gemini models.";
  } else if (lc.includes("api_key_invalid") || lc.includes("api key not valid") || lc.includes("invalid api key")) {
    code = ErrorCode.INVALID_API_KEY;
  } else if (lc.includes("api_key") || lc.includes("api key")) {
    code = ErrorCode.MISSING_API_KEY;
  }
  else if (lc.includes("quota") || lc.includes("exhausted")) code = ErrorCode.QUOTA_EXCEEDED;
  else if (lc.includes("billing")) code = ErrorCode.BILLING_REQUIRED;
  else if (lc.includes("rate") || lc.includes("429")) code = ErrorCode.RATE_LIMITED;
  else if (lc.includes("timeout")) code = ErrorCode.TIMEOUT;
  else if (lc.includes("network") || lc.includes("fetch")) code = ErrorCode.NETWORK_ERROR;
  else if (lc.includes("no candidates")) code = ErrorCode.NO_CANDIDATES;
  else if (lc.includes("text instead of image")) code = ErrorCode.TEXT_RESPONSE;
  else if (lc.includes("no image")) code = ErrorCode.NO_IMAGE_IN_RESPONSE;

  return { code, message: msg, retryable, attempt, originalError: raw };
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 800, maxDelayMs: 10000, backoffMultiplier: 2.0 };

export async function withRetry<T>(
  fn: (attempt: number, model: string) => Promise<T>,
  modelType: 'text' | 'image' = 'text',
  policy: RetryPolicy = DEFAULT_RETRY
): Promise<T> {
  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const model = getModelForAttempt(attempt, modelType);
    try {
      return await fn(attempt, model);
    } catch (raw) {
      lastError = classifyError(raw, attempt);
      if (!lastError.retryable) throw lastError;
      if (attempt < policy.maxAttempts) {
        const jitter = Math.random() * 200;
        const delay = Math.min(policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1) + jitter, policy.maxDelayMs);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function getModelForAttempt(attempt: number, type: 'text' | 'image' = 'text'): string {
  const textModels = ["gemini-2.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"];
  const imageModels = ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"];
  const models = type === 'text' ? textModels : imageModels;
  return models[Math.min(attempt - 1, models.length - 1)];
}

function validateBase64Image(data: string, caller: string): void {
  if (!data || typeof data !== "string" || data.length < 100) {
    throw { code: ErrorCode.INVALID_IMAGE, message: `[${caller}] Invalid base64Image.`, retryable: false } satisfies AppError;
  }
}

function validateApiKey(caller: string): void {
  if (typeof console !== "undefined") {
    // Client-side warning only; server handles actual auth.
  }
}

function extractImageFromResponse(candidate: any): { data: string; mimeType: ImageMimeType } {
  const parts = candidate.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { data: part.inlineData.data, mimeType: (part.inlineData.mimeType as ImageMimeType) ?? "image/png" };
    }
  }
  const textPart = parts.find((p: any) => p.text);
  if (textPart?.text) {
    throw { code: ErrorCode.TEXT_RESPONSE, message: `Text response instead of image.`, retryable: true } satisfies AppError;
  }
  throw { code: ErrorCode.NO_IMAGE_IN_RESPONSE, message: `No image data in response.`, retryable: true } satisfies AppError;
}

// ============================================================================
// ASPECT RATIO DETECTION
// ============================================================================

export async function detectOptimalAspectRatio(
  base64Image: string,
  mimeType: string,
  model: ModelVersion
): Promise<AspectRatio> {
  const caller = "detectOptimalAspectRatio";
  validateApiKey(caller);

  const analysisModel = "gemini-2.5-flash"; 
  const isFlashImage = model === "gemini-2.5-flash-image";

  const prompt = `
    Analyze the attached image. Determine the optimal aspect ratio for a re-generated version.
    Choose ONE of the following standard aspect ratios:
    - "1:1" (Square)
    - "3:4" (Portrait)
    - "4:3" (Landscape)
    - "9:16" (Tall)
    - "16:9" (Wide)
    ${isFlashImage ? `\n    - "1:4" (Narrow)\n    - "4:1" (Banner)\n    - "1:8" (Ultra-Narrow)\n    - "8:1" (Ultra-Wide)` : ""}
    Return ONLY the aspect ratio string (e.g., "16:9").
  `;

  return withRetry(async (attempt, model) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: analysisModel,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No aspect ratio returned.");

    const match = text.match(/\b(\d+:\d+)\b/);
    const ratio = match ? match[1] as AspectRatio : "1:1";
    
    let validRatios: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (isFlashImage) validRatios = [...validRatios, "1:4", "1:8", "4:1", "8:1"];
    
    return validRatios.includes(ratio) ? ratio : "1:1";
  });
}

// ============================================================================
// PUBLIC API — SCHEMATIC ENHANCER
// ============================================================================

async function extractMaterialDescription(
  schematicBase64: string,
  schematicMimeType: string,
  referenceImages: { url: string; mimeType: string }[]
): Promise<string> {
  const caller = "extractMaterialDescription";
  validateApiKey(caller);

  const prompt = `You are an expert industrial designer.
I am providing you with a black-and-white schematic diagram, along with reference photos of the real-world product.
Analyze the reference photos and map the colors, materials, textures, and finishes to the corresponding parts in the schematic diagram.

CRITICAL INSTRUCTION FOR CAD REALISM:
Do NOT describe real-world imperfections. Ignore dirt, scratches, harsh photographic lighting, or uneven paint.
Translate the real-world materials into pristine, "CAD-perfect" descriptions. 
For example, instead of "scratched black metal with a bright glare", write "clean, matte black anodized aluminum".
Instead of "dusty rubber handle", write "pristine, molded black rubber with a uniform matte finish".

Provide a highly detailed, part-by-part description of these pristine CAD materials. 
This description will guide an AI to colorize the schematic components while keeping the image structurally a clean diagram.`;

  const parts: any[] = [
    { text: prompt },
    { text: "SCHEMATIC DIAGRAM:" },
    { inlineData: { mimeType: schematicMimeType, data: schematicBase64 } },
    { text: "REFERENCE PHOTOS:" }
  ];

  referenceImages.forEach(ref => {
    const [, base64Data] = ref.url.split(';base64,');
    parts.push({ inlineData: { mimeType: ref.mimeType, data: base64Data || ref.url } });
  });

  return withRetry(async (attempt, model) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({ model, contents: [{ role: "user", parts }] });
    return response.text || "Use realistic, pristine CAD materials and colors.";
  }, 'text').catch(() => "Use realistic, pristine CAD materials and colors based on standard industrial design practices.");
}

export async function enhanceSchematic(
  base64Image: string,
  mimeType: string,
  styles: SchematicStyle[] = ["hybrid-realism"], // Default to the new precision style
  keepLabels: boolean = true,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-2.5-flash-image",
  customPrompt: string = "",
  preserveGeometry: boolean = true,
  enhanceDetails: boolean = true,
  outputQuality: OutputQuality = "high",
  referenceImages?: { url: string; mimeType: string }[]
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "enhanceSchematic";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  if (referenceImages) referenceImages.forEach(ref => validateBase64Image(ref.url, caller));

  const resolvedStyles = normalizeStyles(styles);
  let targetAspectRatio: AspectRatio = aspectRatio === "auto" 
    ? await detectOptimalAspectRatio(base64Image, mimeType, model).catch(() => "1:1" as AspectRatio)
    : aspectRatio;

  const config: SchematicEnhancementConfig = {
    styles: resolvedStyles, keepLabels, aspectRatio: targetAspectRatio, imageSize, model, customPrompt, preserveGeometry, enhanceDetails, outputQuality,
  };

  const styleBlock = buildStyleBlock(resolvedStyles);
  const labelDirective = buildLabelDirective(keepLabels);
  const hasReferenceImages = !!(referenceImages && referenceImages.length > 0);
  
  let prompt = buildSchematicEnhancePrompt(config, styleBlock, labelDirective, hasReferenceImages);

  if (hasReferenceImages && referenceImages) {
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages);
    prompt += `\n\n<MATERIAL_AND_COLOR_GUIDE>\nThe following is a detailed description of the pristine CAD materials extracted from reference photos. You MUST apply these materials to the schematic components. The output MUST remain a precise technical schematic diagram (do not output a photograph), but colored and textured with these clean materials:\n\n${materialDescription}\n</MATERIAL_AND_COLOR_GUIDE>`;
  }

  if (customPrompt.trim()) {
    prompt += `\n\n<CUSTOM_DIRECTIVE>\n${customPrompt.trim()}\n</CUSTOM_DIRECTIVE>`;
  }

  const modelParams = getModelDefaults(model);
  const temperature = resolveSchematicTemperature(model, resolvedStyles, outputQuality);

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      config: {
        temperature, topP: modelParams.topP, topK: modelParams.topK,
        ...(currentModel.includes('image') && { imageConfig: { imageSize, aspectRatio: targetAspectRatio } })
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio };
  }, 'image');
}

// ============================================================================
// PUBLIC API — IMAGE REGENERATOR (E-COMMERCE)
// ============================================================================

export async function regenerateImage(
  base64Image: string,
  mimeType: string,
  customPrompt: string = "",
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-2.5-flash-image",
  mode: 'creative' | 'clone' = 'creative'
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "regenerateImage";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  let targetAspectRatio: AspectRatio = aspectRatio === "auto" 
    ? await detectOptimalAspectRatio(base64Image, mimeType, model).catch(() => "1:1" as AspectRatio)
    : aspectRatio;

  const prompt = buildProductPrompt(mode, customPrompt);
  const modelParams = getModelDefaults(model);

  // Clone requires minimal temperature for exact geometry match. Creative allows slight variance.
  const temperature = mode === 'clone' ? 0.05 : 0.25;

  const regeneratePolicy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 3000, maxDelayMs: 15000, backoffMultiplier: 2.0 };

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      config: {
        imageConfig: { imageSize, aspectRatio: targetAspectRatio },
        temperature, topP: modelParams.topP, topK: modelParams.topK,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio };
  }, 'image', regeneratePolicy);
}

// ============================================================================
// PUBLIC API — REFINEMENT & HOTSPOTS
// ============================================================================

export async function refineSchematic(
  base64Image: string,
  mimeType: string,
  instruction: string,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-2.5-flash-image",
  referenceImages?: { url: string; mimeType: string }[],
  hotspots?: RawHotspot[]
): Promise<{ imageUrl: string; aspectRatio: AspectRatio; hotspots: RawHotspot[] }> {
  const caller = "refineSchematic";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  if (referenceImages) referenceImages.forEach(ref => validateBase64Image(ref.url, caller));

  let targetAspectRatio: AspectRatio = aspectRatio === "auto" 
    ? await detectOptimalAspectRatio(base64Image, mimeType, model).catch(() => "1:1" as AspectRatio)
    : aspectRatio;

  let prompt = `
    You are an expert technical illustrator. Refine the attached schematic image based on this instruction:
    "${instruction}"
    CRITICAL: Output ONLY the refined image. Maintain the technical accuracy, callouts, and style of the original.
  `;

  if (referenceImages && referenceImages.length > 0) {
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages);
    prompt += `\n\n<MATERIAL_GUIDE>\nUse this pristine CAD material guide to accurately colorize the refined schematic:\n${materialDescription}\n</MATERIAL_GUIDE>`;
  }

  const modelParams = getModelDefaults(model);
  const temperature = Math.max(0.1, modelParams.temperature - 0.15);

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      config: { imageConfig: { imageSize, aspectRatio: targetAspectRatio }, temperature, topP: modelParams.topP, topK: modelParams.topK },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio, hotspots: hotspots || [] };
  }, 'image');
}

export async function refineImage(
  base64Image: string,
  mimeType: string,
  refinementPrompt: string,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-2.5-flash-image",
  mode: 'creative' | 'clone' = 'creative'
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "refineImage";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  
  let targetAspectRatio: AspectRatio = aspectRatio === "auto" 
    ? await detectOptimalAspectRatio(base64Image, mimeType, model).catch(() => "1:1" as AspectRatio)
    : aspectRatio;

  const prompt = `
    You are an expert AI 3D renderer and retoucher. Apply specific revisions to this product photograph.
    REVISIONS: ${refinementPrompt}
    CRITICAL: Maintain a pristine e-commerce product photography aesthetic. Pure white background (#FFFFFF). NO schematic lines or text.
  `;

  const modelParams = getModelDefaults(model);
  const temperature = 0.4;

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      config: { imageConfig: { imageSize, aspectRatio: targetAspectRatio }, temperature, topP: modelParams.topP, topK: modelParams.topK },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio };
  }, 'image');
}

export async function extractHotspots(base64Image: string, mimeType: string): Promise<RawHotspot[]> {
  const caller = "extractHotspots";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  const systemInstruction = `You are a precision optical engineering analyst. Extract bounding boxes for all callout labels.`;
  const prompt = `Analyze this schematic. Extract bounding boxes [ymin, xmin, ymax, xmax] normalized 0-1000 for every callout label/bubble.`;

  return withRetry(async (attempt, model) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
      config: {
        systemInstruction, temperature: 0.2, responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              box_2d: { type: "array", items: { type: "number" } },
              confidence: { type: "number" },
            },
            required: ["label", "box_2d", "confidence"],
          },
        },
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No hotspots returned.");
    const parsed = JSON.parse(text);
    return parsed.map((item: any) => ({
      id: Math.random().toString(36).substr(2, 9),
      label: item.label,
      box_2d: item.box_2d,
      part_box_2d: item.part_box_2d,
      confidence: item.confidence,
    })) as RawHotspot[];
  }, 'text');
}

import { getHotspotMemoryStore } from "./HotspotMemoryStore";

export async function refineHotspots(
  base64Image: string,
  mimeType: string,
  currentHotspots: RawHotspot[],
  instruction: string = "Refine the hotspots."
): Promise<RawHotspot[]> {
  const caller = "refineHotspots";
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  const store = getHotspotMemoryStore();
  return await store.refine(base64Image, mimeType, instruction, currentHotspots);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function buildStyleBlock(styles: SchematicStyle[]): string {
  if (!styles || styles.length === 0) styles = ["hybrid-realism"];
  const sorted = [...styles].map((s) => STYLE_REGISTRY[s]).sort((a, b) => b.weight - a.weight);
  const weights = [60, 25, 15];
  return sorted.map((descriptor, i) => `   [${weights[i] ?? 10}% influence]\n${descriptor.prompt.split("\n").map((l) => `   ${l}`).join("\n")}`).join("\n\n");
}

export function normalizeStyles(input: SchematicStyle[] | SchematicStyle | undefined | null): SchematicStyle[] {
  if (!input) return ["hybrid-realism"];
  const arr = Array.isArray(input) ? input : [input];
  const valid = arr.filter((s) => s in STYLE_REGISTRY) as SchematicStyle[];
  return valid.length > 0 ? [...new Set(valid)] : ["hybrid-realism"];
}

export function getStyleLabel(style: SchematicStyle): string {
  return STYLE_REGISTRY[style]?.label ?? style;
}

export function getStyleDescription(style: SchematicStyle): string {
  const prompt = STYLE_REGISTRY[style]?.prompt ?? "";
  const match = prompt.match(/•\s+(.+)/);
  return match ? match[1].trim() : style;
}

export function getAvailableStyles(): SchematicStyle[] {
  return Object.keys(STYLE_REGISTRY) as SchematicStyle[];
}

export function validateConfig(config: Partial<SchematicEnhancementConfig>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.styles || config.styles.length === 0) warnings.push("No styles specified — defaulting to 'hybrid-realism'.");
  else {
    const invalid = config.styles.filter((s) => !(s in STYLE_REGISTRY));
    if (invalid.length > 0) errors.push(`Unknown styles: ${invalid.join(", ")}`);
    if (config.styles.length > 3) warnings.push("More than 3 styles may produce inconsistent output.");
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function estimateComplexity(config: Partial<SchematicEnhancementConfig>): ProcessingComplexity {
  let score = (config.styles?.length ?? 1) * 2;
  score += config.outputQuality === "high" ? 3 : config.outputQuality === "maximum" ? 6 : 1;
  score += config.customPrompt && config.customPrompt.trim().length > 0 ? 2 : 0;
  score += config.enhanceDetails ? 2 : 0;
  score += config.preserveGeometry ? 1 : 0;
  if (score <= 6) return "low";
  if (score <= 12) return "medium";
  return "high";
}

export function estimateLatencySeconds(model: ModelVersion, imageSize: ImageSize, quality: OutputQuality): number {
  const base: Record<ModelVersion, number> = { "gemini-2.5-flash-image": 20, "gemini-3.1-flash-image-preview": 20, "gemini-3-pro-image-preview": 22, "gemini-2.5-flash": 8 };
  const sizeMultiplier: Record<ImageSize, number> = { "512px": 0.6, "1K": 1.0, "2K": 1.8, "4K": 3.2 };
  const qualityMultiplier: Record<OutputQuality, number> = { standard: 1.0, high: 1.3, maximum: 1.7 };
  return Math.round(base[model] * sizeMultiplier[imageSize] * qualityMultiplier[quality]);
}

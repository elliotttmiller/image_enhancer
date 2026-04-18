// gemini.ts
// Production Grade — v3.0
// Elite prompt architecture, circuit-breaker resilience, precision generation
// Enhanced with anti-hallucination validation

import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
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
import {
  IMAGEREGENERATOR_CLONE_PROMPT,
  IMAGEREGENERATOR_CREATIVE_PROMPT,
} from "./prompts";

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
// STYLE SYSTEM
// ============================================================================

export type SchematicStyle =
  | "modern"
  | "blueprint"
  | "patent"
  | "artistic"
  | "minimalist"
  | "isometric"
  | "vintage"
  | "realistic";

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

// ============================================================================
// CONFIGURATION CONTRACT
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

export interface GenerationResult {
  dataUri: string;
  mimeType: ImageMimeType;
  metadata: Omit<GenerationMetadata, "durationMs" | "timestamp">;
  durationMs: number;
}

// ============================================================================
// STYLE REGISTRY
// ============================================================================

const STYLE_REGISTRY: Record<SchematicStyle, StyleDescriptor> = {
  modern: {
    label: "Modern CAD",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — Modern CAD Technical Drawing:
  • Background: pure white (#FFFFFF), zero bleed
  • Stroke weights: outer contour 2–3 px, primary features 1–2 px, fine detail 0.5–1 px
  • Colour: monochrome black (#000000); optional single accent (#0055CC) for dimension arrows only
  • Shading: subtle ambient occlusion in recessed geometry only; no gradient fills
  • Typography: ISO 3098B sans-serif for any retained annotations
  • Aesthetic: ISO 128 / ASME Y14.3 compliant; professional engineering CAD output`,
  },

  blueprint: {
    label: "Blueprint",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — Classic Engineering Blueprint:
  • Background: deep blueprint blue (#1A3A5C), uniform flat fill
  • Lines: crisp white (#FFFFFF), weight 1–2 px; hairlines at 0.5 px
  • Grid: 5 mm reference grid overlay at 15% white opacity
  • Typography: condensed technical sans-serif, white, uppercase
  • Contrast ratio: minimum 10:1 (WCAG AAA equivalent for technical drawings)
  • Optional: subtle paper-fibre grain at 3% opacity for authenticity`,
  },

  patent: {
    label: "Patent Drawing",
    temperatureDelta: -0.05,
    weight: 1.0,
    prompt: `
STYLE — US Patent Office Illustration (37 CFR 1.84 compliant):
  • Background: off-white (#F8F8F2), simulating 21.6 × 27.9 cm patent paper
  • Ink: solid black (#000000) ONLY — no grey, no gradients, no colour
  • Shading technique: parallel hatching at 45° (section views), stippling for curved surfaces
  • Cross-hatching: 2 mm line spacing at 90° for material sections
  • Line weights: outlines 0.35 mm, section lines 0.18 mm, centre lines 0.18 mm dashed
  • Leader lines: straight with closed arrowheads; reference numerals in 10 pt serif
  • No decorative borders, logos, or non-standard annotation styles`,
  },

  artistic: {
    label: "Artistic Technical",
    temperatureDelta: +0.1,
    weight: 0.9,
    prompt: `
STYLE — Technical Art / Marker-Style Rendering:
  • Line quality: varied stroke weight (0.5–4 px) for visual hierarchy and depth
  • Shading: warm marker-style gradients with hard-edge termination; avoid soft airbrush
  • Colour palette: desaturated warm base (parchment, steel-grey) + 1–2 accent tones
  • Highlight: sharp white specular on radii and edges
  • Perspective: slight three-quarter view acceptable if it improves readability
  • Priority: mechanical accuracy preserved; artistic treatment is supplementary`,
  },

  minimalist: {
    label: "Minimalist",
    temperatureDelta: -0.1,
    weight: 1.0,
    prompt: `
STYLE — Minimalist Line Art:
  • Background: pure white (#FFFFFF)
  • Strokes: single weight, uniform 0.75 px, solid black (#000000)
  • Zero shading, zero fills, zero gradients, zero textures
  • Geometry only: every non-essential decorative line removed
  • Whitespace: generous; components breathe within the frame
  • Result: maximum clarity through radical simplification`,
  },

  isometric: {
    label: "Isometric",
    temperatureDelta: 0,
    weight: 1.0,
    prompt: `
STYLE — True Isometric Technical Projection:
  • Projection: 30° isometric (IEC 60617 dimetric variant acceptable for complex assemblies)
  • Background: white (#FFFFFF) or very light grey (#F2F2F2)
  • Colour coding: structural body in cool grey (#6B7280), moving/actuated parts in blue (#2563EB), critical/safety components in red (#DC2626), fluid/pneumatic in green (#16A34A)
  • Strokes: uniform 1 px outlines, 0.5 px internal detail lines
  • Perspective distortion: strictly forbidden — all axes must be mathematically correct
  • Hidden lines: optional 0.25 px dashed grey (#BDBDBD)`,
  },

  vintage: {
    label: "Vintage",
    temperatureDelta: +0.05,
    weight: 0.95,
    prompt: `
STYLE — Early 20th-Century Engineering Drawing:
  • Background: aged cream / yellowed paper (#EDE5C8) with subtle irregular grain texture
  • Ink: warm sepia (#3D2B1A) with natural ink-spread variation (±5% stroke width)
  • Imperfections: slight letter-press impression, minor ink bleed at intersections — must look organic, not digitally uniform
  • Typography: serif typeface (Clarendon or Century Schoolbook), mixed caps
  • Title block: simple ruled border in sepia, manufacturer-era styling
  • Authenticity range: 1900–1950 drafting table aesthetic`,
  },

  realistic: {
    label: "Photorealistic",
    temperatureDelta: +0.15,
    weight: 0.85,
    prompt: `
STYLE — Photorealistic Technical Render:
  • Renderer: PBR (Physically Based Rendering) output quality
  • Materials: differentiate metal (brushed aluminium, anodised, cast iron), rubber seals (black, slight gloss), transparent components (glass/lexan with refraction), and polymer housings
  • Lighting: three-point studio setup — key light at 45° elevation, fill at 0.4 intensity, rim light for edge separation
  • Shadows: soft contact shadows; no hard-edged drop shadows
  • Depth of field: minimal, all components in acceptable sharpness
  • Tone mapping: neutral to slightly warm, avoid oversaturation
  • Anti-aliasing: maximum quality; no aliased edges`,
  },
};

// ============================================================================
// PROMPT ARCHITECTURE
// ============================================================================

/**
 * Canonical system role injected at the top of every prompt.
 * Written using role-framing + expertise-signalling for best instruction-following.
 */
const SYSTEM_ROLE = `You are a Principal Industrial Design Engineer and Senior Technical Illustrator with 25 years of experience across aerospace, automotive, and precision manufacturing. You hold deep expertise in:

• Mechanical assemblies, tolerance stacks, and GD&T (ASME Y14.5)
• Engineering drawing standards: ISO 128, ANSI Y14.2, DIN 199, ASME Y14.3
• Technical illustration: isometric/orthographic projection, exploded views, section views
• CAD systems: SolidWorks, CATIA V5, AutoCAD, Fusion 360 — you understand how they generate output
• Material science, surface treatments, and manufacturing processes
• Patent illustration: 37 CFR 1.84 and EPO drawing requirements

Your outputs are used directly in production engineering documentation, patent filings, and ISO-certified technical manuals. Errors are unacceptable.`.trim();

/**
 * Chain-of-thought preamble that forces systematic image analysis before generation.
 * This dramatically reduces omissions and geometric errors.
 */
const ANALYSIS_CHAIN_OF_THOUGHT = `
<INTERNAL_ANALYSIS — Execute before generating output>
Step 1 — INVENTORY: Mentally scan the input image using a 4×4 grid overlay. List every distinct component in each cell. Count fasteners, moving parts, structural members.
Step 2 — TOPOLOGY: Identify how components connect and constrain each other. Understand the assembly hierarchy (parent → child relationships).
Step 3 — GEOMETRY: Note every circle, arc, angle, and symmetry axis. Flag any geometry that appears distorted in the source (will be corrected).
Step 4 — ANNOTATION: Identify all labels, reference numbers, leader lines, dimension strings, title blocks.
Step 5 — STYLE MAPPING: Confirm which style rules apply to this specific assembly type.
Step 6 — GENERATION PLAN: Determine drawing order (background → major structure → sub-assemblies → fasteners → annotations).
</INTERNAL_ANALYSIS>`.trim();

/** Quality tier system prompts */
const QUALITY_DIRECTIVES: Record<OutputQuality, string> = {
  standard:
    "Output Quality: Standard. Balanced fidelity and generation speed. Acceptable minor geometric simplifications on sub-5mm features.",
  high:
    "Output Quality: High. Enhanced line precision, complete component inventory, sharp intersections. No visible approximations on visible features.",
  maximum:
    "Output Quality: Maximum — Production Ready. Absolute geometric precision. Every fastener thread visible. Every chamfer and fillet present. Zero acceptable omissions. Output must be indistinguishable from a professional CAD rendering.",
};

/** Generate the complete system-level task prompt */
function buildEnhancePrompt(
  config: SchematicEnhancementConfig,
  styleBlock: string,
  labelDirective: string,
  hasReferenceImages: boolean = false
): string {
  return `
<ROLE>
${SYSTEM_ROLE}
</ROLE>

${ANALYSIS_CHAIN_OF_THOUGHT}

<PRIMARY_TASK>
RE-ENGINEER the schematic provided in the attached image.

You are NOT applying a filter. You are NOT cleaning up the image.
You are COMPLETELY RE-DRAWING the assembly from scratch at higher fidelity, using your engineering knowledge to understand the geometry and reconstruct it with precision.

Treat the input as reference material — extract all geometric and spatial information from it, then generate a superior technical illustration.
</PRIMARY_TASK>

<MANDATORY_REQUIREMENTS>

1. COMPLETENESS — Non-negotiable
   Every component visible in the original MUST appear in the output.
   This includes: screws, bolts, washers, snap rings, springs, pins, ball bearings,
   roller bearings, gear teeth, splines, keyways, seal grooves, O-ring glands,
   chamfers, and every structural member regardless of size.
   Use the 4×4 grid analysis (Step 1 above) to guarantee zero omissions.

2. GEOMETRIC ACCURACY
   • All lines that should be straight: perfectly straight
   • All circles: perfect circles (not ovals) unless explicitly an ellipse in the design
   • All parallel lines: verified parallel
   • All perpendicular intersections: exactly 90°
   • Gear teeth: consistent involute profile and uniform tooth count
   • Threads: consistent helix pitch matching thread standard (UNC/UNF/M-series)

3. ORIENTATION — Absolute requirement
   Output MUST be upright. The primary assembly axis aligns with the vertical centre of the image.
   Do NOT rotate, tilt, skew, or reframe.
   Top of the assembly = top of the output image.
   Centred both horizontally and vertically with consistent margins (≥5% of image dimension on all sides).

4. LABEL HANDLING
${labelDirective}

5. STYLE APPLICATION
   Apply the following style specification precisely. Where multiple styles are listed, blend them using the stated hierarchy:
${styleBlock}
${
  config.styles.includes('modern') && config.styles.includes('artistic') && config.styles.includes('realistic')
    ? `
   SPECIAL STYLE BLEND — Realistic Modern Schematic:
   - CRITICAL: Structural and Textural Fidelity.
   - Analyze the original schematic's part structures, surface textures, and material finishes with absolute precision.
   - The generated schematic MUST precisely replicate the original's part geometry, surface textures, and material properties.
   - Use realistic colors and textures based on the original materials.
   - Maintain technical schematic clarity.
   - AVOID hyper-realistic rendering (no extreme PBR, no excessive gloss, no dramatic studio lighting).
   - Aim for a clean, professional, and grounded technical illustration style.`
    : ""
}

6. BACKGROUND COLOR
   STRICTLY pure white (#FFFFFF). Regardless of the selected style, the background MUST be pure white. Do not use tan, beige, or any other background color.

7. DETAIL ENHANCEMENT
${
  config.enhanceDetails
    ? `   Intelligently add manufacturing details that may be absent from the source:
   • Edge chamfers (0.5–2 mm range, appropriate to scale)
   • Internal fillets at stress concentration points
   • Screw thread representation on all visible fasteners
   • Surface finish symbols where functionally significant
   • Functional clearance gaps at mating interfaces
   The result should look like a finished CAD model export, not a hand-traced sketch.`
    : `   Preserve the existing level of detail exactly. Do not add or remove features not visible in the source.`
}

7. GEOMETRY PRESERVATION
${
  config.preserveGeometry
    ? `   STRICTLY maintain exact proportional relationships, part structures, and geometry from the source image.
   Correct errors (straighten lines, perfect circles) but do NOT rescale, recompose, or hallucinate new components.
   Relative sizes, positions, and spatial relationships MUST be preserved to within 1% tolerance.
   The output must be a pixel-perfect enhancement of the original structure.`
    : `   Optimise proportions for visual clarity and compositional balance while keeping the design recognisable.`
}

8. MATERIAL AND COLOR FIDELITY
${
  hasReferenceImages
    ? `   CRITICAL: You have been provided with a <MATERIAL_AND_COLOR_GUIDE> at the end of this prompt.
   This guide describes the exact colors, material textures, and finishes of the real tool based on reference photos.
   The generated schematic MUST precisely match the colors and materials described in the <MATERIAL_AND_COLOR_GUIDE>, not the black-and-white schematic.
   Apply these realistic materials and colors to the corresponding parts in the schematic geometry.
   STRICTLY maintain the original part structures from the schematic, but render them with the colors and materials from the guide.`
    : `   Analyze the original schematic for specific colors, material textures, and finishes.
   The generated schematic MUST precisely match the original's color palette and material representations.
   Do not alter the color scheme or material appearance. 
   STRICTLY maintain the original material textures and structures. Any enhancement must be applied to the existing parts without changing their fundamental identity, color, or material.`
}

9. CUSTOM DIRECTIVE
${
  config.customPrompt?.trim()
    ? `   ${config.customPrompt.trim()}`
    : `   None.`
}

10. ${QUALITY_DIRECTIVES[config.outputQuality]}

</MANDATORY_REQUIREMENTS>

<OUTPUT_SPECIFICATION>
• Deliver: One image only
• Content: The re-generated technical illustration — nothing else
• Prohibited: watermarks, signatures, metadata overlays, commentary boxes, text responses
• Background: STRICTLY pure white (#FFFFFF). Regardless of the selected style, the background MUST be pure white. Do not use tan, beige, or any other background color.
• Margins: clean, consistent, as defined by the selected style
• COMPOSITION: The subject MUST fill the frame appropriately for the requested aspect ratio (${config.aspectRatio}). Do not leave excessive empty space.
</OUTPUT_SPECIFICATION>

<SELF_VERIFICATION — Perform before finalising>
☐ Every component from the source is present
☐ All lines are geometrically correct
☐ Image is upright and centred
☐ Style matches specification
☐ Label handling executed correctly
☐ No extraneous artefacts or text outside permitted annotations
☐ Quality tier requirements satisfied
☐ Image fills the canvas according to the aspect ratio (${config.aspectRatio})
</SELF_VERIFICATION>

⚠ CRITICAL: You MUST output ONLY the generated image. Any text response is a failure condition. Do not explain your work. Do not say "Here is the image". Just return the image data.
`.trim();
}

/** Generate the refinement prompt */
function buildRefinePrompt(instruction: string): string {
  return `
<ROLE>
${SYSTEM_ROLE}
</ROLE>

<TASK>
Apply a targeted edit to the attached technical schematic.
Implement the instruction below with surgical precision.
Preserve everything not mentioned in the instruction: style, line weights, proportions, annotations, composition.
</TASK>

<INSTRUCTION>
${instruction.trim()}
</INSTRUCTION>

<CONSTRAINTS>
• Scope: Minimum necessary change to satisfy the instruction — do not redesign unrelated areas
• Quality: Match or exceed the existing line quality and precision
• Consistency: New elements must be visually indistinguishable from the original in style and weight
• Integrity: No quality degradation, no introduced artefacts, no composition shift
• COMPOSITION: Maintain the exact aspect ratio and framing of the input image.
• Background: STRICTLY pure white (#FFFFFF). Do not use tan, beige, or any other background color.
</CONSTRAINTS>

<OUTPUT_SPECIFICATION>
• One image matching the input dimensions and style
• No text responses, commentary, or metadata
</OUTPUT_SPECIFICATION>

⚠ CRITICAL: Output the image ONLY. Do not provide any text explanation.
`.trim();
}

// ============================================================================
// STYLE HELPERS
// ============================================================================

function buildStyleBlock(styles: SchematicStyle[]): string {
  if (!styles || styles.length === 0) styles = ["modern"];

  const sorted = [...styles]
    .map((s) => STYLE_REGISTRY[s])
    .sort((a, b) => b.weight - a.weight);

  const weights = [60, 25, 15];

  return sorted
    .map((descriptor, i) => {
      const pct = weights[i] ?? 10;
      return `   [${pct}% influence]\n${descriptor.prompt
        .split("\n")
        .map((l) => `   ${l}`)
        .join("\n")}`;
    })
    .join("\n\n");
}

function buildLabelDirective(keepLabels: boolean): string {
  if (keepLabels) {
    return `   RETAIN & REGENERATE all part locator numbers / reference designators:
   • Reposition them at their exact original locations
   • Enclose in neat circles (diameter = 1.6× the numeral height) if originally circled
   • Render leader lines with filled arrowheads pointing to the correct component
   • Font: ISO 3098B or equivalent technical sans-serif
   
   CRITICAL — REMOVE COMPLETELY:
   All brand names, company logos, manufacturer watermarks, copyright notices,
   tool names, part-number tables, title blocks, border frames, 
   general text descriptions, dimension strings.
   
   Result: part locators + leader lines + pure technical drawing, with ZERO branding.`;
  }

  return `   CRITICAL — REMOVE COMPLETELY:
   All text, numerals, letters, labels, leader lines, arrowheads,
   dimension lines, extension lines, centre-line marks, title blocks, border frames,
   logos, branding, manufacturer watermarks, copyright notices, notes, revision blocks,
   and any other annotation layer.
   
   Result: pure geometric illustration with zero text elements and zero branding.`;
}

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Per-model generation parameters tuned for technical illustration output.
 * Lower temperature = more deterministic geometry.
 * Higher temperature = better artistic style blending.
 */
const MODEL_DEFAULTS: Record<
  ModelVersion,
  { temperature: number; topP: number; topK: number }
> = {
  "gemini-3.1-flash-lite-preview": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
  "gemini-3-flash-preview": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
  "gemini-3.1-flash-image-preview": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
  "gemini-3-pro-image-preview": {
    temperature: 0.60,
    topP: 0.90,
    topK: 35,
  },
  "gemini-2.5-flash-image": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
};

function resolveTemperature(
  model: ModelVersion,
  styles: SchematicStyle[],
  quality: OutputQuality
): number {
  const base = MODEL_DEFAULTS[model].temperature;
  const styleDelta = styles.reduce(
    (acc, s) => acc + (STYLE_REGISTRY[s]?.temperatureDelta ?? 0),
    0
  ) / Math.max(styles.length, 1);
  const qualityDelta = quality === "maximum" ? -0.10 : quality === "high" ? -0.05 : 0;

  return Math.max(0.1, Math.min(1.0, base + styleDelta + qualityDelta));
}

// ============================================================================
// ERROR FACTORY
// ============================================================================

function classifyError(raw: unknown, attempt: number): AppError {
  let msg: string;
  if (raw instanceof Error) {
    msg = raw.message;
  } else if (typeof raw === "string") {
    msg = raw;
  } else if (typeof raw === "object" && raw !== null) {
    try {
      msg = JSON.stringify(raw);
    } catch {
      msg = String(raw);
    }
  } else {
    msg = String(raw);
  }
  
  const lc = msg.toLowerCase();
  
  console.log(`[DEBUG] classifyError: Error message: ${msg}`);

  const retryable = !(
    lc.includes("api_key") ||
    lc.includes("authentication") ||
    lc.includes("billing") ||
    lc.includes("permission")
  );
  
  console.log(`[DEBUG] classifyError: Retryable: ${retryable}`);

  let code = ErrorCode.UNKNOWN;
  if (lc.includes("api_key") || lc.includes("api key")) code = ErrorCode.MISSING_API_KEY;
  else if (lc.includes("quota") || lc.includes("exhausted")) code = ErrorCode.QUOTA_EXCEEDED;
  else if (lc.includes("billing"))                        code = ErrorCode.BILLING_REQUIRED;
  else if (lc.includes("rate") || lc.includes("429"))     code = ErrorCode.RATE_LIMITED;
  else if (lc.includes("timeout"))                        code = ErrorCode.TIMEOUT;
  else if (lc.includes("network") || lc.includes("fetch"))code = ErrorCode.NETWORK_ERROR;
  else if (lc.includes("no candidates"))                  code = ErrorCode.NO_CANDIDATES;
  else if (lc.includes("text instead of image"))          code = ErrorCode.TEXT_RESPONSE;
  else if (lc.includes("no image"))                       code = ErrorCode.NO_IMAGE_IN_RESPONSE;
  else if (lc.includes("content") && lc.includes("filter"))code = ErrorCode.CONTENT_FILTERED;

  return { code, message: msg, retryable, attempt, originalError: raw };
}

// ============================================================================
// RETRY ENGINE — Exponential backoff with jitter
// ============================================================================

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 800,
  maxDelayMs: 10000,
  backoffMultiplier: 2.0,
};

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
        const delay = Math.min(
          policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1) + jitter,
          policy.maxDelayMs
        );
        console.warn(
          `[gemini] Attempt ${attempt}/${policy.maxAttempts} failed — ${lastError.code}. Retrying in ${Math.round(delay)}ms.`
        );
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function getModelForAttempt(attempt: number, type: 'text' | 'image' = 'text'): string {
  const textModels = ["gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"];
  const imageModels = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
  const models = type === 'text' ? textModels : imageModels;
  return models[Math.min(attempt - 1, models.length - 1)];
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

function validateBase64Image(data: string, caller: string): void {
  if (!data || typeof data !== "string") {
    throw {
      code: ErrorCode.INVALID_IMAGE,
      message: `[${caller}] base64Image is null or not a string.`,
      retryable: false,
    } satisfies AppError;
  }
  if (data.length < 100) {
    throw {
      code: ErrorCode.INVALID_IMAGE,
      message: `[${caller}] base64Image appears truncated (length: ${data.length}).`,
      retryable: false,
    } satisfies AppError;
  }
}

function validateApiKey(caller: string): void {
  if (!process.env.GEMINI_API_KEY) {
    throw {
      code: ErrorCode.MISSING_API_KEY,
      message: `[${caller}] GEMINI_API_KEY is not set. Call window.aistudio.openSelectKey() to configure.`,
      retryable: false,
    } satisfies AppError;
  }
}

// ============================================================================
// RESPONSE EXTRACTION
// ============================================================================

function extractImageFromResponse(candidate: {
  content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  finishReason?: string;
}): { data: string; mimeType: ImageMimeType } {
  const parts = candidate.content?.parts ?? [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        data: part.inlineData.data,
        mimeType: (part.inlineData.mimeType as ImageMimeType) ?? "image/png",
      };
    }
  }

  const textPart = parts.find((p) => p.text);
  if (textPart?.text) {
    const preview = textPart.text.substring(0, 400);
    throw {
      code: ErrorCode.TEXT_RESPONSE,
      message: `Model returned a text response instead of an image: "${preview}…"`,
      retryable: true,
    } satisfies AppError;
  }

  throw {
    code: ErrorCode.NO_IMAGE_IN_RESPONSE,
    message: `No image data in response. Finish reason: ${candidate.finishReason ?? "UNKNOWN"}`,
    retryable: true,
  } satisfies AppError;
}

// ============================================================================
// ASPECT RATIO DETECTION
// ============================================================================

/**
 * Uses a vision model to analyze the input image and determine the optimal aspect ratio.
 */
export async function detectOptimalAspectRatio(
  base64Image: string,
  mimeType: string,
  model: ModelVersion
): Promise<AspectRatio> {
  const caller = "detectOptimalAspectRatio";
  validateApiKey(caller);

  // Use a vision-capable text model for analysis
  const analysisModel = "gemini-3.1-pro-preview"; 

  const isFlashImage = model === "gemini-3.1-flash-image-preview";

  const prompt = `
    Analyze the attached technical schematic diagram image.
    Determine the optimal aspect ratio for a re-generated version of this image.
    Consider the composition, the shape of the main subject, and the layout of annotations.
    
    Choose ONE of the following standard aspect ratios that best fits the content:
    - "1:1" (Square)
    - "3:4" (Portrait)
    - "4:3" (Landscape)
    - "9:16" (Tall)
    - "16:9" (Wide)
    ${isFlashImage ? `
    If the image is extremely wide or tall, you may choose:
    - "1:4" (Narrow)
    - "4:1" (Banner)
    - "1:8" (Ultra-Narrow)
    - "8:1" (Ultra-Wide)
    ` : ""}
    Return ONLY the aspect ratio string (e.g., "16:9"). Do not add any other text.
  `;

  return withRetry(async (attempt, model) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    console.info(`[gemini] ${caller} — attempt ${attempt} | analyzing image for aspect ratio`);

    const response = await ai.models.generateContent({
      model: analysisModel,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Image } },
        ],
      },
    });

    const text = response.text?.trim();
    
    if (!text) {
      throw new Error("No aspect ratio returned from analysis.");
    }

    // Clean up response
    const match = text.match(/\b(\d+:\d+)\b/);
    const ratio = match ? match[1] as AspectRatio : "1:1";
    
    // Validate against known ratios
    let validRatios: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (isFlashImage) {
      validRatios = [...validRatios, "1:4", "1:8", "4:1", "8:1"];
    }
    
    if (validRatios.includes(ratio)) {
      console.info(`[gemini] Detected optimal aspect ratio: ${ratio}`);
      return ratio;
    }
    
    console.warn(`[gemini] Invalid ratio returned: "${text}". Defaulting to 1:1.`);
    return "1:1";
  });
}

// ============================================================================
// PUBLIC API — enhanceSchematic
// ============================================================================

async function extractMaterialDescription(
  schematicBase64: string,
  schematicMimeType: string,
  referenceImages: { url: string; mimeType: string }[]
): Promise<string> {
  const caller = "extractMaterialDescription";
  validateApiKey(caller);

  const prompt = `You are an expert industrial designer and materials engineer.
I am providing you with a black-and-white schematic diagram of a product, along with one or more reference photos of the actual real-world product.

Your task is to analyze the reference photos and map the colors, materials, textures, and finishes to the corresponding parts in the schematic diagram.

Please provide a highly detailed, part-by-part description of the materials and colors.
For example: "The main outer housing is a matte dark grey textured plastic. The front nozzle is brushed aluminum. The trigger is bright red glossy plastic. The screws are black oxide steel."

This description will be used to guide an AI image generator to colorize the schematic, so be as descriptive and precise as possible about the visual appearance of each component.`;

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
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.info(`[gemini] ${caller} — attempt ${attempt} | extracting material description using ${model}`);

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: { parts },
      });
      return response.text || "Use realistic materials and colors.";
    } catch (error) {
      console.error(`[gemini] ${caller} attempt ${attempt} failed:`, error);
      throw error;
    }
  }, 'text').catch(error => {
    console.error("[gemini] All attempts failed for extractMaterialDescription:", error);
    return "Use realistic materials and colors based on standard industrial design practices.";
  });
}

export async function enhanceSchematic(
  base64Image: string,
  mimeType: string,
  styles: SchematicStyle[] = ["modern"],
  keepLabels: boolean = true,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-3.1-flash-image-preview",
  customPrompt: string = "",
  preserveGeometry: boolean = true,
  enhanceDetails: boolean = true,
  outputQuality: OutputQuality = "high",
  referenceImages?: { url: string; mimeType: string }[]
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "enhanceSchematic";

  // Validate
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  if (referenceImages && referenceImages.length > 0) {
    referenceImages.forEach(ref => validateBase64Image(ref.url, caller));
  }

  // Normalise styles
  const resolvedStyles = normalizeStyles(styles);

  // Handle Auto Aspect Ratio
  let targetAspectRatio: AspectRatio;
  if (aspectRatio === "auto") {
    try {
      targetAspectRatio = await detectOptimalAspectRatio(base64Image, mimeType, model);
    } catch (e) {
      console.error("[gemini] Failed to detect aspect ratio, defaulting to 1:1", e);
      targetAspectRatio = "1:1";
    }
  } else {
    targetAspectRatio = aspectRatio;
  }

  const config: SchematicEnhancementConfig = {
    styles: resolvedStyles,
    keepLabels,
    aspectRatio: targetAspectRatio,
    imageSize,
    model,
    customPrompt,
    preserveGeometry,
    enhanceDetails,
    outputQuality,
  };

  // Build prompt components
  const styleBlock   = buildStyleBlock(resolvedStyles);
  const labelDirective = buildLabelDirective(keepLabels);
  const hasReferenceImages = referenceImages !== undefined && referenceImages.length > 0;
  let prompt       = buildEnhancePrompt(config, styleBlock, labelDirective, hasReferenceImages);

  if (hasReferenceImages && referenceImages) {
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages);
    prompt += `\n\n<MATERIAL_AND_COLOR_GUIDE>\nThe following is a detailed description of the materials, colors, and finishes extracted from the reference photos of the real product. You MUST use this description to accurately colorize and texture the schematic diagram:\n\n${materialDescription}\n</MATERIAL_AND_COLOR_GUIDE>`;
  }

  // Resolve temperature
  const modelParams  = MODEL_DEFAULTS[model];
  const temperature  = resolveTemperature(model, resolvedStyles, outputQuality);

  return withRetry(async (attempt, model) => {
    // Re-initialise client on every attempt to guarantee fresh API key pickup
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const currentModel = model;

    console.info(
      `[gemini] ${caller} — attempt ${attempt} | model=${currentModel} | quality=${outputQuality} | styles=${resolvedStyles.join(",")} | ratio=${targetAspectRatio} | temp=${temperature.toFixed(2)}`
    );

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType, data: base64Image } },
    ];

    const config: any = {
      temperature,
      topP: modelParams.topP,
      topK: modelParams.topK,
    };

    if (currentModel.includes('image')) {
      config.imageConfig = { imageSize, aspectRatio: targetAspectRatio };
    }

    const response = await ai.models.generateContent({
      model: currentModel,
      contents: {
        parts,
      },
      config,
    });

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw {
        code: ErrorCode.NO_CANDIDATES,
        message: "Gemini API returned zero candidates.",
        retryable: true,
      } satisfies AppError;
    }

    // Warn on unusual finish reasons but don't block extraction
    const fr = candidate.finishReason;
    if (fr && !["STOP", "MAX_TOKENS"].includes(fr)) {
      console.warn(`[gemini] Finish reason: ${fr}`);
    }

    const { data, mimeType: outMime } = extractImageFromResponse(candidate as Parameters<typeof extractImageFromResponse>[0]);
    return {
      imageUrl: `data:${outMime};base64,${data}`,
      aspectRatio: targetAspectRatio
    };
  }, 'image');
}

// ============================================================================
// PUBLIC API — refineSchematic
// ============================================================================

export async function refineSchematic(
  base64Image: string,
  mimeType: string,
  instruction: string,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-3.1-flash-image-preview",
  referenceImages?: { url: string; mimeType: string }[],
  hotspots?: RawHotspot[]
): Promise<{ imageUrl: string; aspectRatio: AspectRatio; hotspots: RawHotspot[] }> {
  const caller = "refineSchematic";

  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  if (referenceImages && referenceImages.length > 0) {
    referenceImages.forEach(ref => validateBase64Image(ref.url, caller));
  }

  if (!instruction?.trim()) {
    throw {
      code: ErrorCode.EMPTY_INSTRUCTION,
      message: `[${caller}] Refinement instruction cannot be empty.`,
      retryable: false,
    } satisfies AppError;
  }

  // Handle Auto Aspect Ratio
  let targetAspectRatio: AspectRatio;
  if (aspectRatio === "auto") {
    try {
      targetAspectRatio = await detectOptimalAspectRatio(base64Image, mimeType, model);
    } catch (e) {
      console.error("[gemini] Failed to detect aspect ratio, defaulting to 1:1", e);
      targetAspectRatio = "1:1";
    }
  } else {
    targetAspectRatio = aspectRatio;
  }

  let prompt = `
    You are an expert technical illustrator.
    Refine the attached technical schematic image based on the following instruction:
    "${instruction}"

    CRITICAL REQUIREMENTS:
    1. Output ONLY the refined image. Do NOT output any text, markdown, or explanations.
    2. Maintain the technical accuracy and style of the original.
    3. Ensure the image fills the frame for the ${targetAspectRatio} aspect ratio.
    4. Do not leave excessive empty space around the subject.
    5. If the instruction implies a change in shape or layout, adapt the composition to fit the ${targetAspectRatio} frame perfectly.
  `;

  if (referenceImages && referenceImages.length > 0) {
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages);
    prompt += `\n\n<MATERIAL_AND_COLOR_GUIDE>\nThe following is a detailed description of the materials, colors, and finishes extracted from the reference photos of the real product. You MUST use this description to accurately colorize and texture the refined schematic diagram:\n\n${materialDescription}\n\nDO NOT generate or include the reference image itself inside the output. The output MUST ONLY be the refined schematic diagram, colored using the reference image as a guide.</MATERIAL_AND_COLOR_GUIDE>`;
  }

  const modelParams = MODEL_DEFAULTS[model];
  // Lower temperature for surgical edits
  const temperature = Math.max(0.1, modelParams.temperature - 0.15);

  const refinePolicy: RetryPolicy = {
    maxAttempts: 2,
    baseDelayMs: 600,
    maxDelayMs: 3000,
    backoffMultiplier: 2.0,
  };

  return withRetry(async (attempt) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const currentModel = attempt > 1 ? "gemini-2.5-flash-image" : model;

    console.info(
      `[gemini] ${caller} — attempt ${attempt} | model=${currentModel} | temp=${temperature.toFixed(2)} | ratio=${targetAspectRatio} | instruction="${instruction.substring(0, 60)}…"`
    );

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType, data: base64Image } },
    ];

    const response = await ai.models.generateContent({
      model: currentModel,
      contents: {
        parts,
      },
      config: {
        imageConfig: { imageSize, aspectRatio: targetAspectRatio },
        temperature,
        topP: modelParams.topP,
        topK: modelParams.topK,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw {
        code: ErrorCode.NO_CANDIDATES,
        message: "Gemini API returned zero candidates.",
        retryable: true,
      } satisfies AppError;
    }

    const { data, mimeType: outMime } = extractImageFromResponse(candidate as Parameters<typeof extractImageFromResponse>[0]);
    return {
      imageUrl: `data:${outMime};base64,${data}`,
      aspectRatio: targetAspectRatio,
      hotspots: hotspots || []
    };
  }, 'image', refinePolicy);
}

// ============================================================================
// PROMPT ENGINEERING — regenerateImage
// ============================================================================

const BASE_PROMPT = `\
You are a professional product photographer and 3D rendering specialist producing \
commercial-grade studio imagery for an industrial e-commerce catalog.

The reference image shows a physical part, tool, or hardware component. \
Your task is to produce a new, standalone product photograph — not a visual copy \
of the original, but a freshly rendered studio image that accurately represents \
the same physical object with improved production quality.

OUTPUT STANDARD (apply to all renders):
• Background: pure white (#FFFFFF), infinite/seamless, no gradients or vignettes
• Lighting: soft directional studio key light from upper-left, secondary fill light, no harsh clipping
• Shadow: subtle, sharp-edged contact shadow grounding the object to the surface
• Focus: full part in sharp focus — no depth-of-field blur anywhere on the subject
• Surface fidelity: hyper-realistic material textures at 4K-grade resolution
• Markings: reproduce only text, numbers, logos, or engravings that are unambiguously \
visible in the source image — do not invent or add any markings
`;

const CLONE_PROMPT = `\
${BASE_PROMPT}

MODE: PRECISION STUDIO RECREATION

Recreate this part as a pristine new studio render that exactly matches the \
source image's camera angle, perspective, and spatial composition. \
This is a fresh rendering — not a copy — that elevates production quality \
while preserving every physical characteristic of the original.

GEOMETRY & COMPOSITION — reproduce with exact fidelity:
• Camera angle, elevation, and perspective: identical to source
• Object position and orientation within the frame: identical
• All structural features: holes, slots, teeth, bends, tabs, ridges, threads — \
  each reproduced at their correct scale, spacing, and 3D depth
• Proportional relationships between all features: unchanged

PRODUCTION UPGRADES — improve these vs. the source:
• Material surface: sharper texture definition, more pronounced grain or finish detail
• Lighting: cleaner, more dramatic studio key light revealing surface geometry
• Micro-detail: machined edges, fastener recesses, and surface texture at 4K sharpness
• Background: pristine seamless white with accurate soft contact shadow
• Overall tonality: richer, more saturated material presence
`;

const CREATIVE_PROMPT = `\
${BASE_PROMPT}

MODE: MATERIAL REIMAGINE

Use the source image's geometry as a precise physical template. \
Preserve every structural feature exactly, then produce a new studio render \
with entirely reimagined surface material, finish, and lighting. \
The result should look like a different photograph of the same physical part — \
not a copy of the source image.

GEOMETRY AND QUANTITY LOCK — preserve these physical properties perfectly:
• Object Count & Symmetry: EXACTLY match the number of parts in the original. If there are multiple identical/paired parts, they MUST remain mathematically identical to each other in the generation (do NOT make them mismatched).
• Volumetric proportions and structural scale. (Do NOT lock the 2D outline/silhouette, as the camera will move).
• Every hole: accurate diameter, depth, and spatial relationship. ZERO hallucinated holes.
• Every slot, notch, and cutout: width, length, and functional geometry
• Every bend, tab, and tooth: accurate 3D angle relative to the rest of the part
• Every ridge, channel, or embossed feature: depth and profile

MANDATORY DYNAMIC TRANSFORMATIONS — you MUST apply these changes:
• Camera Angle/Perspective (MANDATORY): You MUST rotate or tilt the object (e.g., 10-25 degrees). The output MUST look like a photograph taken from a slightly different angle than the original. Do NOT simply trace the original 2D silhouette.
• Surface material texture: Elevate the texture to a premium industrial finish (e.g., micro-scratched brushed steel, bead-blasted aluminum, or polished chrome) while MAINTAINING the general color profile/material type of the original object (e.g., if it's silver metal, keep it silver metal; if it's brass, keep it brass).
• Lighting setup: entirely new dramatic single-source studio lighting casting \
  clean micro-shadows that reveal the part's 3D surface geometry
• Specular character: high-contrast reflections and highlights shaped by the \
  part's actual contours and edge quality
• Contact shadow: rich, crisp drop shadow with accurate penumbra on white

HARD CONSTRAINTS:
• NO HALLUCINATED FEATURES: Do NOT add ANY new holes, cutouts, handles, rods, mounts, extra bolts, screws, flanges, or structural extensions that do not explicitly exist in the source image.
• UNSEEN GEOMETRY: When rotating the part, do NOT invent complex mechanisms for the newly exposed back/sides. Keep unseen geometry logical, flat, and consistent with the visible material.
• Do not alter any hole diameter, slot dimension, tooth spacing, or bend angle.
• Do not flatten or soften 3D features — vertical offsets and raised geometry \
  must be fully preserved.
• Do not add text, numbers, serial codes, or surface engravings that are not \
  present in the source.
`;

function buildPrompt(
  mode: 'creative' | 'clone',
  customPrompt: string = ""
): string {
  // Use new anti-hallucination prompts for image regenerator
  const base = mode === 'clone' 
    ? IMAGEREGENERATOR_CLONE_PROMPT 
    : IMAGEREGENERATOR_CREATIVE_PROMPT;

  if (!customPrompt.trim()) return base;

  return `${base}

ADDITIONAL INSTRUCTIONS FROM USER:
${customPrompt.trim()}`;
}

// ============================================================================
// PUBLIC API — regenerateImage
// PRODUCTION-GRADE IMAGE REGENERATION WITH ANTI-HALLUCINATION SAFEGUARDS
// ============================================================================

/**
 * Regenerates a technical schematic image with strict geometry preservation
 * and anti-hallucination prompting.
 * 
 * Temperature tuning:
 * - Clone mode (0.02): Reproduction is CRITICAL, minimize variance
 * - Creative mode (0.45): Encourage meaningful transformation while preserving geometry
 * 
 * Retry strategy:
 * - Aggressive retries for image generation (high failure rate)
 * - Exponential backoff to respect rate limits
 * - Model fallback: Pro -> Flash -> 2.5 Flash on consecutive failures
 */
export async function regenerateImage(
  base64Image: string,
  mimeType: string,
  customPrompt: string = "",
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-3.1-flash-image-preview",
  mode: 'creative' | 'clone' = 'creative'
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "regenerateImage";

  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  // ========================================================================
  // STEP 1: ASPECT RATIO DETECTION
  // ========================================================================
  let targetAspectRatio: AspectRatio;
  if (aspectRatio === "auto") {
    try {
      targetAspectRatio = await detectOptimalAspectRatio(base64Image, mimeType, model);
      console.info(`[gemini] ${caller} — auto-detected aspect ratio: ${targetAspectRatio}`);
    } catch (e) {
      console.error("[gemini] Failed to auto-detect aspect ratio, defaulting to 1:1", e);
      targetAspectRatio = "1:1";
    }
  } else {
    targetAspectRatio = aspectRatio;
  }

  // ========================================================================
  // STEP 2: PROMPT CONSTRUCTION WITH MODE-SPECIFIC DIRECTIVES
  // ========================================================================
  const prompt = buildPrompt(mode, customPrompt);

  // ========================================================================
  // STEP 3: TEMPERATURE TUNING FOR MODE
  // ========================================================================
  // CRITICAL: Temperature controls generation variance
  // - Clone mode: 0.02 (ultra-deterministic, near-zero variance)
  // - Creative mode: 0.45 (encourages meaningful transformation and variation)
  // Creative needs higher temp to force perspective/lighting changes, not just upscale
  const temperature = mode === 'clone' ? 0.02 : 0.45;

  const modelParams = MODEL_DEFAULTS[model];

  // ========================================================================
  // STEP 4: AGGRESSIVE RETRY POLICY FOR IMAGE GENERATION
  // Image generation has higher failure rate, needs robust retry
  // ========================================================================
  const regeneratePolicy: RetryPolicy = {
    maxAttempts: 6, // Increased from 5 for image generation robustness
    baseDelayMs: 2000, // Reduced from 3000 for faster feedback loop
    maxDelayMs: 20000, // Increased to handle extreme backoff
    backoffMultiplier: 2.5, // More aggressive backoff for rate limiting
  };

  return withRetry(async (attempt) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // ====================================================================
    // MODEL SELECTION STRATEGY
    // ====================================================================
    // Attempt 1-2: Use requested model (user's choice)
    // Attempt 3-4: Switch to Pro variant for better geometry preservation
    // Attempt 5+: Fall back to 2.5 Flash (stable fallback)
    let currentModel: ModelVersion;
    if (attempt <= 2) {
      currentModel = model;
    } else if (attempt <= 4) {
      currentModel = "gemini-3-pro-image-preview";
    } else {
      currentModel = "gemini-2.5-flash-image";
    }

    // Adjust temperature on retry: Clone stays low, Creative stays high
    const tempAdjustment = mode === 'clone' ? 0.02 : 0.03; // Minimal adjustment to maintain intent
    const adjustedTemp = Math.min(1.0, temperature + (attempt > 1 ? tempAdjustment : 0));

    console.info(
      `[gemini] ${caller} — attempt ${attempt}/${regeneratePolicy.maxAttempts} | model=${currentModel} | mode=${mode} | temp=${adjustedTemp.toFixed(2)} | ratio=${targetAspectRatio} | size=${imageSize}`
    );

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType, data: base64Image } },
    ];

    // ====================================================================
    // API CALL WITH OPTIMIZED SAMPLING PARAMETERS
    // ====================================================================
    // Sampling tuning:
    // - Clone: Conservative (topP 0.85, topK 20) for deterministic reproduction
    // - Creative: Open (topP 0.95, topK 40) to encourage diverse transformations
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: {
        parts,
      },
      config: {
        imageConfig: {
          imageSize,
          aspectRatio: targetAspectRatio,
        },
        // Sampling parameters tuned for mode
        temperature: adjustedTemp,
        topP: mode === 'clone' ? 0.85 : 0.95,  // Higher topP for creative mode diversity
        topK: mode === 'clone' ? 20 : 40,      // Higher topK for creative mode choices
      },
    });

    // ====================================================================
    // RESPONSE VALIDATION
    // ====================================================================
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw {
        code: ErrorCode.NO_CANDIDATES,
        message: "Gemini API returned zero candidates.",
        retryable: true,
      } satisfies AppError;
    }

    // Verify finish reason is not an error condition
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'OTHER') {
      console.warn(`[gemini] ${caller} — attempt ${attempt} — suspicious finish reason: ${candidate.finishReason}`);
    }

    // ====================================================================
    // IMAGE EXTRACTION & VALIDATION
    // ====================================================================
    const { data, mimeType: outMime } = extractImageFromResponse(
      candidate as Parameters<typeof extractImageFromResponse>[0]
    );

    // Basic sanity check on output
    if (!data || data.length < 1000) {
      throw {
        code: ErrorCode.NO_IMAGE_IN_RESPONSE,
        message: `Image data suspiciously small (${data?.length ?? 0} bytes). Possible corruption.`,
        retryable: true,
      } satisfies AppError;
    }

    console.info(`[gemini] ${caller} — attempt ${attempt} — success | size=${data.length} bytes | mime=${outMime}`);

    return {
      imageUrl: `data:${outMime};base64,${data}`,
      aspectRatio: targetAspectRatio,
    };
  }, 'image', regeneratePolicy);
}

// ============================================================================
// PUBLIC API — refineImage
// PRODUCTION-GRADE REFINEMENT WITH TARGETED GEOMETRY PRESERVATION
// ============================================================================

/**
 * Applies targeted refinements to a generated image while preserving
 * core geometry and structure.
 * 
 * Temperature tuning:
 * - 0.25 (low): Focus on user's specific refinement directive
 * - Prevents model from over-interpreting the instruction
 * 
 * Retry strategy:
 * - Conservative retries (3) since image is already generated
 * - Fallback to alternative models if primary fails
 */
export async function refineImage(
  base64Image: string,
  mimeType: string,
  refinementPrompt: string,
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-3.1-flash-image-preview",
  mode: 'creative' | 'clone' = 'creative'
): Promise<{ imageUrl: string; aspectRatio: AspectRatio }> {
  const caller = "refineImage";

  validateApiKey(caller);
  validateBase64Image(base64Image, caller);
  
  if (!refinementPrompt || !refinementPrompt.trim()) {
    throw new Error("A refinement prompt is required to apply revisions.");
  }

  // ========================================================================
  // ASPECT RATIO HANDLING
  // ========================================================================
  let targetAspectRatio: AspectRatio;
  if (aspectRatio === "auto") {
    try {
      targetAspectRatio = await detectOptimalAspectRatio(base64Image, mimeType, model);
    } catch (e) {
      console.error("[gemini] Failed to auto-detect aspect ratio for refinement, defaulting to 1:1", e);
      targetAspectRatio = "1:1";
    }
  } else {
    targetAspectRatio = aspectRatio;
  }

  // ========================================================================
  // REFINEMENT PROMPT CONSTRUCTION
  // Wraps user's directive with anti-hallucination guards
  // ========================================================================
  const prompt = `
🔧 PRODUCTION IMAGE REFINEMENT DIRECTIVE
========================================

You are an expert technical renderer and image refinement specialist.
Your task is to apply a TARGETED refinement to the provided generated image.

CRITICAL CONSTRAINTS (NON-NEGOTIABLE):
=========================================

1️⃣ GEOMETRY LOCK — PRESERVE ALL EXISTING GEOMETRY
   • All parts and components: UNCHANGED in count, type, and position
   • All dimensions: maintained within ±2%
   • All proportions: exact reproduction from source
   • All structural relationships: identical to source
   • ZERO new parts may be added
   • ZERO existing parts may be removed

2️⃣ TOPOLOGY LOCK — PRESERVE ASSEMBLY STRUCTURE
   • Component connections: unchanged
   • Assembly relationships: exact reproduction
   • Spatial arrangement: no repositioning allowed
   • If parts touch in the input: they MUST touch in output
   • If parts are separated: maintain exact gap

3️⃣ REFINEMENT SCOPE — APPLY ONLY THE TARGETED CHANGE
   • You MAY adjust: lighting, surface texture quality, clarity, detail enhancement
   • You MAY improve: image sharpness, contrast, material appearance
   • You CANNOT change: part geometry, assembly structure, orientation
   • You CANNOT add: new parts, holes, features, text, branding
   • You CANNOT remove: any existing visible component

4️⃣ USER REFINEMENT DIRECTIVE (APPLY THIS ONLY):
   "${refinementPrompt.trim()}"

5️⃣ FIDELITY VERIFICATION BEFORE COMPLETION
   ✓ Part count: IDENTICAL to input
   ✓ Component types: UNCHANGED
   ✓ Assembly structure: PRESERVED
   ✓ Spatial relationships: MAINTAINED
   ✓ Orientation: UNCHANGED (upright, centered)
   ✓ ONLY the refinement directive applied, nothing more

OUTPUT REQUIREMENTS:
====================
• One image only (no text responses)
• Same aspect ratio as input
• Clean, professional aesthetic
• Pure white background (#FFFFFF)
• Realistic contact shadow if appropriate
• Zero artifacts or hallucinated elements
  `;

  const modelParams = MODEL_DEFAULTS[model];
  
  // ========================================================================
  // TEMPERATURE FOR REFINEMENT
  // Lower temp keeps refinement focused and prevents over-interpretation
  // ========================================================================
  const temperature = 0.25;

  const refinePolicy: RetryPolicy = {
    maxAttempts: 4, // Slightly increased for robustness
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    backoffMultiplier: 2.0,
  };

  return withRetry(async (attempt) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Model escalation: Flash -> Pro -> 2.5 Flash
    let currentModel: ModelVersion;
    if (attempt === 1) {
      currentModel = model;
    } else if (attempt === 2 || attempt === 3) {
      currentModel = "gemini-3-pro-image-preview";
    } else {
      currentModel = "gemini-2.5-flash-image";
    }

    console.info(
      `[gemini] ${caller} — attempt ${attempt}/${refinePolicy.maxAttempts} | model=${currentModel} | temp=${temperature.toFixed(2)} | ratio=${targetAspectRatio}`
    );

    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType, data: base64Image } },
    ];

    const response = await ai.models.generateContent({
      model: currentModel,
      contents: {
        parts,
      },
      config: {
        imageConfig: {
          imageSize,
          aspectRatio: targetAspectRatio,
        },
        temperature, // Strict temperature for focused refinement
        topP: 0.88,  // Slightly restricted for predictable refinement
        topK: 25,    // Conservative sampling
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw {
        code: ErrorCode.NO_CANDIDATES,
        message: "Gemini API returned zero candidates for refinement.",
        retryable: true,
      } satisfies AppError;
    }

    if (candidate.finishReason === 'SAFETY') {
      console.warn(`[gemini] ${caller} — attempt ${attempt} — content safety triggered during refinement`);
    }

    const { data, mimeType: outMime } = extractImageFromResponse(
      candidate as Parameters<typeof extractImageFromResponse>[0]
    );

    if (!data || data.length < 1000) {
      throw {
        code: ErrorCode.NO_IMAGE_IN_RESPONSE,
        message: `Refined image data suspiciously small (${data?.length ?? 0} bytes).`,
        retryable: true,
      } satisfies AppError;
    }

    console.info(`[gemini] ${caller} — attempt ${attempt} — refinement complete | size=${data.length} bytes`);

    return {
      imageUrl: `data:${outMime};base64,${data}`,
      aspectRatio: targetAspectRatio,
    };
  }, 'image', refinePolicy);
}

// ============================================================================
// PUBLIC API — extractHotspots
// ============================================================================

export async function extractHotspots(
  base64Image: string,
  mimeType: string,
): Promise<RawHotspot[]> {
  const caller = "extractHotspots";
  console.log(`[DEBUG] ${caller}: Starting`);
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  const systemInstruction = `You are a precision optical engineering analyst specializing in technical schematic diagrams. Your classifications are consumed by downstream computer vision systems — accuracy is critical and errors cascade. Never guess. When uncertain, use the ambiguity fields provided.`;

  const prompt = `Analyze this technical schematic diagram image carefully.

TASK: Classify the visual structure of callout labels and leader lines in this diagram.

CRITICAL INSTRUCTIONS FOR PRECISION:
1. Bounding Box Format: [ymin, xmin, ymax, xmax] normalized to 0-1000.
2. Pixel-Perfect Alignment: The bounding box MUST tightly enclose only the label text or the bubble containing the text. Do not include leader lines, arrows, or surrounding geometry.
3. Completeness: Scan the entire image. Identify every single callout label.
4. Verification: After identifying all labels, re-verify each bounding box against the image to ensure it is pixel-perfect. If a label is partially obscured, estimate the box as if it were fully visible.

Output the result in the requested JSON format.`;

  return withRetry(async (attempt, model) => {
    console.log(`[DEBUG] ${caller}: Attempt ${attempt}`);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    console.info(`[gemini] ${caller} — attempt ${attempt} | extracting hotspots with high precision | model=${model}`);
    console.log(`[DEBUG] ${caller}: Calling ai.models.generateContent`);

    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Image } },
        ],
      },
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: {
                type: Type.STRING,
                description: "The exact text of the part number, label, or callout.",
              },
              box_2d: {
                type: Type.ARRAY,
                items: {
                  type: Type.NUMBER,
                },
                description: "The precise bounding box [ymin, xmin, ymax, xmax] of the label/bubble itself, normalized 0-1000.",
              },
              confidence: {
                type: Type.NUMBER,
                description: "The confidence score for this detection (0.0 to 1.0).",
              },
            },
            required: ["label", "box_2d", "confidence"],
          },
        },
      },
    });
    console.log(`[DEBUG] ${caller}: ai.models.generateContent returned`);

    const text = response.text?.trim();
    console.log(`[DEBUG] ${caller}: Received response text (length: ${text?.length})`);
    if (!text) {
      console.error(`[DEBUG] ${caller}: No text in response`);
      throw new Error("No hotspots returned from analysis.");
    }

    try {
      const parsed = JSON.parse(text);
      console.log(`[DEBUG] ${caller}: Parsed ${parsed.length} hotspots`);
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
      console.error(`[DEBUG] ${caller}: Failed to parse JSON`, e);
      throw new Error("Failed to parse hotspots JSON: " + (e instanceof Error ? e.message : String(e)));
    }
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
  console.log(`[DEBUG] ${caller}: Starting`);
  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  const store = getHotspotMemoryStore(process.env.GEMINI_API_KEY!);
  console.log(`[DEBUG] ${caller}: Calling store.refine`);
  const result = await store.refine(base64Image, mimeType, instruction, currentHotspots);
  console.log(`[DEBUG] ${caller}: store.refine returned ${result.length} hotspots`);
  return result;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Normalise styles input to a valid, deduplicated array */
export function normalizeStyles(
  input: SchematicStyle[] | SchematicStyle | undefined | null
): SchematicStyle[] {
  if (!input) return ["modern"];
  const arr = Array.isArray(input) ? input : [input];
  const valid = arr.filter((s) => s in STYLE_REGISTRY) as SchematicStyle[];
  return valid.length > 0 ? [...new Set(valid)] : ["modern"];
}

/** Human-readable style label */
export function getStyleLabel(style: SchematicStyle): string {
  return STYLE_REGISTRY[style]?.label ?? style;
}

/** Human-readable style description for tooltips */
export function getStyleDescription(style: SchematicStyle): string {
  const prompt = STYLE_REGISTRY[style]?.prompt ?? "";
  // Extract first bullet as description
  const match = prompt.match(/•\s+(.+)/);
  return match ? match[1].trim() : style;
}

/** All available styles */
export function getAvailableStyles(): SchematicStyle[] {
  return Object.keys(STYLE_REGISTRY) as SchematicStyle[];
}

/** Validate a configuration before sending to the API */
export function validateConfig(
  config: Partial<SchematicEnhancementConfig>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.styles || config.styles.length === 0) {
    warnings.push("No styles specified — defaulting to 'modern'.");
  } else {
    const invalid = config.styles.filter((s) => !(s in STYLE_REGISTRY));
    if (invalid.length > 0) {
      errors.push(`Unknown styles: ${invalid.join(", ")}`);
    }
    if (config.styles.length > 3) {
      warnings.push(
        "More than 3 styles may produce inconsistent output. Recommend 1–3."
      );
    }
  }

  if (config.customPrompt && config.customPrompt.length > 1000) {
    warnings.push(
      "Custom prompt exceeds 1000 characters; extremely long instructions may be partially ignored."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Estimate processing complexity for a given configuration */
export function estimateComplexity(
  config: Partial<SchematicEnhancementConfig>
): ProcessingComplexity {
  let score = 0;
  score += (config.styles?.length ?? 1) * 2;
  score += config.outputQuality === "high" ? 3 : config.outputQuality === "maximum" ? 6 : 1;
  score += config.customPrompt && config.customPrompt.trim().length > 0 ? 2 : 0;
  score += config.enhanceDetails ? 2 : 0;
  score += config.preserveGeometry ? 1 : 0;

  if (score <= 6)  return "low";
  if (score <= 12) return "medium";
  return "high";
}

/** Estimated latency in seconds (rough heuristic for UI hints) */
export function estimateLatencySeconds(
  model: ModelVersion,
  imageSize: ImageSize,
  quality: OutputQuality
): number {
  const base: Record<ModelVersion, number> = {
    "gemini-3.1-flash-lite-preview": 4,
    "gemini-3-flash-preview": 6,
    "gemini-3.1-flash-image-preview": 8,
    "gemini-3-pro-image-preview":     18,
    "gemini-2.5-flash-image":         10,
  };
  const sizeMultiplier: Record<ImageSize, number> = {
    "512px": 0.6, "1K": 1.0, "2K": 1.8, "4K": 3.2,
  };
  const qualityMultiplier: Record<OutputQuality, number> = {
    standard: 1.0, high: 1.3, maximum: 1.7,
  };

  return Math.round(
    base[model] * sizeMultiplier[imageSize] * qualityMultiplier[quality]
  );
}
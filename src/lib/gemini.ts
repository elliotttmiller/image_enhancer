// gemini.ts
// Production Grade — v4.0
// Staged pipeline: analyze → generate → verify → targeted-retry
// Modular prompt contracts, real validation, IP/compliance guardrails

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
  PART_ANALYSIS_PROMPT,
  GENERATION_VERIFICATION_PROMPT,
  buildTargetedRetryDirective,
} from "./prompts";
import {
  getPolicyForMode,
  PartDescriptor,
  VerificationResult,
  FailureReason,
  CREATIVE_MODE_VERSION,
  TOPOLOGY_FAILURE_MAX_FIDELITY_SCORE,
} from "./creativeModeConfig";

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
// PRE-GENERATION ANALYSIS — analyzePartForRegeneration
// Calls a vision model to extract a structured PartDescriptor from the
// original image BEFORE generation so the generation prompt can be
// enriched with concrete inventory/material/compliance context.
// ============================================================================

export async function analyzePartForRegeneration(
  base64Image: string,
  mimeType: string
): Promise<PartDescriptor> {
  const caller = "analyzePartForRegeneration";
  validateApiKey(caller);

  const analysisModel = "gemini-3.1-pro-preview";

  return withRetry(async (attempt) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.info(`[gemini] ${caller} — attempt ${attempt} | model=${analysisModel}`);

    const response = await ai.models.generateContent({
      model: analysisModel,
      contents: {
        parts: [
          { text: PART_ANALYSIS_PROMPT },
          { inlineData: { mimeType, data: base64Image } },
        ],
      },
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No analysis text returned.");

    try {
      const parsed = JSON.parse(text) as PartDescriptor;
      console.info(`[gemini] ${caller} — success | inventory items: ${parsed.inventory?.length ?? 0}`);
      return parsed;
    } catch {
      throw new Error(`Failed to parse PartDescriptor JSON: ${text.substring(0, 200)}`);
    }
  }, 'text', { maxAttempts: 3, baseDelayMs: 800, maxDelayMs: 5000, backoffMultiplier: 2.0 });
}

// ============================================================================
// POST-GENERATION VERIFICATION — verifyRegeneration
// Sends both the original image and the generated image to a vision model
// and asks it to score the output against the PartDescriptor and the
// creative-mode contracts. Returns a VerificationResult with sub-scores
// and specific failure reasons the retry system can act on.
// ============================================================================

export async function verifyRegeneration(
  originalBase64: string,
  originalMimeType: string,
  generatedBase64: string,
  generatedMimeType: string,
  partDescriptor: PartDescriptor
): Promise<VerificationResult> {
  const caller = "verifyRegeneration";
  validateApiKey(caller);

  const verificationModel = "gemini-3.1-pro-preview";

  const descriptorJson = JSON.stringify(partDescriptor, null, 2);
  const verificationPromptWithDescriptor = `
${GENERATION_VERIFICATION_PROMPT}

ORIGINAL PART ANALYSIS (pre-computed descriptor):
${descriptorJson}
`;

  return withRetry(async (attempt) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.info(`[gemini] ${caller} — attempt ${attempt} | model=${verificationModel}`);

    const response = await ai.models.generateContent({
      model: verificationModel,
      contents: {
        parts: [
          { text: verificationPromptWithDescriptor },
          { text: "IMAGE 1 — ORIGINAL:" },
          { inlineData: { mimeType: originalMimeType, data: originalBase64 } },
          { text: "IMAGE 2 — GENERATED OUTPUT (evaluate this):" },
          { inlineData: { mimeType: generatedMimeType, data: generatedBase64 } },
        ],
      },
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No verification response returned.");

    try {
      const raw = JSON.parse(text);

      // Hard-cap fidelity when topology or morphing failures are present.
      // The Gemini verifier sometimes assigns 0.40 to fundamentally wrong shapes;
      // this guard ensures those cases reliably fail the 0.75 fidelity threshold.
      const hasTopologyOrMorphingFailure = Array.isArray(raw.failureReasons) &&
        raw.failureReasons.some((r: { type: string }) =>
          r.type === 'topology_change' || r.type === 'morphing'
        );
      if (hasTopologyOrMorphingFailure) {
        raw.dimensionalFidelityScore = Math.min(
          raw.dimensionalFidelityScore ?? 0,
          TOPOLOGY_FAILURE_MAX_FIDELITY_SCORE
        );
      }

      const overallScore = (
        (raw.inventoryMatchScore ?? 0) * 0.40 +
        (raw.dimensionalFidelityScore ?? 0) * 0.35 +
        (raw.noveltyScore ?? 0) * 0.25
      );

      const result: VerificationResult = {
        passed: false, // will be evaluated by caller against policy thresholds
        overallScore,
        inventoryMatchScore: raw.inventoryMatchScore ?? 0,
        dimensionalFidelityScore: raw.dimensionalFidelityScore ?? 0,
        noveltyScore: raw.noveltyScore ?? 0,
        compliancePassed: raw.compliancePassed ?? true,
        failureReasons: (raw.failureReasons ?? []) as FailureReason[],
        warnings: raw.warnings ?? [],
      };

      console.info(
        `[gemini] ${caller} — success | inventory=${(result.inventoryMatchScore * 100).toFixed(0)}% | fidelity=${(result.dimensionalFidelityScore * 100).toFixed(0)}% | novelty=${(result.noveltyScore * 100).toFixed(0)}% | compliance=${result.compliancePassed}`
      );
      return result;
    } catch {
      throw new Error(`Failed to parse VerificationResult JSON: ${text.substring(0, 200)}`);
    }
  }, 'text', { maxAttempts: 3, baseDelayMs: 800, maxDelayMs: 5000, backoffMultiplier: 2.0 });
}

// ============================================================================
// PROMPT BUILDER — buildRegenerationPrompt
// Composes the generation prompt, optionally injecting:
//   - The PartDescriptor context for precise identity guidance
//   - A targeted retry directive when retrying after a known failure
//   - User's custom instructions
// ============================================================================

function buildRegenerationPrompt(
  mode: 'creative' | 'clone',
  customPrompt: string = "",
  partDescriptor?: PartDescriptor,
  retryDirective?: string
): string {
  const base = mode === 'clone'
    ? IMAGEREGENERATOR_CLONE_PROMPT
    : IMAGEREGENERATOR_CREATIVE_PROMPT;

  // =========================================================================
  // TOPOLOGY PREAMBLE — placed FIRST so it is the first thing the model reads.
  // Research and prompt-engineering practice show that constraints placed early
  // in context have stronger influence on generation than those at the end.
  // =========================================================================
  const tl = partDescriptor?.topologyLock;
  const topologyPreamble = tl
    ? `
╔═══════════════════════════════════════════════════════════════════╗
║  🔒  FROZEN PART SPECIFICATION — READ THIS BEFORE ANYTHING ELSE  ║
╚═══════════════════════════════════════════════════════════════════╝

These values are derived from automated analysis of the reference image.
You MUST render EXACTLY this specification. Any deviation causes REJECTION.

Part description : ${partDescriptor!.assemblyDescription}
Cross-section    : ${tl.crossSectionProfile}
Open / Closed    : ${tl.isClosed ? 'CLOSED — forms a complete ring/loop' : 'OPEN — NOT a ring. Do NOT close it.'}
Bend count       : ${tl.bendCount} — your output must have EXACTLY ${tl.bendCount} bend(s)
Return lips      : ${tl.returnLipCount === 0
      ? '0 — NONE. Do NOT add inward-facing lips or flanges. Adding them turns a U-channel into a C-channel (WRONG).'
      : `${tl.returnLipCount} — your output must have EXACTLY ${tl.returnLipCount}`}
Raised bridges   : ${tl.raisedBridgeCount === 0
      ? '0 — part is PLANAR/FLAT. Do NOT add arches, domes, or raised bridges of any kind.'
      : `${tl.raisedBridgeCount} raised bridge(s)`}
${tl.raisedBridgeCount > 0
      ? `Bridge height    : ≈${tl.bridgeHeightRatioPercent}% of total part width — SHALLOW. Do NOT exaggerate. Must NOT exceed ${Math.min(100, tl.bridgeHeightRatioPercent + 10)}% height ratio.`
      : ''}
Summary          : ${tl.topologySummary}

⛔ HARD STOPS FOR THIS SPECIFIC PART:
${!tl.isClosed ? '• DO NOT close the open part into a ring, tube, or loop.\n' : ''}${tl.returnLipCount === 0 ? '• DO NOT add inward-facing return lips — that morphs it from a U-channel into a C-channel.\n' : ''}${tl.raisedBridgeCount === 0 ? '• DO NOT add any raised arch, dome, or bridge — the part is FLAT/PLANAR.\n' : ''}${tl.raisedBridgeCount > 0 ? `• DO NOT exaggerate the bridge height — it is only ${tl.bridgeHeightRatioPercent}% of the part width. A tall semi-circular arch is WRONG.\n` : ''}• DO NOT substitute circular holes/notches with rectangular cutouts or vice versa.
• DO NOT add flanges, walls, or features that are not in the reference.

MANDATORY SELF-CHECK BEFORE RENDERING:
  1. State: "My output cross-section is: ___" — must match "${tl.crossSectionProfile}"
  2. State: "My output is [open/closed]" — must match "${tl.isClosed ? 'closed' : 'open'}"
  3. State: "Return lips in my output: ___" — must be ${tl.returnLipCount}
  4. State: "Raised bridges in my output: ___" — must be ${tl.raisedBridgeCount}
  ${tl.raisedBridgeCount > 0 ? `5. State: "Bridge height ratio: ___%" — must be ≤${tl.bridgeHeightRatioPercent + 10}%` : ''}
  If ANY of these are wrong: STOP. Do not render. Correct the specification first.

╔═══════════════════════════════════════════════════════════════════╗
║                    END FROZEN SPECIFICATION                       ║
╚═══════════════════════════════════════════════════════════════════╝
`
    : '';

  const sections: string[] = [];

  // 1. Topology preamble (highest priority — first in context)
  if (topologyPreamble) {
    sections.push(topologyPreamble);
  }

  // 2. Targeted retry directive (if this is a corrective attempt)
  if (retryDirective?.trim()) {
    sections.push(retryDirective);
  }

  // 3. Base prompt (full creative or clone directive)
  sections.push(base);

  // 4. Part context block (inventory, materials, features + topology reminder)
  if (partDescriptor) {
    const inventoryList = partDescriptor.inventory
      .map(item => `  • ${item.count}× ${item.name} (${item.category}): ${item.shortDescription}`)
      .join('\n');

    const materialsList = partDescriptor.materials
      .map(m => `  • ${m.component}: ${m.material}, ${m.finish}`)
      .join('\n');

    const featuresList = partDescriptor.distinctiveFeatures
      .map(f => `  • ${f}`)
      .join('\n');

    const complianceNotes = partDescriptor.complianceFlags.length > 0
      ? partDescriptor.complianceFlags
          .filter(f => f.mustNeutralise)
          .map(f => `  • REMOVE: ${f.type} — ${f.description}`)
          .join('\n')
      : '  • None detected';

    // Topology reminder (condensed) — reinforces the preamble from the other end
    const topologyReminder = tl
      ? `
🔒 TOPOLOGY REMINDER (see full spec at the top of this prompt):
   Cross-section: ${tl.crossSectionProfile} | Open/Closed: ${tl.isClosed ? 'CLOSED' : 'OPEN'} | Return lips: ${tl.returnLipCount} | Bridges: ${tl.raisedBridgeCount}${tl.raisedBridgeCount > 0 ? ` (height ≤${tl.bridgeHeightRatioPercent + 10}% of part width)` : ''}
`
      : '';

    sections.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART CONTEXT — Pre-analysis descriptor (use this to guide generation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Assembly: ${partDescriptor.assemblyDescription}
View type in original: ${partDescriptor.viewType}
${topologyReminder}
INVENTORY (every item must appear in your output):
${inventoryList}

MATERIALS & FINISHES:
${materialsList}

DISTINCTIVE FEATURES (verify these are present):
${featuresList}

COMPLIANCE — must neutralise in output:
${complianceNotes}
`);
  }

  // 5. Custom prompt (user instructions, last)
  if (customPrompt.trim()) {
    sections.push(`
ADDITIONAL INSTRUCTIONS FROM USER:
${customPrompt.trim()}`);
  }

  return sections.join('\n');
}

// ============================================================================
// PUBLIC API — regenerateImage
// Staged pipeline v2: analyze → generate → verify → targeted-retry
// ============================================================================

/**
 * Regenerates a product/part image.
 *
 * Creative mode staged pipeline:
 *   1. Pre-analysis: extract PartDescriptor from original
 *   2. Context-aware generation using PartDescriptor
 *   3. Post-generation verification against original + descriptor
 *   4. Targeted retry with failure-specific corrections (if verification fails)
 *
 * Clone mode: deterministic reproduction, same pipeline but lower temp +
 *   stricter thresholds + no novelty requirement.
 */
export async function regenerateImage(
  base64Image: string,
  mimeType: string,
  customPrompt: string = "",
  aspectRatio: AspectRatioOption = "1:1",
  imageSize: ImageSize = "1K",
  model: ModelVersion = "gemini-3.1-flash-image-preview",
  mode: 'creative' | 'clone' = 'creative'
): Promise<{ imageUrl: string; aspectRatio: AspectRatio; verificationResult?: VerificationResult }> {
  const caller = "regenerateImage";

  validateApiKey(caller);
  validateBase64Image(base64Image, caller);

  const policy = getPolicyForMode(mode);

  console.info(
    `[gemini] ${caller} — starting | mode=${mode} | policy_version=${policy.version} | model=${model} | size=${imageSize}`
  );

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
  // STEP 2: PRE-ANALYSIS (extract PartDescriptor for context-aware generation)
  // ========================================================================
  let partDescriptor: PartDescriptor | undefined;
  if (policy.enablePreAnalysis) {
    try {
      partDescriptor = await analyzePartForRegeneration(base64Image, mimeType);
    } catch (e) {
      console.warn("[gemini] Pre-analysis failed — proceeding without descriptor:", e);
    }
  }

  // ========================================================================
  // STEP 3: GENERATION WITH RETRY LOOP
  // Outer loop handles targeted retries after verification failures.
  // Inner withRetry handles API-level failures (rate limits, network errors).
  // ========================================================================
  const regeneratePolicy: RetryPolicy = {
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
    maxDelayMs: policy.maxDelayMs,
    backoffMultiplier: policy.backoffMultiplier,
  };

  let lastVerificationResult: VerificationResult | undefined;
  let retryDirective = "";
  let targetedRetryCount = 0;

  for (let targetedAttempt = 0; targetedAttempt <= policy.maxTargetedRetries; targetedAttempt++) {
    const prompt = buildRegenerationPrompt(mode, customPrompt, partDescriptor, retryDirective);

    const generatedImageData = await withRetry(async (attempt) => {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      // Model escalation: requested → Pro → 2.5 Flash
      let currentModel: ModelVersion;
      if (attempt <= 2) {
        currentModel = model;
      } else if (attempt <= 4) {
        currentModel = "gemini-3-pro-image-preview";
      } else {
        currentModel = "gemini-2.5-flash-image";
      }

      // Temperature: add small increment on later targeted retries to increase diversity
      const baseTemp = policy.temperature;
      const retryTempBoost = targetedAttempt * 0.05;
      const apiTempBoost = attempt > 1 ? 0.03 : 0;
      const adjustedTemp = Math.min(1.0, baseTemp + retryTempBoost + apiTempBoost);

      console.info(
        `[gemini] ${caller} — targeted_attempt=${targetedAttempt + 1} api_attempt=${attempt}/${regeneratePolicy.maxAttempts} | model=${currentModel} | mode=${mode} | temp=${adjustedTemp.toFixed(2)} | ratio=${targetAspectRatio}`
      );

      const parts: any[] = [
        { text: prompt },
        { inlineData: { mimeType, data: base64Image } },
      ];

      const response = await ai.models.generateContent({
        model: currentModel,
        contents: { parts },
        config: {
          imageConfig: { imageSize, aspectRatio: targetAspectRatio },
          temperature: adjustedTemp,
          topP: policy.topP,
          topK: policy.topK,
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

      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'OTHER') {
        console.warn(`[gemini] ${caller} — suspicious finish reason: ${candidate.finishReason}`);
      }

      const { data, mimeType: outMime } = extractImageFromResponse(
        candidate as Parameters<typeof extractImageFromResponse>[0]
      );

      if (!data || data.length < 1000) {
        throw {
          code: ErrorCode.NO_IMAGE_IN_RESPONSE,
          message: `Image data suspiciously small (${data?.length ?? 0} bytes). Possible corruption.`,
          retryable: true,
        } satisfies AppError;
      }

      console.info(`[gemini] ${caller} — generated | size=${data.length} bytes | mime=${outMime}`);
      return { data, mimeType: outMime };
    }, 'image', regeneratePolicy);

    // ======================================================================
    // STEP 4: POST-GENERATION VERIFICATION
    // ======================================================================
    if (policy.enablePostVerification && partDescriptor) {
      try {
        const verResult = await verifyRegeneration(
          base64Image,
          mimeType,
          generatedImageData.data,
          generatedImageData.mimeType,
          partDescriptor
        );

        // Evaluate against policy thresholds
        const inventoryOk = verResult.inventoryMatchScore >= policy.inventoryMatchThreshold;
        const fidelityOk  = verResult.dimensionalFidelityScore >= policy.dimensionalFidelityThreshold;
        const noveltyOk   = policy.noveltyThreshold <= 0 || verResult.noveltyScore >= policy.noveltyThreshold;
        const complianceOk = !policy.enableComplianceGuardrails || verResult.compliancePassed;

        verResult.passed = inventoryOk && fidelityOk && noveltyOk && complianceOk;
        lastVerificationResult = verResult;

        console.info(
          `[gemini] ${caller} — verification | passed=${verResult.passed} | ` +
          `inventory=${(verResult.inventoryMatchScore * 100).toFixed(0)}% (min ${(policy.inventoryMatchThreshold * 100).toFixed(0)}%) | ` +
          `fidelity=${(verResult.dimensionalFidelityScore * 100).toFixed(0)}% (min ${(policy.dimensionalFidelityThreshold * 100).toFixed(0)}%) | ` +
          `novelty=${(verResult.noveltyScore * 100).toFixed(0)}% (min ${(policy.noveltyThreshold * 100).toFixed(0)}%) | ` +
          `compliance=${complianceOk}`
        );

        if (verResult.passed) {
          return {
            imageUrl: `data:${generatedImageData.mimeType};base64,${generatedImageData.data}`,
            aspectRatio: targetAspectRatio,
            verificationResult: verResult,
          };
        }

        // Build targeted retry directive for next attempt
        if (policy.enableTargetedRetry && targetedAttempt < policy.maxTargetedRetries) {
          retryDirective = buildTargetedRetryDirective(verResult.failureReasons);
          targetedRetryCount++;
          console.warn(
            `[gemini] ${caller} — verification failed | reasons: ${verResult.failureReasons.map(r => r.type).join(', ')} | targeted_retry=${targetedRetryCount}`
          );
          // Brief pause before targeted retry
          await sleep(1500);
          continue;
        }

        // Max targeted retries exhausted — return best result with warning
        console.warn(`[gemini] ${caller} — max targeted retries exhausted; returning last output with verification attached`);
        return {
          imageUrl: `data:${generatedImageData.mimeType};base64,${generatedImageData.data}`,
          aspectRatio: targetAspectRatio,
          verificationResult: verResult,
        };
      } catch (verifyError) {
        // Verification itself failed — log and proceed without gating
        console.warn("[gemini] Post-generation verification failed:", verifyError);
        return {
          imageUrl: `data:${generatedImageData.mimeType};base64,${generatedImageData.data}`,
          aspectRatio: targetAspectRatio,
        };
      }
    }

    // No verification configured — return immediately
    return {
      imageUrl: `data:${generatedImageData.mimeType};base64,${generatedImageData.data}`,
      aspectRatio: targetAspectRatio,
    };
  }

  // Should never reach here — TypeScript safety fallback
  throw {
    code: ErrorCode.GENERATION_FAILED,
    message: "regenerateImage: all targeted retry attempts exhausted.",
    retryable: false,
  } satisfies AppError;
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
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
  /** Short human-readable description for UI display */
  label: string;
  /** One-line summary for UI and prompt composition */
  summary: string;
  /** Blend weight when multiple styles are selected (0.0–1.0) */
  weight: number;
  /** Temperature offset applied on top of the base value */
  temperatureDelta: number;
  /** Dominant rendering intent for this style */
  renderingIntent: string;
  /** Core visual pillars that define the style */
  pillars: string[];
  /** Linework and drafting directives */
  lineSystem: string[];
  /** Material and shading directives */
  surfaceSystem: string[];
  /** Composition / projection directives */
  compositionSystem: string[];
  /** Absolute prohibitions to avoid regressions */
  prohibitions: string[];
}

const STYLE_REGISTRY: Record<SchematicStyle, StyleDescriptor> = {
  "hybrid-realism": {
    label: "Hybrid CAD Realism",
    summary: "Premium exploded-view CAD rendering with strong material separation and disciplined technical edges.",
    weight: 1.0,
    temperatureDelta: -0.06,
    renderingIntent: "Render the assembly like a premium studio-grade CAD illustration while preserving the discipline of a technical diagram.",
    pillars: [
      "High-end SolidWorks / KeyShot technical rendering language rather than flat line art",
      "Aggressive part-to-part material separation so housings, fasteners, knobs, rails, and inserts read as different manufactured objects",
      "Exploded-view spacing, geometry, and callout alignment remain engineering-accurate",
    ],
    lineSystem: [
      "Retain ultra-crisp silhouette edges and secondary form-break lines around every major component",
      "Use line hierarchy sparingly: outer contours strongest, feature lines lighter, micro-detail subordinate",
      "Keep edges clean and deliberate; no sketchiness, wobble, or fuzzy anti-aliased softness",
    ],
    surfaceSystem: [
      "Apply pristine CAD-perfect materials such as matte polymer, powder-coated metal, anodized aluminum, molded rubber, zinc fasteners, and brushed inserts",
      "Use soft studio global illumination, controlled edge highlights, and contained ambient occlusion to reveal form",
      "Favor clean tonal ramps and manufacturable surfaces over flat monochrome fills",
    ],
    compositionSystem: [
      "Pure white background with no paper texture, framing residue, or cast-shadow contamination",
      "Exploded components should feel dimensional and premium, but still diagrammatic rather than photographic",
      "Treat each part as a hero object with legible depth, crisp separation, and stable orientation",
    ],
    prohibitions: [
      "No dirt, scratches, sensor noise, film grain, heavy texture grunge, or photoreal camera artifacts",
      "No flat black silhouette redraws that merely clean the original without materially upgrading it",
      "No drifting toward casual concept art, painterly rendering, or soft toy-like forms",
    ],
  },

  modern: {
    label: "Modern CAD",
    summary: "Clean contemporary engineering illustration with disciplined geometry and restrained tonal depth.",
    weight: 0.94,
    temperatureDelta: -0.02,
    renderingIntent: "Produce a polished modern CAD plate that feels precise, contemporary, and production-ready.",
    pillars: [
      "Contemporary engineering documentation aesthetic rather than vintage drafting or artistic rendering",
      "Sharp geometry and organized visual hierarchy with a clean commercial presentation",
      "Selective tonal modeling to clarify form without abandoning the drafting look",
    ],
    lineSystem: [
      "Outer contour lines are decisive and clean; internal feature lines are lighter and more selective",
      "Preserve orthographic clarity and contour discipline; no loose strokes or ornamental linework",
      "Use restrained edge emphasis to keep the diagram readable at a glance",
    ],
    surfaceSystem: [
      "Minimal but meaningful ambient occlusion in recesses and overlaps",
      "Controlled grayscale or muted industrial accents only where they improve readability",
      "Surfaces should read as engineered objects, not empty flat fills",
    ],
    compositionSystem: [
      "Pure white background with strong plate cleanliness and zero border residue",
      "Balanced negative space and disciplined exploded layout",
      "Professional engineering brochure / service-manual quality presentation",
    ],
    prohibitions: [
      "No heavy painterly shading, no blueprint wash, no sepia paper treatment",
      "No cluttered decorative accents or infographic styling",
      "No collapse into low-effort black-and-white scan cleanup",
    ],
  },

  blueprint: {
    label: "Blueprint",
    summary: "Classic blueprint drafting with crisp white linework, calibrated grid presence, and deep technical blue atmosphere.",
    weight: 0.9,
    temperatureDelta: 0,
    renderingIntent: "Emulate a premium archival blueprint plate while maintaining component clarity and exploded-view legibility.",
    pillars: [
      "Deep blueprint field with clean high-contrast drafting lines",
      "Archival engineering atmosphere without degrading readability",
      "Measured grid presence that supports the drawing instead of overpowering it",
    ],
    lineSystem: [
      "Render all principal geometry in crisp white linework with disciplined thickness hierarchy",
      "Use hairlines for minor details and slightly stronger white contours for primary part boundaries",
      "Leader lines and callouts remain sharp, technical, and evenly weighted",
    ],
    surfaceSystem: [
      "Shading is subtle and blueprint-native, using restrained tonal separation instead of modern glossy rendering",
      "Keep part faces legible through value shifts, not through photoreal materials",
      "Maintain a technical drafting identity even when volume is suggested",
    ],
    compositionSystem: [
      "Background is a saturated blueprint blue with uniform finish and zero paper creasing",
      "Grid may be visible but low-opacity and perfectly aligned",
      "Overall plate should feel archival, premium, and clean rather than distressed",
    ],
    prohibitions: [
      "No neon blue, no glowing sci-fi UI treatment, no cyberpunk effects",
      "No beige paper texture or vintage sepia contamination",
      "No muddy low-contrast blueprint that obscures part boundaries",
    ],
  },

  patent: {
    label: "Patent Drawing",
    summary: "Strict patent-office drafting with monochrome ink logic, hatching discipline, and zero decorative styling.",
    weight: 0.88,
    temperatureDelta: -0.05,
    renderingIntent: "Produce a rigorous patent-style technical plate that looks formally compliant, controlled, and publication-ready.",
    pillars: [
      "Monochrome legal-document drafting with section hatching and diagram clarity",
      "Mechanical precision over visual drama",
      "Highly conservative presentation suitable for formal documentation",
    ],
    lineSystem: [
      "Solid black ink only with controlled outline, section, and centerline hierarchy",
      "Use disciplined parallel hatching and stipple-derived shading only where structurally necessary",
      "Contours, hidden lines, and leaders must look deliberate and standards-aware",
    ],
    surfaceSystem: [
      "Convey volume through hatching logic rather than tonal gradients",
      "Keep surfaces crisp and mechanically described, not shaded like a render",
      "Preserve every visible feature required for identification and claims support",
    ],
    compositionSystem: [
      "White legal-document background with zero decorative treatment",
      "Part spacing and annotation relation must read like a formal patent figure",
      "Overall plate should feel publication-clean, high-resolution, and standards-conscious",
    ],
    prohibitions: [
      "No grayscale gradients, no color, no atmospheric lighting",
      "No branding, decorative framing, or stylized typography",
      "No comic-book hatching or expressive illustration energy",
    ],
  },

  artistic: {
    label: "Artistic Technical",
    summary: "Expressive concept-illustration energy layered on top of mechanically disciplined drafting.",
    weight: 0.8,
    temperatureDelta: +0.1,
    renderingIntent: "Create a premium concept-board technical illustration that still respects geometry, assemblies, and exploded-view logic.",
    pillars: [
      "Expressive industrial-design presentation with real visual hierarchy",
      "Mechanical fidelity remains non-negotiable despite stylistic energy",
      "Selective drama through edge accents, marker shading, and composition",
    ],
    lineSystem: [
      "Allow varied line weight for hierarchy, but keep curves, circles, and joins mechanically accurate",
      "Contour strokes may be slightly more expressive on hero edges only",
      "Leaders and callouts remain neat and technical, never hand-wavy",
    ],
    surfaceSystem: [
      "Use controlled marker-style tonal blocks and hard-edge highlights instead of soft airbrush fog",
      "Material separation should still read clearly, especially on hero components",
      "Shading should enhance drama without obscuring the exploded structure",
    ],
    compositionSystem: [
      "Plate should feel like a premium industrial design presentation board",
      "Use white or near-white clean background with room for the assembly to breathe",
      "Maintain professional restraint; artistic treatment is secondary to clarity",
    ],
    prohibitions: [
      "No loose sketchbook mess, thumbnail roughness, or unfinished concept noise",
      "No watercolor bloom, comic shading, or anime stylization",
      "No sacrificing engineering readability for mood",
    ],
  },

  minimalist: {
    label: "Minimalist",
    summary: "Reductionist engineering line art with ruthless clarity and no unnecessary visual noise.",
    weight: 0.82,
    temperatureDelta: -0.1,
    renderingIntent: "Reduce the assembly to its essential geometry while retaining precision and legibility.",
    pillars: [
      "Extreme clarity through subtraction rather than embellishment",
      "Only essential geometry, boundaries, and callout structure remain",
      "Elegant engineering austerity with no wasted marks",
    ],
    lineSystem: [
      "Uniform or near-uniform line system with disciplined contour consistency",
      "Remove non-essential secondary detailing and decorative texture lines",
      "Geometry must remain crisp, deliberate, and mathematically stable",
    ],
    surfaceSystem: [
      "No rendered materials; volume is communicated only by contour and minimal overlaps",
      "No gradients, glossy fills, or atmospheric shading",
      "Use blank space as an intentional design element",
    ],
    compositionSystem: [
      "Pure white background and highly restrained plate composition",
      "Assembly must feel orderly, breathable, and graphically precise",
      "Preserve enough information for identification even after simplification",
    ],
    prohibitions: [
      "No realistic textures, no heavy shading, no decorative rendering",
      "No accidental scan cleanup residue or inconsistent line density",
      "No over-simplification that erases critical component identity",
    ],
  },

  isometric: {
    label: "Isometric",
    summary: "Projection-first engineering illustration with mathematically disciplined isometric structure.",
    weight: 0.9,
    temperatureDelta: 0,
    renderingIntent: "Present the assembly as a true technical isometric illustration with projection integrity and clean depth communication.",
    pillars: [
      "Projection accuracy is the primary visual law",
      "Exploded spacing and axes feel mathematically deliberate",
      "Depth is shown through structure and disciplined line systems, not perspective drama",
    ],
    lineSystem: [
      "Maintain consistent isometric axis behavior and clean line hierarchy",
      "Use optional hidden-line conventions only where they add clarity",
      "All circular and cylindrical forms must resolve correctly within isometric geometry",
    ],
    surfaceSystem: [
      "Shading, if present, is subordinate to projection accuracy",
      "Surfaces may receive restrained tonal differentiation to separate planes",
      "Keep all rendered depth consistent with isometric logic",
    ],
    compositionSystem: [
      "Assembly should read like a premium technical projection plate, not a perspective render",
      "Spacing between parts must support exploded-view comprehension",
      "Background remains clean and non-distracting",
    ],
    prohibitions: [
      "No perspective distortion or cinematic camera angle behavior",
      "No exaggerated foreshortening or concept-art depth tricks",
      "No sloppy ellipse handling or broken axis consistency",
    ],
  },

  vintage: {
    label: "Vintage",
    summary: "Refined early-industrial drafting with elegant archival warmth and controlled period character.",
    weight: 0.78,
    temperatureDelta: +0.05,
    renderingIntent: "Capture the elegance of early 20th-century engineering plates without degrading precision or readability.",
    pillars: [
      "Period-authentic warmth with controlled archival character",
      "Still precise and premium, not distressed or damaged",
      "Historic drafting atmosphere layered on top of clean geometry",
    ],
    lineSystem: [
      "Warm sepia / brown-black ink logic with slightly softened but still disciplined stroke edges",
      "Line hierarchy remains readable and mechanically controlled",
      "Hatching and notation should feel historically grounded rather than modern CAD-clean",
    ],
    surfaceSystem: [
      "Allow subtle paper warmth and minimal print-era character only",
      "Any imperfections must be refined and intentional, never dirty",
      "Volume can be suggested by period-appropriate hatching and tonal restraint",
    ],
    compositionSystem: [
      "Use an aged-ivory plate background with premium archival cleanliness",
      "Overall feeling should be museum-quality engineering ephemera, not damaged paperwork",
      "Keep the exploded assembly central, legible, and beautifully balanced",
    ],
    prohibitions: [
      "No coffee stains, folds, tears, grime, or fake distress overlays",
      "No modern neon accents or glossy rendering language",
      "No collapse into unreadable antique texture noise",
    ],
  },

  realistic: {
    label: "Enhanced Realism",
    summary: "Material-forward technical rendering that pushes realism hard without becoming a photograph.",
    weight: 0.96,
    temperatureDelta: +0.05,
    renderingIntent: "Push the schematic toward premium manufactured-object realism while preserving its technical identity and exploded layout.",
    pillars: [
      "Strong material believability and volume communication",
      "Still recognizably a technical diagram, not an ecommerce product photo",
      "Each major component should feel physically plausible and manufactured",
    ],
    lineSystem: [
      "Retain crisp silhouette lines and key construction edges so the diagram remains technically legible",
      "Use edge emphasis to separate adjoining materials and overlapping parts",
      "Never let realistic shading erase component boundaries or leader attachment clarity",
    ],
    surfaceSystem: [
      "Apply believable metals, polymers, rubbers, and coatings with clean industrial finishes",
      "Use controlled highlights, contact occlusion, and tonal gradients to create obvious 3D form",
      "Favor pristine manufactured realism over camera-based photorealism",
    ],
    compositionSystem: [
      "White presentation background with disciplined commercial cleanliness",
      "Exploded assembly remains centered and readable, with enhanced object presence",
      "Overall feel should approach premium product documentation visuals",
    ],
    prohibitions: [
      "No bokeh, lens blur, depth-of-field photography, or HDR photo tonemapping",
      "No dirty real-world wear unless explicitly requested elsewhere",
      "No sacrificing technical layout for cinematic composition",
    ],
  },

  production: {
    label: "Production Illustration",
    summary: "Top-tier service-manual hero style optimized for maximum clarity, manufacturability, and premium presentation.",
    weight: 1.0,
    temperatureDelta: -0.05,
    renderingIntent: "Deliver the highest-grade service-manual / OEM technical illustration style in the library.",
    pillars: [
      "OEM-grade clarity suitable for manuals, parts catalogs, and service documentation",
      "Maximum geometry confidence and part differentiation",
      "Premium but disciplined rendering that communicates manufacturability instantly",
    ],
    lineSystem: [
      "Perfectly controlled line hierarchy with confident contours and surgically clean feature edges",
      "Every circle, slot, chamfer, fastener, and thread indication must look engineered",
      "Callouts and leader relations remain exact and publication-ready",
    ],
    surfaceSystem: [
      "Lambertian or softly studio-lit technical shading with polished tonal discipline",
      "Materials are separated clearly but rendered conservatively enough to stay documentation-friendly",
      "Use contact occlusion and edge highlights to explain assembly depth without spectacle",
    ],
    compositionSystem: [
      "Presentation should resemble premium OEM documentation or a top-tier service manual plate",
      "Exploded assembly should feel authoritative, balanced, and professionally art-directed",
      "Background stays immaculate and distraction-free",
    ],
    prohibitions: [
      "No flat CAD screenshot look and no low-effort scan cleanup look",
      "No cinematic photography effects or concept-art looseness",
      "No ambiguous silhouettes or muddy overlaps between adjacent parts",
    ],
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
Errors in geometry, missing parts, or missing/altered callouts are production defects and are completely unacceptable.

CRITICAL ENHANCEMENT INTENT:
This is NOT a light cleanup pass. You must visibly UPGRADE the parts with realistic industrial materials, color separation, surface finish, and believable CAD shading so the final image reads as a premium, materially accurate technical illustration.
If the result still looks mostly like the original flat black-and-white schematic, the task has failed.`.trim();

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
Step 5: PART MATERIAL MAPPING - Determine which components are cast/molded housings, painted frames, metal fasteners, rubber knobs, transparent inserts, labels, and trim.
Step 6: GENERATION PLAN - Re-draw the assembly at higher fidelity, preserving perfect geometry and callouts, while erasing all page-level branding and applying materially distinct CAD rendering to each part.
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
   When multiple styles are provided, treat the highest-influence style as the dominant art direction and use lower-influence styles only as secondary modifiers.
   The output must still feel intentional and singular, not like a confused blend of unrelated aesthetics.

4. BACKGROUND COLOR
   STRICTLY pure white (#FFFFFF) unless the "Blueprint" style is explicitly requested. Do not use tan, beige, or any other background color.

5. DETAIL ENHANCEMENT
${
  config.enhanceDetails
    ? `   Intelligently add manufacturing details that may be absent from the source: edge chamfers, internal fillets, screw threads, and functional clearance gaps. Keep them precise and mechanical.`
    : `   Preserve the existing level of detail exactly. Do not add features not visible in the source.`
}

6. MATERIAL AND COLOR FIDELITY (VISUAL UPGRADE IS MANDATORY)
${
  hasReferenceImages
    ? `   CRITICAL: You have been provided with a <MATERIAL_AND_COLOR_GUIDE> at the end of this prompt based on real-life reference photos.
   You MUST transfer the realistic part colors, finishes, and material differences from the references onto the schematic.
   Treat the reference photos as a MATERIAL SOURCE ONLY, not as a source of branding, decals, labels, printed text, stickers, serial plates, or watermarks.
   The output must still be a schematic diagram, but the components themselves must be visibly re-rendered with distinct pristine CAD materials such as:
   • matte or satin powder-coated housings
   • anodized or painted metal frames
   • zinc, stainless, or black-oxide fasteners
   • molded rubber knobs, feet, and grips
   • brushed, polished, or bead-blasted metallic inserts
   Every major part must read as a distinct object with its own finish, reflectance, and color family.`
    : `   Even without references, you MUST materially upgrade the schematic.
   Infer plausible industrial materials and assign visibly different finishes to the major parts:
   • dark matte polymer or powder-coated housings
   • painted or anodized frames
   • metallic fasteners and shafts
   • rubberized knobs or contact surfaces
   The final result must show clear color/material separation across the assembly rather than a mostly monochrome redraw.`
}

7. BRANDING AND TEXT ON THE PARTS THEMSELVES
   REMOVE non-essential branding from the physical parts unless it is required as a schematic callout.
   Do NOT copy product logos, decals, printed brand names, caution labels, packaging graphics, or ornamental text from the reference photos onto the parts.
   You may preserve mechanically necessary markings only if they are clearly integral to the schematic's callout system.

8. VISUAL DEPTH AND FINISH
   The re-rendered parts must show obvious 3D form through clean CAD shading, edge highlights, contact occlusion, and controlled reflections.
   Major parts should not collapse into flat black silhouettes.
   If the output could be mistaken for a lightly cleaned scan of the original, it has failed.
   There must be visible improvement in:
   • material separation
   • tonal variation
   • surface finish realism
   • perceived depth and manufacturability

9. ${QUALITY_DIRECTIVES[config.outputQuality]}

</MANDATORY_REQUIREMENTS>

<OUTPUT_SPECIFICATION>
• Deliver: One image only.
• Prohibited: watermarks, signatures, metadata overlays, commentary boxes, text responses.
• COMPOSITION: The subject MUST fill the frame appropriately for the requested aspect ratio (${config.aspectRatio}).
• SUCCESS TEST: the output should look like a premium exploded-view CAD illustration with realistic materials, not merely the original drawing with branding removed.
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
   • REMOVE COMPLETELY any decorative or branded text printed on the page or embedded as page artwork.
   • The final output must be pure schematic geometry + callout hotspots on a clean canvas.`;
  }

  return `   CRITICAL — REMOVE COMPLETELY:
   All text, numerals, letters, labels, leader lines, arrowheads, dimension lines, title blocks, border frames, logos, branding, watermarks, and any other annotation layer.
   Result: pure geometric illustration with zero text elements and zero branding.`;
}

function getPartMaterialMapSchema() {
  return {
    type: "object",
    properties: {
      assemblyName: { type: "string" },
      overallRenderingIntent: { type: "string" },
      priorityMaterialSeparations: {
        type: "array",
        items: { type: "string" },
      },
      parts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            partId: { type: "string" },
            partName: { type: "string" },
            explodedViewLocation: { type: "string" },
            sourceEvidence: { type: "string" },
            materialClass: {
              type: "string",
              enum: ["polymer", "painted_metal", "bare_metal", "rubber", "transparent", "mixed", "unknown"],
            },
            baseColor: { type: "string" },
            finish: { type: "string" },
            textureCues: {
              type: "array",
              items: { type: "string" },
            },
            reflectance: { type: "string" },
            renderingNotes: { type: "string" },
            preserveCalloutRelation: { type: "boolean" },
            confidence: { type: "number" },
          },
          required: [
            "partId",
            "partName",
            "explodedViewLocation",
            "sourceEvidence",
            "materialClass",
            "baseColor",
            "finish",
            "textureCues",
            "reflectance",
            "renderingNotes",
            "preserveCalloutRelation",
            "confidence",
          ],
        },
      },
    },
    required: ["assemblyName", "overallRenderingIntent", "priorityMaterialSeparations", "parts"],
  } as const;
}

function formatPartMaterialMap(materialMap: PartMaterialMap): string {
  const separationBlock =
    materialMap.priorityMaterialSeparations.length > 0
      ? materialMap.priorityMaterialSeparations.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "1. Clearly separate housings, frame members, fasteners, and rubber/contact parts.";

  const partsBlock =
    materialMap.parts.length > 0
      ? materialMap.parts
          .map((part) => {
            const textureCues = part.textureCues.length > 0 ? part.textureCues.join(", ") : "minimal texture detail";
            return [
              `- ${part.partId}: ${part.partName}`,
              `  location: ${part.explodedViewLocation}`,
              `  evidence: ${part.sourceEvidence}`,
              `  material: ${part.materialClass}`,
              `  base color: ${part.baseColor}`,
              `  finish: ${part.finish}`,
              `  texture cues: ${textureCues}`,
              `  reflectance: ${part.reflectance}`,
              `  rendering notes: ${part.renderingNotes}`,
              `  preserve callout relation: ${part.preserveCalloutRelation ? "yes" : "no"}`,
              `  confidence: ${part.confidence.toFixed(2)}`,
            ].join("\n");
          })
          .join("\n")
      : "- No reliable part-level material map available.";

  return [
    `<PART_MATERIAL_MAP>`,
    `assembly: ${materialMap.assemblyName || "unknown assembly"}`,
    `rendering intent: ${materialMap.overallRenderingIntent || "Create a materially separated premium technical illustration."}`,
    `priority separations:`,
    separationBlock,
    `parts:`,
    partsBlock,
    `</PART_MATERIAL_MAP>`,
  ].join("\n");
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

interface PartMaterialMapEntry {
  partId: string;
  partName: string;
  explodedViewLocation: string;
  sourceEvidence: string;
  materialClass: "polymer" | "painted_metal" | "bare_metal" | "rubber" | "transparent" | "mixed" | "unknown";
  baseColor: string;
  finish: string;
  textureCues: string[];
  reflectance: string;
  renderingNotes: string;
  preserveCalloutRelation: boolean;
  confidence: number;
}

interface PartMaterialMap {
  assemblyName: string;
  overallRenderingIntent: string;
  priorityMaterialSeparations: string[];
  parts: PartMaterialMapEntry[];
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

function getPreferredTextModelsForSelection(model?: string): string[] {
  switch (model) {
    case "gemini-3.1-flash-image-preview":
      return ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    case "gemini-3-pro-image-preview":
      return ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    case "gemini-2.5-flash":
    case "gemini-2.5-flash-image":
    default:
      return ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  }
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
    lc.includes("invalid_argument") ||
    lc.includes("not supported by this model") ||
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
  policy: RetryPolicy = DEFAULT_RETRY,
  preferredModel?: string,
  strictPreferredModel: boolean = false
): Promise<T> {
  let lastError: AppError | null = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const model = strictPreferredModel && preferredModel
      ? preferredModel
      : getModelForAttempt(attempt, modelType, preferredModel);
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

export function getModelForAttempt(attempt: number, type: 'text' | 'image' = 'text', preferredModel?: string): string {
  const textModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  const imageModels = ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"];
  const models = type === 'text' ? textModels : imageModels;
  const orderedModels = preferredModel
    ? [preferredModel, ...models.filter((model) => model !== preferredModel)]
    : models;
  return orderedModels[Math.min(attempt - 1, orderedModels.length - 1)];
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

  const preferredTextModels = getPreferredTextModelsForSelection(model);
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
      model,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
    });

    const text = response.text?.trim();
    if (!text) throw new Error("No aspect ratio returned.");

    const match = text.match(/\b(\d+:\d+)\b/);
    const ratio = match ? match[1] as AspectRatio : "1:1";
    
    let validRatios: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
    if (isFlashImage) validRatios = [...validRatios, "1:4", "1:8", "4:1", "8:1"];
    
    return validRatios.includes(ratio) ? ratio : "1:1";
  }, "text", DEFAULT_RETRY, preferredTextModels[0]);
}

// ============================================================================
// PUBLIC API — SCHEMATIC ENHANCER
// ============================================================================

async function extractMaterialDescription(
  schematicBase64: string,
  schematicMimeType: string,
  referenceImages: { url: string; mimeType: string }[],
  model: ModelVersion = "gemini-2.5-flash-image"
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
Do NOT carry over brand logos, decals, warning stickers, printed text, or packaging graphics from the reference photos.
Treat any visible logos or printed markings as NON-MATERIAL information and exclude them from the material guide.

Provide a highly detailed, part-by-part description of these pristine CAD materials. 
This description will guide an AI to colorize the schematic components while keeping the image structurally a clean diagram.

For each major part, describe:
1. part identity / spatial position in the exploded view
2. base color
3. material type
4. finish / sheen level
5. edge treatment or reflectance behavior
6. whether it should read as polymer, painted metal, bare metal, rubber, or transparent material`;

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

  const preferredTextModels = getPreferredTextModelsForSelection(model);

  return withRetry(async (attempt, model) => {
    const ai = new GoogleGenAI();
    const response = await ai.models.generateContent({ model, contents: [{ role: "user", parts }] });
    return response.text || "Use realistic, pristine CAD materials and colors.";
  }, 'text', DEFAULT_RETRY, preferredTextModels[0]).catch(() => "Use realistic, pristine CAD materials and colors based on standard industrial design practices.");
}

async function analyzePartMaterialMap(
  schematicBase64: string,
  schematicMimeType: string,
  referenceImages: { url: string; mimeType: string }[],
  model: ModelVersion = "gemini-2.5-flash-image"
): Promise<PartMaterialMap | null> {
  const caller = "analyzePartMaterialMap";
  validateApiKey(caller);

  const parts: any[] = [
    {
      text: `You are an industrial design analyst creating a part-by-part material plan for a schematic enhancement pipeline.
Analyze the attached schematic and reference product photos. Return JSON only.

Requirements:
- Identify each major visible part in the exploded view.
- Map each part to likely real-world material, base color, finish, and texture cues from the reference photos.
- Focus on parts that materially affect the final look: housings, frame members, knobs, inserts, fasteners, rails, feet, covers, transparent windows.
- Keep descriptions concise but specific enough to guide image generation.
- Do not include branding, decals, caution labels, or printed text as materials.
- Preserve exploded-view relationships and callout alignment.
- If a part is ambiguous, still include it with lower confidence.`,
    },
    { text: "SCHEMATIC IMAGE:" },
    { inlineData: { mimeType: schematicMimeType, data: schematicBase64 } },
    { text: "REFERENCE PRODUCT PHOTOS:" },
  ];

  referenceImages.forEach((ref) => {
    const [, base64Data] = ref.url.split(";base64,");
    parts.push({ inlineData: { mimeType: ref.mimeType, data: base64Data || ref.url } });
  });

  const preferredTextModels = getPreferredTextModelsForSelection(model);

  try {
    return await withRetry(async (_attempt, model) => {
      const ai = new GoogleGenAI();
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          temperature: 0.15,
          topP: 0.8,
          topK: 20,
          responseMimeType: "application/json",
          responseSchema: getPartMaterialMapSchema(),
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error("No part/material map returned.");
      const parsed = JSON.parse(text) as PartMaterialMap;
      parsed.parts = Array.isArray(parsed.parts) ? parsed.parts.slice(0, 16) : [];
      return parsed;
    }, "text", DEFAULT_RETRY, preferredTextModels[0]);
  } catch (error) {
    console.warn("[SchematicEnhancer] part/material map prepass failed", error);
    return null;
  }
}

function buildReferenceImageParts(referenceImages?: { url: string; mimeType: string }[]) {
  if (!referenceImages || referenceImages.length === 0) return [];

  const parts: any[] = [
    {
      text: "ATTACHED REFERENCE PRODUCT PHOTOS: Use these images as the authoritative visual source for part color, material class, finish, reflectance, and texture. Transfer those material cues onto the schematic parts while keeping the output as a clean technical illustration.",
    },
  ];

  referenceImages.forEach((ref, index) => {
    const [, base64Data] = ref.url.split(";base64,");
    parts.push({ text: `REFERENCE PHOTO ${index + 1}:` });
    parts.push({ inlineData: { mimeType: ref.mimeType, data: base64Data || ref.url } });
  });

  return parts;
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
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages, model);
    const partMaterialMap = await analyzePartMaterialMap(base64Image, mimeType, referenceImages, model);
    prompt += `\n\n<MATERIAL_AND_COLOR_GUIDE>\nThe following is a detailed description of the pristine CAD materials extracted from reference photos. You MUST apply these materials to the schematic components. The output MUST remain a precise technical schematic diagram (do not output a photograph), but colored and textured with these clean materials:\n\n${materialDescription}\n</MATERIAL_AND_COLOR_GUIDE>`;
    prompt += `\n\n<REFERENCE_USAGE_RULES>\nThe attached reference product photos are the primary grounding source for the real part appearance. Use them to infer exact housing color, metal tone, gloss level, molded texture, rubber finish, and highlight behavior. Do not copy logos, product decals, printed branding, or sticker artwork from the references.\n</REFERENCE_USAGE_RULES>`;
    if (partMaterialMap) {
      prompt += `\n\n${formatPartMaterialMap(partMaterialMap)}\n\n<PART_MAP_DIRECTIVE>\nUse the part material map as a hard planning layer. Each listed part must be visibly re-rendered with its assigned material class, base color family, finish, and reflectance behavior while preserving the exploded-view layout.\n</PART_MAP_DIRECTIVE>`;
    }
  }

  if (customPrompt.trim()) {
    prompt += `\n\n<CUSTOM_DIRECTIVE>\n${customPrompt.trim()}\n</CUSTOM_DIRECTIVE>`;
  }

  const modelParams = getModelDefaults(model);
  const temperature = resolveSchematicTemperature(model, resolvedStyles, outputQuality);

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const parts = [
      { text: prompt },
      { text: "SOURCE SCHEMATIC IMAGE:" },
      { inlineData: { mimeType, data: base64Image } },
      ...buildReferenceImageParts(referenceImages),
    ];
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts }],
      config: {
        temperature, topP: modelParams.topP, topK: modelParams.topK,
        ...(currentModel.includes('image') && { imageConfig: { imageSize, aspectRatio: targetAspectRatio } })
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio };
  }, 'image', DEFAULT_RETRY, model, true);
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
  }, 'image', regeneratePolicy, model, true);
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
    const materialDescription = await extractMaterialDescription(base64Image, mimeType, referenceImages, model);
    const partMaterialMap = await analyzePartMaterialMap(base64Image, mimeType, referenceImages, model);
    prompt += `\n\n<MATERIAL_GUIDE>\nUse this pristine CAD material guide to accurately colorize the refined schematic:\n${materialDescription}\n</MATERIAL_GUIDE>`;
    prompt += `\n\n<REFERENCE_USAGE_RULES>\nThe attached product reference photos are the authoritative visual source for material realism. Transfer their color, finish, and texture cues to the corresponding parts, but do not copy logos, stickers, or printed branding.\n</REFERENCE_USAGE_RULES>`;
    if (partMaterialMap) {
      prompt += `\n\n${formatPartMaterialMap(partMaterialMap)}\n\n<PART_MAP_DIRECTIVE>\nRespect this part-by-part material plan during refinement. Strengthen material separation and texture cues for the listed parts without altering part geometry or callout alignment.\n</PART_MAP_DIRECTIVE>`;
    }
  }

  const modelParams = getModelDefaults(model);
  const temperature = Math.max(0.1, modelParams.temperature - 0.15);

  return withRetry(async (attempt, currentModel) => {
    const ai = new GoogleGenAI();
    const parts = [
      { text: prompt },
      { text: "SOURCE SCHEMATIC IMAGE:" },
      { inlineData: { mimeType, data: base64Image } },
      ...buildReferenceImageParts(referenceImages),
    ];
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [{ role: "user", parts }],
      config: { imageConfig: { imageSize, aspectRatio: targetAspectRatio }, temperature, topP: modelParams.topP, topK: modelParams.topK },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw { code: ErrorCode.NO_CANDIDATES, message: "Zero candidates.", retryable: true } satisfies AppError;

    const { data, mimeType: outMime } = extractImageFromResponse(candidate);
    return { imageUrl: `data:${outMime};base64,${data}`, aspectRatio: targetAspectRatio, hotspots: hotspots || [] };
  }, 'image', DEFAULT_RETRY, model, true);
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
  }, 'image', DEFAULT_RETRY, model, true);
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
  const sortedEntries = [...styles]
    .map((style) => ({ style, descriptor: STYLE_REGISTRY[style] }))
    .sort((a, b) => b.descriptor.weight - a.descriptor.weight);
  const totalWeight = sortedEntries.reduce((sum, entry) => sum + entry.descriptor.weight, 0) || 1;

  return sortedEntries
    .map(({ style, descriptor }) => {
      const influence = Math.max(10, Math.round((descriptor.weight / totalWeight) * 100));
      const sections = [
        `STYLE — ${descriptor.label} [${influence}% influence]`,
        `Intent: ${descriptor.renderingIntent}`,
        `Summary: ${descriptor.summary}`,
        `Visual Pillars:`,
        ...descriptor.pillars.map((item) => `• ${item}`),
        `Line System:`,
        ...descriptor.lineSystem.map((item) => `• ${item}`),
        `Surface & Material System:`,
        ...descriptor.surfaceSystem.map((item) => `• ${item}`),
        `Composition System:`,
        ...descriptor.compositionSystem.map((item) => `• ${item}`),
        `Strict Prohibitions:`,
        ...descriptor.prohibitions.map((item) => `• ${item}`),
        `Style Key: ${style}`,
      ];

      return sections.map((line) => `   ${line}`).join("\n");
    })
    .join("\n\n");
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
  return STYLE_REGISTRY[style]?.summary ?? style;
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

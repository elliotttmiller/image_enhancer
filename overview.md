# gemini.ts — Production Quality Patches
# Apply these replacements in order. Each block shows OLD → NEW.

---

## PATCH 1 — SchematicStyle type (line ~41)
Add "production" to the union.

OLD:
```ts
export type SchematicStyle =
  | "modern"
  | "blueprint"
  | "patent"
  | "artistic"
  | "minimalist"
  | "isometric"
  | "vintage"
  | "realistic";
```

NEW:
```ts
export type SchematicStyle =
  | "modern"
  | "blueprint"
  | "patent"
  | "artistic"
  | "minimalist"
  | "isometric"
  | "vintage"
  | "realistic"
  | "production";
```

---

## PATCH 2 — STYLE_REGISTRY: update "realistic", add "production" (after the "vintage" entry)

Replace the entire `realistic` entry:

OLD:
```ts
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
```

NEW:
```ts
  realistic: {
    label: "Studio Render",
    temperatureDelta: +0.05,
    weight: 0.90,
    prompt: `
STYLE — Studio-Quality Technical Render (NOT photorealistic):
  • Target: professional product illustration as seen in high-end parts catalogues and engineering manuals
  • Lighting: single soft directional source from upper-left (30° elevation, 45° azimuth) — clean, predictable, no drama
  • Materials — stylised but clearly differentiated:
    - Steel / ferrous: cool mid-grey (#6B7280), subtle radial highlight on cylindrical faces, minimal specular
    - Aluminium / light alloy: warm light grey (#D1D5DB), slightly broader diffuse band
    - Rubber / elastomer: deep charcoal (#374151), near-zero specularity, slight matte texture
    - Polymer housing: neutral grey (#9CA3AF), uniform matte shading
    - Brass / bronze: warm amber (#B45309), clean highlight band
    - Chrome / hardened steel: sharp near-white highlight (#F9FAFB) with tight radial gradient
  • Shading: 2–3 tonal zones per face; smooth gradients; zero subsurface, zero caustics, zero lens effects
  • Edges: 1–2 px crisp silhouette and form-break lines retained on all parts
  • Shadows: single soft ground-plane shadow at 20% opacity — no inter-part shadows
  • Background: pure white (#FFFFFF)
  • Depth of field: none — all components sharp and in focus
  • PROHIBITED: photography-style bokeh, HDR tone mapping, lens flares, PBR subsurface, dramatic shadows`,
  },

  production: {
    label: "Production Illustration",
    temperatureDelta: -0.05,
    weight: 1.0,
    prompt: `
STYLE — Production-Grade Technical Illustration:
  • This is the definitive style for professional engineering documentation
  • Target aesthetic: SolidWorks "Technical Illustration" render mode — unambiguously 3D, unambiguously technical, never photographic
  • Background: pure white (#FFFFFF)
  • Geometry: ultra-precise line work — perfectly straight edges, perfect circles, consistent arc radii
  • Shading model: Lambert diffuse shading with a single overhead-left light source; no specularity except on chrome/polished features
  • Tonal range: light grey (#F3F4F6) for highlight faces, mid grey (#6B7280) for side faces, dark grey (#374151) for shadow faces — three zones, cleanly delineated
  • Material differentiation:
    - All metal parts: cool grey tonal range with crisp edge highlights
    - Rubber / seals: dark matte, clearly distinct from metal
    - Springs / coils: uniform wire cross-section with consistent shading per coil
    - Fasteners: correctly shaped heads (hex, Phillips, slot), visible thread representation on exposed shanks
    - Bearings: inner/outer race clearly delineated, roller elements individually visible
  • Line weight hierarchy: silhouette 2 px, primary features 1–1.5 px, detail 0.5–1 px, hidden lines 0.5 px dashed
  • Section views (if present): hatching at 45° consistent spacing; different materials use different hatch patterns
  • Overall result: the illustration must be immediately recognisable as a professional technical drawing, not a 3D render and not a flat CAD print`,
  },
};
```

---

## PATCH 3 — MODEL_DEFAULTS temperatures (line ~489)
Lower base temperature for more geometric precision.

OLD:
```ts
const MODEL_DEFAULTS: Record<
  ModelVersion,
  { temperature: number; topP: number; topK: number }
> = {
  "gemini-2.5-flash": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
  "gemini-2.5-flash-image": {
    temperature: 0.65,
    topP: 0.92,
    topK: 40,
  },
};
```

NEW:
```ts
const MODEL_DEFAULTS: Record<
  ModelVersion,
  { temperature: number; topP: number; topK: number }
> = {
  "gemini-2.5-flash": {
    temperature: 0.55,
    topP: 0.90,
    topK: 32,
  },
  "gemini-2.5-flash-image": {
    temperature: 0.50,  // Lower = more deterministic geometry, fewer hallucinations
    topP: 0.88,
    topK: 32,
  },
};
```

---

## PATCH 4 — SYSTEM_ROLE (line ~220)
Sharpen the framing toward production illustration specifically.

OLD:
```ts
const SYSTEM_ROLE = `You are a Principal Industrial Design Engineer and Senior Technical Illustrator with 25 years of experience across aerospace, automotive, and precision manufacturing. You hold deep expertise in:

• Mechanical assemblies, tolerance stacks, and GD&T (ASME Y14.5)
• Engineering drawing standards: ISO 128, ANSI Y14.2, DIN 199, ASME Y14.3
• Technical illustration: isometric/orthographic projection, exploded views, section views
• CAD systems: SolidWorks, CATIA V5, AutoCAD, Fusion 360 — you understand how they generate output
• Material science, surface treatments, and manufacturing processes
• Patent illustration: 37 CFR 1.84 and EPO drawing requirements

Your outputs are used directly in production engineering documentation, patent filings, and ISO-certified technical manuals. Errors are unacceptable.`.trim();
```

NEW:
```ts
const SYSTEM_ROLE = `You are a Principal Industrial Design Engineer and Senior Technical Illustrator with 25 years of experience across aerospace, automotive, and precision manufacturing. You hold deep expertise in:

• Mechanical assemblies, tolerance stacks, and GD&T (ASME Y14.5)
• Engineering drawing standards: ISO 128, ANSI Y14.2, DIN 199, ASME Y14.3
• Technical illustration: isometric/orthographic projection, exploded views, section views
• CAD systems: SolidWorks, CATIA V5, AutoCAD, Fusion 360 — you understand how they render technical illustrations
• Material science: you can visually distinguish steel, aluminium, rubber, brass, polymer, and chrome on sight
• Surface treatments: anodising, powder coating, chrome plating, black oxide — each has a distinct visual signature
• Patent illustration: 37 CFR 1.84 and EPO drawing requirements

Your output standard is a professional product illustration as found in:
— OEM service manuals (Snap-on, Bosch, Parker Hannifin quality)
— Technical parts catalogues with 3D product views
— High-quality patent filings with full material and form representation

CRITICAL OUTPUT STANDARD:
The result must look like a SolidWorks "Technical Illustration" render: clearly 3D through precise shading, material-differentiated, geometrically exact — but NEVER photorealistic. No photography lighting, no PBR effects, no drama. Just clean, accurate, professional.

Errors in geometry, proportion, or component omission are production defects. They are unacceptable.`.trim();
```

---

## PATCH 5 — QUALITY_DIRECTIVES (line ~246)

OLD:
```ts
const QUALITY_DIRECTIVES: Record<OutputQuality, string> = {
  standard:
    "Output Quality: Standard. Balanced fidelity and generation speed. Acceptable minor geometric simplifications on sub-5mm features.",
  high:
    "Output Quality: High. Enhanced line precision, complete component inventory, sharp intersections. No visible approximations on visible features.",
  maximum:
    "Output Quality: Maximum — Production Ready. Absolute geometric precision. Every fastener thread visible. Every chamfer and fillet present. Zero acceptable omissions. Output must be indistinguishable from a professional CAD rendering.",
};
```

NEW:
```ts
const QUALITY_DIRECTIVES: Record<OutputQuality, string> = {
  standard:
    "Output Quality: Standard. Balanced fidelity and generation speed. Acceptable minor geometric simplifications on sub-5mm features. Materials should be clearly differentiated by tone even at this tier.",
  high:
    "Output Quality: High. Enhanced line precision, complete component inventory, sharp intersections. No visible approximations on any visible feature. Material shading must correctly represent each part type (metal/rubber/polymer). This is the minimum acceptable tier for client-facing documentation.",
  maximum:
    `Output Quality: Maximum — Production Ready.
  VISUAL BENCHMARK: The output must be indistinguishable from a professional illustration produced by a senior technical artist using SolidWorks + KeyShot in "technical illustration" mode.
  GEOMETRY: Absolute precision — every line straight, every circle perfect, every thread consistent, every fastener correctly formed.
  MATERIALS: Each material class must be visually unambiguous: steel is cool grey with crisp edge highlights; rubber is dark matte; aluminium is lighter and warmer; brass is gold-toned; chrome has a tight specular band.
  COMPLETENESS: Zero omissions. Every fastener, bearing, seal, spring, and sub-component present and correctly rendered.
  SHADING: Clean 3-zone tonal shading (highlight / mid / shadow) per part; no flat fills on any solid body.
  OUTPUT: Immediately recognisable as professional engineering documentation. Zero artefacts. Zero blur. Zero text artefacts outside permitted annotations.`,
};
```

---

## PATCH 6 — buildEnhancePrompt: add rendering guidance block + update special blend (line ~256)

Inside `buildEnhancePrompt`, after `</MANDATORY_REQUIREMENTS>` and before `<OUTPUT_SPECIFICATION>`, add a new block:

Find this in buildEnhancePrompt:
```ts
</MANDATORY_REQUIREMENTS>

<OUTPUT_SPECIFICATION>
```

Replace with:
```ts
</MANDATORY_REQUIREMENTS>

<RENDERING_TARGET>
The visual quality benchmark for this output is a professional technical illustration as found in a premium OEM service manual or high-quality parts catalogue.

Concretely:
• 3D FORM must be clearly communicated through shading — flat grey fills are not acceptable
• MATERIAL IDENTITY must be unambiguous — metal must look like metal, rubber like rubber
• PRECISION must be absolute — no wobbly lines, no inconsistent radii, no missing features
• PROFESSIONALISM is non-negotiable — the output must look like it was produced by a skilled technical illustrator, not a filter

What this is NOT:
✗ Not a photorealistic 3D render (no HDR, no dramatic shadows, no depth of field)
✗ Not a flat engineering print (no purely monochrome, no absence of shading)
✗ Not a sketch or artistic interpretation

The target aesthetic sits exactly between a precise CAD print and a studio render — technically accurate, visually clear, professionally finished.
</RENDERING_TARGET>

<OUTPUT_SPECIFICATION>
```

Also update the special style blend condition inside the function. Replace:
```ts
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
```

With:
```ts
  config.styles.includes('production') ||
  (config.styles.includes('modern') && config.styles.includes('artistic') && config.styles.includes('realistic'))
    ? `
   SPECIAL BLEND ACTIVE — Production Technical Illustration:
   This combination targets the highest-quality technical illustration output.
   
   HIERARCHY OF PRIORITIES:
   1. Geometric accuracy above all else — perfect lines, perfect circles, exact proportions
   2. Material differentiation — every material class must be visually distinct
   3. 3D form legibility — shading must clearly communicate form, not just decorate
   4. Technical professionalism — the result must be immediately recognisable as engineering documentation
   
   SHADING APPROACH:
   - Use a consistent single light source: upper-left, 30° elevation
   - Each solid face receives one of three tones: highlight (#E5E7EB), mid (#9CA3AF), shadow (#4B5563)
   - Cylindrical/curved surfaces: smooth gradient between highlight and shadow zones
   - Do NOT use ambient occlusion beyond subtle darkening at deep recesses
   
   PROHIBITED in this blend:
   - Photography-style lighting (three-point, HDRI, etc.)
   - Depth of field or focal blur
   - Lens artefacts, bloom, or any post-processing effect
   - Flat grey fills with no shading gradient
   - Any tonal inconsistency between parts of the same material`
    : ""
```

---

## PATCH 7 — MODEL_LABELS in types.ts (line ~near bottom)
Update display labels to reflect current models accurately.

OLD:
```ts
export const MODEL_LABELS: Record<ModelVersion, string> = {
  "gemini-2.5-flash-image":         "Gemini 2.5 Flash  (Fallback)",
  "gemini-2.5-flash":               "Gemini 2.5 Flash  (Fallback)",
};
```

NEW:
```ts
export const MODEL_LABELS: Record<ModelVersion, string> = {
  "gemini-2.5-flash-image": "Gemini 2.5 Flash Image  (Image Generation)",
  "gemini-2.5-flash":       "Gemini 2.5 Flash  (Text / Analysis)",
};
```

---

## PATCH 8 — estimateLatencySeconds in gemini.ts
Update base latency estimates to match actual Vertex AI response times.

OLD:
```ts
  const base: Record<ModelVersion, number> = {
    "gemini-2.5-flash-image":         10,
    "gemini-2.5-flash":               8,
  };
```

NEW:
```ts
  const base: Record<ModelVersion, number> = {
    "gemini-2.5-flash-image": 20,  // image generation is slower than text
    "gemini-2.5-flash":        8,
  };
```
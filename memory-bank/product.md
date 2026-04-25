# Schematic Enhancer — Product Overview

## What this project is

`schematic-enhancer` is a locally hosted AI-assisted schematic and product image workflow application. It combines a React/Vite frontend with a Node.js proxy server to securely connect browser-based workflows to Vertex AI without exposing credentials in the client.

In practice, the app helps users:
- upload schematic images and technical diagrams,
- enhance or regenerate them with purpose-built prompt templates,
- extract hotspots and part labels from schematics,
- correlate schematic pages with legend tables in multi-page PDFs,
- run bulk batch processing over image collections,
- preserve or remove annotation layers depending on the workflow,
- export structured JSON and assets for downstream use.

## Key user-facing capabilities

### 1. Schematic enhancement

The core feature is schematic enhancement. Users can upload a schematic image and generate an improved, production-grade technical illustration in one of several styles such as:
- Modern CAD
- Blueprint
- Patent drawing
- Artistic technical rendering
- Minimalist line art
- Isometric projection
- Vintage engineering drawing
- Realistic CAD-style schematic
- Production illustration
- Hybrid realism

The app also allows users to select:
- aspect ratio (`1:1`, `3:4`, `4:3`, `9:16`, `16:9`, `1:4`, `1:8`, `4:1`, `8:1`, or `auto`)
- image resolution (`512px`, `1K`, `2K`, `4K`)
- model variant (`gemini-2.5-flash-image` and preview image models)
- output quality tier (`standard`, `high`, `maximum`)
- label retention or label removal
- geometry preservation
- detail enhancement
- custom prompt overrides
- optional reference images for material/color guidance

This produces an enhanced image while preserving the schematic’s layout, callouts, and geometry when requested.

### 2. Schematic refinement and image regeneration

The app supports refinement workflows for existing generated schematics and product images. Users can upload an image to refine, apply custom prompts, and regenerate variants while maintaining a history of generated assets.

### 3. Product image regeneration

The `Image Regenerator` workflow is a dedicated product image generator for e-commerce style renders. It can take single images, ZIP archives, or photo assets and produce clean, photorealistic product imagery. Users can choose between a `creative` mode for more stylized outputs and a `clone` mode for tighter geometry preservation.

This workflow is designed for physical product photography generation, not schematic rendering, and includes optional refinement instructions for iterative retouching.

### 4. Hotspot extraction and interactive editing

The app extracts schematic hotspots from diagrams and enables interactive hotspot editing in the UI. Hotspots are represented as normalized bounding boxes and optional polygons, and can be dragged or adjusted in the viewer.

### 4. PDF schematic and legend correlation

One of the advanced workflows is PDF processing. The app converts multi-page PDFs into image pages, classifies pages as `SCHEMATIC`, `LEGEND`, or `OTHER`, and then:
- extracts legend table entries,
- extracts schematic labels and hotspots,
- correlates schematic callouts with legend entries,
- generates a structured export package with JSON metadata.

This is useful for technical documents where diagrams and their part legends are separated across multiple pages.

### 5. Batch processing

The `BatchProcessor` component enables bulk enhancement workflows. Users can upload multiple images, ZIP archives, or PDF files, and the app will process them in sequence. The batch mode supports:
- ZIP unpacking for image archives,
- PDF page-to-image conversion,
- per-item enhancement,
- optional hotspot extraction from enhanced results,
- downloadable ZIP export of enhanced image assets.

### 6. Export and integration support

The app can export structured schematic metadata to JSON and bundle related artifacts into a ZIP file for consumption by other tools. This includes generated image assets, part lists, coordinate placeholders, and source diagram metadata.

## How the product works

### 1. Local frontend and proxy architecture

The repository is organized as a React frontend served by Vite at `http://localhost:3000` and a local Node.js/Express proxy server at `http://127.0.0.1:3001`.

The browser never calls Google directly. Instead, the client communicates with `/api/*` endpoints, and the proxy server authenticates to Vertex AI using a service account supplied through `.env`.

### 2. AI calls and prompt flow

AI operations are delegated to a shared `GoogleGenAI` wrapper in `src/lib/vertex-client.ts`. That wrapper sends requests to the proxy endpoint `/models/generate-content`.

The app defines distinct AI flows for:
- image enhancement and regeneration (`src/lib/gemini.ts`)
- schematic label extraction and PDF classification (`src/lib/schematic-legend-processor.ts`)
- multi-stage schematic extraction (`src/lib/SchematicExtractionSession.ts`)

Each flow uses targeted prompt templates and schema-driven response expectations to keep generated outputs structured and reliable.

### 3. State and workflow orchestration

The top-level application state is managed in `src/App.tsx`. It tracks:
- project objects and current active project
- processing status and UI panel visibility
- selected generated image / hotspot interactions
- UI modals for batch, pipeline, legend processing, and regeneration

Projects encapsulate user input, settings, generated image history, hotspots, and workflow metadata.

## What the product is optimized for

This repository is optimized for local development and experimentation with Vertex AI. It is not intended to be deployed as a static web app without a server proxy because the proxy is required to keep Vertex credentials secure.

## Limitations and operational notes

- The local proxy requires valid `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_API_VERSION`, and `GOOGLE_CREDENTIALS_JSON` values.
- The proxy currently exposes a single Vertex endpoint: `/api/models/generate-content`.
- Requests are rate-limited within the browser to reduce rapid repeated AI calls.
- The current UI is designed for technical workflows, not general-purpose image editing.
- Some dependencies such as `better-sqlite3` and `canvas` are included in `package.json` but are not heavily used in the current application code paths.

## Installation and run instructions

From the repository root:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

The proxy health endpoint is available at `http://127.0.0.1:3001/api/health`.

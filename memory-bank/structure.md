# Codebase Structure and Architecture

This repository is organized into a frontend application, a local backend proxy, and shared utility libraries. The architecture is intentionally split to keep Vertex AI credentials server-side while delivering rich browser-based workflows.

## Top-level layout

- `index.html` — Vite entry HTML for the React app.
- `package.json` — npm package metadata, scripts, and dependencies.
- `tsconfig.json` — TypeScript compiler settings.
- `vite.config.ts` — Vite configuration with React, Tailwind CSS, path aliasing, and proxy rules.
- `README.md` — high-level project documentation and quickstart.
- `.env.example` — sample environment variables for the local Vertex AI proxy.
- `server/index.mjs` — Express.js proxy server for Vertex AI requests.
- `src/` — application source code.
- `memory-bank/` — documentation directory created for this project.

## `src/` folder overview

The `src` folder contains the UI, types, and AI integration libraries.

### Root files

- `src/main.tsx` — application entry point. Mounts the React root and bootstraps the Vite app.
- `src/App.tsx` — the top-level React component and workflow orchestrator.
- `src/index.css` — global CSS styles, likely used for Tailwind and base styling.
- `src/types.ts` — TypeScript domain models, shared interfaces, and application contracts.

### Components

The UI is broken into composable panel and workflow components.

- `src/components/BatchProcessor.tsx`
  - Bulk image workflow interface.
  - Supports uploading images, ZIP archives, and PDFs.
  - Manages per-item enhancement, refinement, approval, and download.
  - Uses `src/lib/gemini.ts` and `src/lib/SchematicExtractionSession.ts` for AI processing.

- `src/components/ImageRegenerator.tsx`
  - Refines or regenerates an existing image using the enhancement pipeline.
  - Allows custom prompt and style overrides for iterative improvement.

- `src/components/SchematicLegendProcessor.tsx`
  - PDF-first processor for extracting legend data and correlating it with schematic pages.
  - Uses classification, label extraction, and legend extraction to build export-ready metadata.
  - Produces structured `batch_schematic_export.zip` artifacts.

- `src/components/SchematicViewer.tsx`
  - Interactive image viewer for schematic pages.
  - Supports zoom, pan, and drag editing for extracted hotspots.
  - Renders hotspot overlays and allows live updates to page metadata.

- `src/components/WorkflowPipeline.tsx`
  - Multi-stage pipeline UI for file upload, configuration, and execution.
  - Handles page classification, optional human-in-the-loop approval, enhancement, and hotspot extraction.
  - Coordinates PDF conversion, legend extraction, and enhancement steps in sequence.

- `src/components/ImageRegenerator.tsx`
  - Dedicated product image regeneration workflow.
  - Processes single images, ZIP archives, and folder uploads.
  - Uses `regenerateImage` and `refineImage` from `src/lib/gemini.ts` to generate photorealistic product-style renders.
  - Supports both creative and clone modes for flexible product photography or exact geometry preservation.

### Libraries and utilities

- `src/lib/gemini.ts`
  - Primary schematic enhancement engine.
  - Encapsulates prompt templates, style descriptors, quality directives, and generation business logic.
  - Controls rate-limiting and text + image prompt construction.
  - Provides core exported helpers like `enhanceSchematic`, `refineSchematic`, `extractHotspots`, `refineHotspots`, and helper types.

- `src/lib/schematic-legend-processor.ts`
  - PDF and schematic analysis AI helpers.
  - Implements page classification, legend extraction, schematic data extraction, and JSON auditing.
  - Defines `ExtractedHotspot`, `LegendEntry`, `CorrelatedData`, and schema-based AI response expectations.

- `src/lib/SchematicExtractionSession.ts`
  - Higher-level extraction pipeline for schematic documents.
  - Orchestrates a multi-stage extraction process with classification, OCR, and validation.
  - Uses system prompts from `src/lib/prompts.ts`.

- `src/lib/vertex-client.ts`
  - Browser-side wrapper for sending AI requests to the local proxy endpoint.
  - Sends JSON payloads to `/api/models/generate-content` and normalizes error handling.

- `src/lib/pdf-utils.ts`
  - Converts PDF files into PNG image data URIs using `pdfjs-dist`.
  - Provides page-by-page conversion and captures original page dimensions.

- `src/lib/coordUtils.ts`
  - Coordinate conversion helpers for translating normalized bounding boxes and points between image space and pixel space.

- `src/lib/HotspotMemoryStore.ts`
  - Memory store abstraction for tracking hotspot state in the application.
  - Helps persist and lookup hotspot metadata during interactive editing.

- `src/lib/hotspotOverlay.ts`
  - Utility for rendering hotspot overlays on images.
  - Likely contains helper logic for visual bounding box generation and drawing.

- `src/lib/prompts.ts`
  - Holds system prompt text used in multi-stage AI extraction workflows.
  - Drives the classification and QA systems for schematic analysis.

### Server side

- `server/index.mjs`
  - Express-based local proxy server.
  - Uses `dotenv` to read environment variables from `.env`.
  - Validates required Vertex configuration values before startup.
  - Creates a `GoogleGenAI` client configured for Vertex AI with service account credentials.
  - Exposes:
    - `GET /api/health` — returns proxy health metadata.
    - `POST /api/models/generate-content` — forwards AI generation request bodies to Vertex and returns normalized outputs.
  - Includes a general error serializer that returns structured error details.

## Detailed component relationships

### `App.tsx`

This file is the central coordinator of the entire application. It manages:
- current project state and project lifecycle
- modal visibility for batch, pipeline, legend processing, and regeneration panels
- file upload handlers for image, PDF, JSON, and reference assets
- hotspot dragging and interactive editing logic
- API key / proxy health validation
- project creation, update, and deletion
- selection of generated images for display

It imports and composes the major workflow components as overlays.

### Workflow flow summary

A typical schematic enhancement flow is:

1. user uploads or selects an image
2. app creates a `Project` object in state
3. app sends the image to the `gemini` enhancement helper
4. `gemini` builds a prompt and calls the local proxy via `vertex-client`
5. the proxy forwards the request to Vertex AI and returns a generated image result
6. `App.tsx` stores the resulting data URI and metadata in the project
7. the user can then view, download, refine, or convert the result

A PDF extraction flow is:

1. user uploads a PDF into `WorkflowPipeline` or `SchematicLegendProcessor`
2. `pdf-utils.ts` renders each page to a canvas and produces image URIs
3. pages are classified as schematic or legend
4. legend tables and part labels are extracted with AI helpers
5. schematic hotspots are extracted and optionally audited against existing JSON
6. correlated data is exported as JSON and ZIP artifacts.

## Build and runtime configuration

### `vite.config.ts`

- Uses `@vitejs/plugin-react` and `@tailwindcss/vite`.
- Supports a path alias `@` pointing to repository root.
- Configures Vite dev server proxy for `/api` to the local Node proxy target.
- Reads `VITE_APP_URL` to set the application base path.
- Allows disabling HMR via `DISABLE_HMR=true`.

### `package.json` scripts

- `npm run dev` — runs both server and client concurrently.
- `npm run dev:server` — runs only the local Node proxy.
- `npm run dev:client` — runs only the Vite frontend.
- `npm run build` — builds the frontend bundle.
- `npm run preview` — previews the built site.
- `npm run lint` — runs `tsc --noEmit` for TypeScript checks.

### Environment configuration

- `GOOGLE_CLOUD_PROJECT` — required GCP project ID.
- `GOOGLE_CLOUD_LOCATION` — Vertex AI location, default `global`.
- `GOOGLE_GENAI_API_VERSION` — Vertex GenAI API version, default `v1beta`.
- `GOOGLE_CREDENTIALS_JSON` — raw service account JSON as a single quoted string.
- `VITE_API_BASE_URL` — optional API proxy prefix, defaults to `/api`.
- `VITE_APP_URL` — frontend base URL.

## Notes on coverage and data flow

### AI request flow

- Browser code uses `src/lib/vertex-client.ts` to avoid importing Vertex SDK in the client.
- The proxy server loads the official `@google/genai` package and authenticates with the service account.
- The client-side `GoogleGenAI` class only performs a fetch to the proxy.

### PDF handling

- PDF pages are rendered entirely in the browser using `pdfjs-dist`.
- `pdf-utils.ts` preserves original dimensions from the PDF and converts pages to PNG with a configurable scale factor.

### Hotspot and coordinate data

- Hotspots are stored as normalized `box_2d` values in `[ymin, xmin, ymax, xmax]` format.
- Coordinate conversion utilities in `coordUtils.ts` map normalized values to pixel positions.
- The UI provides drag handles and event listeners for manual hotspot repositioning.

### Export formats

- `SchematicLegendProcessor` can export a ZIP with:
  - `schematic_data.json`
  - PNG page assets
  - correlated part and coordinate metadata

- `BatchProcessor` can export enhanced image results in ZIP format.

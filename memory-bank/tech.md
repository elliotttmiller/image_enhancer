# Technology Stack and Standards

This project is built on a modern TypeScript + React stack with a lightweight local backend proxy. It is designed to support secure AI workflows with Vertex AI while keeping the browser code simple and client-side only.

## Platform and runtime

- Node.js 20+ — backend proxy runtime and development environment.
- React 19 — frontend component model.
- Vite 6 — build tool and developer server.
- TypeScript 5.8 — static type checking across the codebase.
- ECMAScript modules (`type: module`) — used consistently in Node and browser code.

## Frontend stack

- React + TypeScript for UI components.
- `motion/react` for animated transitions and UI motion.
- `lucide-react` for iconography.
- Tailwind CSS via `@tailwindcss/vite` for styling.
- `pdfjs-dist` for browser-side PDF rendering.
- `file-saver` and `jszip` for download/export functionality.
- `zod` is installed for validation support, although the current codebase uses custom typed interfaces.

## Backend proxy and AI integration

- Express 5 — lightweight local proxy server.
- `dotenv` — loads `.env` values for the local server.
- `@google/genai` — official Google Vertex AI SDK for server-side AI calls.

### API design

- `server/index.mjs` exposes a small, secure API surface:
  - `GET /api/health` — proxy health and configuration metadata.
  - `POST /api/models/generate-content` — forwards AI requests to Vertex AI using server-side credentials.

- The proxy authenticates using a service account supplied through `GOOGLE_CREDENTIALS_JSON`.
- The browser never stores Vertex credentials directly.

### Client-side wrapper

- `src/lib/vertex-client.ts` defines a browser-friendly `GoogleGenAI` class.
- That class sends requests to the proxy endpoint and normalizes error responses.
- This pattern keeps AI request wiring consistent across the client code while isolating server-specific dependencies.

## Core libraries and patterns

### `src/lib/gemini.ts`

This file contains the core prompt engineering and generation logic for schematic enhancement. Key patterns include:
- designating a system role as a highly specific industrial design expert,
- using style descriptors with prompts, weight, and temperature adjustments,
- assembling mandatory output directives for generated images,
- providing output quality presets (`standard`, `high`, `maximum`),
- enforcing label preservation or removal through prompt directives,
- controlling generation complexity with rate limiting and retry semantics.

It also contains the `regenerateImage` and `refineImage` APIs used by the `ImageRegenerator` component. These functions build product-oriented prompts and support both:
  - `creative` mode for stylized product photography,
  - `clone` mode for tighter geometry and product appearance preservation.

### `src/lib/schematic-legend-processor.ts`

This library centralizes schematic analysis flows and implements:
- page classification into `SCHEMATIC`, `LEGEND`, or `OTHER`,
- legend table extraction from PDF pages,
- schematic label extraction and hotspot identification,
- JSON audit/update logic for existing coordinate metadata,
- schema-driven AI calls to keep outputs structured.

### `src/lib/SchematicExtractionSession.ts`

This session class orchestrates a three-stage extraction pipeline:
- stage 2: classification and style metadata collection,
- stage 4: per-crop OCR/extraction,
- stage 6: full-image QA validation.

It demonstrates a multi-pass AI workflow built around incremental validation.

## Dependencies

### Runtime dependencies

- `@google/genai` — Vertex AI SDK used server-side.
- `@tailwindcss/vite` — Tailwind CSS integration for Vite.
- `@vitejs/plugin-react` — React support for Vite.
- `better-sqlite3` — installed dependency with potential persistence use, not heavily used by the current app.
- `canvas` — installed dependency, likely included for image manipulation support in Node or build-time tooling.
- `concurrently` — runs backend and frontend in parallel.
- `dotenv` — environment configuration.
- `express` — local API server.
- `file-saver` — enables browser downloads.
- `jszip` — zip file creation in the browser.
- `lucide-react` — UI icons.
- `motion` — animation and transitions.
- `pdfjs-dist` — PDF page rendering to canvas.
- `react` and `react-dom` — UI framework.
- `vite` — frontend tooling.
- `zod` — runtime validation library.

### Development dependencies

- `@types/file-saver` — TypeScript definitions.
- `@types/node` — Node.js type definitions.
- `@types/react` — React type definitions.
- `autoprefixer` — CSS vendor prefixing for Tailwind.
- `tailwindcss` — utility-first CSS framework.
- `typescript` — language compiler.
- `vite` — dev server and build tool.

## Coding standards and conventions

### TypeScript first

- The codebase uses TypeScript interfaces and type aliases extensively.
- Shared domain definitions are centralized in `src/types.ts`.
- Components and libraries use explicit typed props and return types where appropriate.
- The project uses `tsc --noEmit` for basic type checking.

### Modular architecture

- The project separates UI components from AI helper libraries.
- Shared utilities are placed under `src/lib/`.
- The top-level `App.tsx` handles orchestration, while workflows are delegated to dedicated pipeline components.

### Prompt engineering as code

- Prompts are encoded in `src/lib/gemini.ts` and `src/lib/prompts.ts`.
- Styles and AI instructions are defined as structured descriptors rather than ad hoc text.
- The code uses prompt assembly functions to produce reproducible AI requests.

### Secure credential handling

- Credentials are never imported into the browser bundle.
- `server/index.mjs` reads `GOOGLE_CREDENTIALS_JSON` and constructs `GoogleGenAI` with server-side auth.
- The browser uses a thin fetch wrapper to route requests through the local proxy.

### UI state management

- `App.tsx` uses React hooks (`useState`, `useEffect`, `useCallback`, `useRef`) to manage application state.
- Workflow components maintain their own local state for processing progress, selected files, and UI controls.
- Inter-component communication uses callbacks and prop injection.

### Error handling

- The proxy uses a serializer to return structured errors with status, message, and details.
- Client request code catches non-OK responses and throws normalized errors.
- UI components capture errors and display them to users when AI calls fail.

## Recommended development workflow

1. populate `.env` from `.env.example`
2. install dependencies: `npm install`
3. start the app: `npm run dev`
4. open `http://localhost:3000`
5. verify proxy health: `http://127.0.0.1:3001/api/health`

## Observations and architectural intent

- The architecture is built for experimentation with AI-driven image workflows.
- The project emphasizes a secure proxy design that keeps Vertex credentials out of client bundles.
- The frontend is adaptable to multiple schematic workflows, including enhancement, extraction, correlation, and export.
- The package configuration suggests future extension toward server-side image processing (`canvas`, `better-sqlite3`) though the current core logic remains browser-forward.

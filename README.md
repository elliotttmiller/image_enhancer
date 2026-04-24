# Schematic Enhancer Core Platform

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![React](https://img.shields.io/badge/React-19-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6-yellow.svg)
![Tailwind](https://img.shields.io/badge/TailwindCSS-4-38B2AC.svg)
![Gemini](https://img.shields.io/badge/Gemini-AI-orange.svg)

**Schematic Enhancer** is a production-grade React application designed to intelligently process multi-page PDFs, technical diagrams, and engineering schematics using Google's Gemini AI models. The platform automates the extraction of interactive diagram hotspots, correlates reference legends with parts databases, and utilizes state-of-the-art vision models to synthesize premium 3D commercial renders of technical parts.

---

## ✨ Core Features

1. **Intelligent Hotspot Extraction**
   - Automatically analyzes raw technical diagrams and generates interactive coordinates (`x_pct`, `y_pct`, bounding boxes) for e-commerce or documentation viewers.
   - Maps parsed components to specific standard naming conventions.

2. **Schematic & Legend Correlation**
   - Imports raw reference sheets (JSON/CSV).
   - Uses AI vision to audit parts lists against visual layouts, mapping identified schematic items to physical SKUs.

3. **Premium Image Regenerator (Bulk Processing)**
   - Transforms standard flat technical photos into stunning, cohesive 3D commercial showcase renders.
   - Preserves strict mechanical integrity (hardware, proportions, mounting points) while upgrading lighting, material finish, and professional shadowing.
   - Supports multi-ratio outputs (1:1, 16:9, etc.) for storefront layouts.

4. **PDF Processing Pipeline**
   - Native client-side processing of PDF engineering files.
   - Extracts page-by-page visual data dynamically without requiring backend rasterization.

5. **Integrated Workflow Pipelines**
   - Perform end-to-end processing: Upload -> Extract Parts -> Audit Skus -> Enhance Part Images -> Export (JSON + Batch Zips).

---

## 🛠 Technology Stack

### Frontend & UI
- **React 19**: Modern functional components, hooks, and seamless UI orchestration.
- **Vite 6**: Lightning-fast build tooling and hot module replacement.
- **Tailwind CSS 4**: Utility-first styling for rapid, responsive, and highly-customizable interface design.
- **Framer Motion (`motion/react`)**: Buttery-smooth layout transitions and micro-animations.
- **Lucide React**: Clean, consistent SVG icon system.

### AI & Core Logic
- **`@google/genai`**: Official Google AI Node.js SDK connecting directly to Gemini 2.5 Flash, Gemini Flash Image, and Pro models for vision analysis and generation tasks.
- **Zod**: Type-safe schema validation, crucial for ensuring AI JSON responses match expected interfaces.

### Media & Data Utilities
- **`pdfjs-dist`**: Robust client-side parsing and rendering of PDF schematics into image formats manageable by the AI.
- **`jszip` & `file-saver`**: Utilities for generating bulk download packages natively in the browser.
- **`canvas`**: HTML5 canvas manipulations for coordinate mapping and image extraction.

---

## 🏗 Infrastructure & Deployment

This application operates as a fully client-side Single Page Application (SPA), originally designed to run securely within the **Google AI Studio platform** but ready for enterprise deployments (e.g., Google Cloud Run, Vercel, AWS S3/CloudFront).

- **Execution Environment**: Node.js ecosystem during development, outputting static HTML/JS/CSS.
- **Network**: Client-side API requests to Google AI services. The environment enforces strict CORS and iframe sandbox restrictions.
- **Port Constraints**: Configured specifically to bind to `0.0.0.0:3000` for sandboxed cloud compatibility.
- **State Management**: Ephemeral JSON export/import and React `useState`/`useCallback` for local session data. No complex backend database required for operation; everything happens within the secure browser instance.

---

## 📂 Codebase Architecture

The repository is modularized strictly around feature domains:

\`\`\`text
/
├── package.json           # Dependency management and build scripts
├── vite.config.ts         # Vite bundler configuration
├── metadata.json          # Platform metadata and app definition
└── src/
    ├── App.tsx            # Main Application Shell & Route Controller
    ├── index.css          # Global Tailwind directives
    ├── types.ts           # Global TypeScript interfaces & Enums
    │
    ├── components/
    │   ├── BatchProcessor.tsx             # Logic for bulk image prompt processing
    │   ├── ImageRegenerator.tsx           # UI/Controller for 3D part generation
    │   ├── SchematicLegendProcessor.tsx   # Auditing & mapping SKU tables
    │   ├── SchematicViewer.tsx            # Interactive Hotspot Drawing Canvas
    │   └── WorkflowPipeline.tsx           # Unified End-to-End processing step view
    │
    └── lib/
        ├── gemini.ts                      # Core AI client module & Prompt engineering
        ├── pdf-utils.ts                   # PDF rasterization via pdfjs-dist
        ├── prompts.ts                     # Specialized AI interaction text
        ├── schematic-legend-processor.ts  # Logic for mapping diagrams to tabular data
        ├── hotspotOverlay.ts              # Maths for coordinate remapping
        ├── coordUtils.ts                  # Geometry bounds checking
        └── SchematicExtractionSession.ts  # Complex multi-step vision analysis logic
\`\`\`

### Deep Dive: `gemini.ts`
The crown jewel of the application. It features highly engineered prompt architectures designed to implement "Circuit-Breaker Resilience" and "Geometry Lock". 
It defines rigid constraints so image generation upgrades aesthetics (Premium Commercial Showcase) while maintaining strictly accurate engineering specifications (No hallucinated hardware, exact dimensional matches).

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A Google Cloud Platform (GCP) or AI Studio account with an active **Gemini API Key**.

### Vertex AI authentication (recommended: ADC)

This project uses Vertex / Gemini via server-side calls. The recommended authentication method is Application Default Credentials (ADC). ADC is supported locally (via `gcloud auth application-default login`) and in production via Cloud Run service accounts or Secret Manager.

Windows (PowerShell) — quick ADC setup:

```powershell
powershell -c "iex (irm https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.ps1)"
# Or use gcloud directly:
gcloud auth application-default login
```

Environment variables (supported):
   - `GOOGLE_CLOUD_PROJECT` — your GCP project id (also accepts legacy `VERTEX_PROJECT_ID`)
   - `GOOGLE_CLOUD_LOCATION` — region (e.g., `us-central1` or `global`) (also accepts legacy `VERTEX_LOCATION`)
   - Optionally: `GOOGLE_CREDENTIALS_JSON` — a Service Account JSON string for short-term local testing (NOT recommended for production). If provided, the server will write it to a temporary credentials file and use it via `GOOGLE_APPLICATION_CREDENTIALS`.
   - Optionally: `VITE_GOOGLE_API_KEY` — a Vertex AI API key string for browser build-time config. This repo also accepts `VITE_GOOGLE_CREDENTIALS_JSON` as a legacy alias if it contains a plain API key.
  
   If the frontend is deployed to GitHub Pages, the app cannot host the Vertex proxy backend there. Set `VITE_API_BASE_URL` to the externally hosted backend URL that serves `/vertex/generate`.

Model access note: if your project does not have access to Gemini preview models, use `gemini-2.5-flash-image` for image generation and `gemini-2.5-flash` for image understanding.

Permissions: Grant the Agent Platform User role (`roles/aiplatform.user`) to the service account or user that will call Vertex AI. For production, attach a minimally-privileged service account to your Cloud Run service and avoid embedding service account JSON into the repo or `.env` files.

Note: Do NOT define API keys in the client build. This repo intentionally avoids injecting `GEMINI_API_KEY` into the browser bundle; all AI calls are proxied through the server endpoint `/api/vertex/generate`.

### Installation

1. **Clone the repository** (or download the source):
   \`\`\`bash
   git clone <repository_url>
   cd schematic-enhancer
   \`\`\`

2. **Install Dependencies**:
   \`\`\`bash
   npm install
   \`\`\`

3. **Configure Environment**:
   Create a \`.env\` file in the root directory (refer to \`.env.example\` if present).
    The project uses server-side authentication (recommended: Application Default Credentials - ADC).
    For local development you can run:

    ```powershell
    gcloud auth application-default login
    ```

    Alternatively, set the following environment variables in `.env` for dev-only testing:

    ```env
    GOOGLE_CLOUD_PROJECT=your-project-id
    GOOGLE_CLOUD_LOCATION=us-central1
    # Optional (dev only): GOOGLE_CREDENTIALS_JSON='{"type":"service_account",...}'
    ```
    Do NOT embed API keys into the client bundle; use the server proxy endpoint `/api/vertex/generate` instead.

### Running locally

Start the development server:

\`\`\`bash
npm run dev
\`\`\`
The application will bind to `0.0.0.0` and be accessible at `http://localhost:3000`.

### Building for Production

Compile the project into static assets:

\`\`\`bash
npm run build
\`\`\`
The output will be placed in the `/dist` directory, fully ready to be served by Nginx, Express, or any static file host.

---

## 🛡️ Security & Privacy
Since processing occurs heavily within the client framework, user files are transmitted directly and securely from the browser to the Gemini API, bypassing intermediate backend storage servers. Temporary blob storage and canvas manipulations remain encapsulated within browser memory arrays and are flushed upon closure/reset.

---
*Created by [ComputeUs LLC]*

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

### Browser-side Gemini authentication

This project now runs as a true browser-only SPA. The frontend calls the Gemini Developer API directly using `@google/genai`; there is no backend proxy and no Firebase requirement.

Environment variables:
   - `VITE_GOOGLE_API_KEY` — required Gemini API key exposed to the browser bundle
   - `VITE_GOOGLE_CREDENTIALS_JSON` — optional legacy alias; if set to a plain string, it is treated as the API key
   - `VITE_APP_URL` — optional deploy URL used for GitHub Pages base path calculation

Model access note: if your API key does not have access to preview image models, switch defaults to `gemini-2.5-flash-image` for image generation and `gemini-2.5-flash` for image understanding.

Security note: this architecture intentionally exposes a client key to the browser. Restrict and monitor that key accordingly.

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
    Set the following environment variables:

    ```env
    VITE_GOOGLE_API_KEY=your-gemini-api-key
    VITE_APP_URL=http://localhost:3000/
    ```

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
The output will be placed in the `/dist` directory, ready for GitHub Pages or any other static file host.

---
-
## 🛡️ Security & Privacy
Since processing occurs heavily within the client framework, user files are transmitted directly and securely from the browser to the Gemini API, bypassing intermediate backend storage servers. Temporary blob storage and canvas manipulations remain encapsulated within browser memory arrays and are flushed upon closure/reset.

---
*Created by [ComputeUs LLC]*

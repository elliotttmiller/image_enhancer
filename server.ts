import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { VertexService } from "./src/server/vertexWrapper";

dotenv.config();

// Support legacy or Vite-prefixed env names in local .env files.
// The AI proxy is server-side only, so the runtime needs the standard
// Google Cloud env vars rather than VITE_* names.
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.VITE_GOOGLE_CLOUD_PROJECT;
process.env.GOOGLE_CLOUD_LOCATION ||= process.env.VITE_GOOGLE_CLOUD_LOCATION;
process.env.GOOGLE_CREDENTIALS_JSON ||= process.env.VITE_GOOGLE_CREDENTIALS_JSON;
process.env.GOOGLE_API_KEY ||= process.env.VITE_GOOGLE_API_KEY || process.env.VITE_GOOGLE_CREDENTIALS_JSON;
process.env.APP_URL ||= process.env.VITE_APP_URL;

/**
 * Validates that Vertex AI environment variables are present.
 */
// Vertex client is initialized lazily via VertexService. This avoids early
// crashes during development if environment variables are not yet present.
let vertexService: VertexService | null = null;

// Ensure the server can boot, but lazily initialize the Vertex Client on requests
// so the process doesn't instantly crash if ENV vars are missing during dev startup.

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Increase payload limit for large base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- API ROUTES FOR VERTEX AI DELEGATION ---
  
  app.post("/api/vertex/generate", async (req, res) => {
    try {
      if (!vertexService) {
        // Lazily initialize; constructor validates envs and credentials
        vertexService = new VertexService();
      }

      // Pass the full request body through to the VertexService so it can
      // normalize roles and enforce preferred models. Also log the incoming
      // model lightly for diagnostics.
      console.debug('[Server] /api/vertex/generate incoming model:', req.body?.model);

      const response = await vertexService.generateContent(req.body);

      // Return the normalized response (vertexWrapper ensures `text` exists)
      res.json(response);
    } catch (err: any) {
      console.error("[Vertex API Error]:", err);
      res.status(500).json({ error: err.message || "Failed to generate content via Vertex AI." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Vertex AI Integration Active.`);
  });
}

startServer();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

/**
 * Validates that Vertex AI environment variables are present.
 */
function getVertexClient() {
  const project = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION;
  
  if (!project || !location) {
    throw new Error("Missing VERTEX_PROJECT_ID or VERTEX_LOCATION in environment variables.");
  }

  // AI Studio injects GEMINI_API_KEY into the process.env aggressively.
  // The @google/genai SDK picks it up by default, and sends it to Vertex,
  // which rejects it because Vertex only supports Service Accounts/ADC.
  // We MUST explicitly clear it in the runtime configuration for Vertex.
  if (process.env.GEMINI_API_KEY) {
      delete process.env.GEMINI_API_KEY;
  }

  // If the user provided a Service Account JSON explicitly as an ENV var string, write it to a temp file
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
     const credentialsPath = path.join(process.cwd(), '.temp-google-credentials.json');
     // Write sync is safe here since this initialization only fires on first request 
     // or can be considered an isolated server operation
     fs.writeFileSync(credentialsPath, process.env.GOOGLE_CREDENTIALS_JSON);
     // Point the Google Auth Library to this file
     process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  }

  return new GoogleGenAI({ 
    vertexai: { project, location }
  });
}

// Ensure the server can boot, but lazily initialize the Vertex Client on requests
// so the process doesn't instantly crash if ENV vars are missing during dev startup.

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Increase payload limit for large base64 images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- API ROUTES FOR VERTEX AI DELEGATION ---
  
  app.post("/api/vertex/generate", async (req, res) => {
    try {
      const ai = getVertexClient();
      const { model, contents, config } = req.body;
      
      const response = await ai.models.generateContent({
        model,
        contents,
        config
      });
      
      // We return the raw response, but inject a simulated text field 
      // if it exists so the frontend doesn't break
      res.json({
        ...response,
        text: response.text
      });
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

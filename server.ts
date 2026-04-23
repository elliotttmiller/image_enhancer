import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
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

  // Uses Google Application Credentials by default or VERTEX_API_KEY if GCP provides one
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

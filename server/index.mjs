import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT || "3001", 10);

app.use(express.json({ limit: "50mb" }));

function readEnv(name, fallbackName) {
  return (process.env[name] || (fallbackName ? process.env[fallbackName] : "") || "").trim();
}

function parseCredentials(raw) {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();

  try {
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed);
    }
  } catch {
    throw new Error("GOOGLE_CREDENTIALS_JSON looks like inline JSON but could not be parsed.");
  }

  if (fs.existsSync(trimmed)) {
    return JSON.parse(fs.readFileSync(trimmed, "utf8"));
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.trim().startsWith("{")) {
      return JSON.parse(decoded);
    }
  } catch {
    // Ignore base64 decode errors and fall through to the final message.
  }

  return undefined;
}

const project = readEnv("GOOGLE_CLOUD_PROJECT", "VITE_GOOGLE_CLOUD_PROJECT");
const location = readEnv("GOOGLE_CLOUD_LOCATION", "VITE_GOOGLE_CLOUD_LOCATION") || "global";
const apiVersion = readEnv("GOOGLE_GENAI_API_VERSION") || "v1";
const credentials = parseCredentials(readEnv("GOOGLE_CREDENTIALS_JSON", "VITE_GOOGLE_CREDENTIALS_JSON"));
const authMode = credentials ? "service-account-json" : "application-default-credentials";

if (!project) {
  throw new Error("Missing GOOGLE_CLOUD_PROJECT (or VITE_GOOGLE_CLOUD_PROJECT) for the local Vertex proxy.");
}

const ai = new GoogleGenAI({
  vertexai: true,
  project,
  location,
  apiVersion,
  ...(credentials
    ? {
        googleAuthOptions: {
          credentials,
        },
      }
    : {}),
});

function serializeError(error) {
  const status = typeof error?.status === "number" ? error.status : undefined;
  const message =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : JSON.stringify(error);

  return {
    status,
    message,
    details: error,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "vertex-ai",
    project,
    location,
    apiVersion,
    authMode,
  });
});

app.post("/api/models/generate-content", async (req, res) => {
  try {
    const response = await ai.models.generateContent(req.body);
    res.json({
      text: response.text ?? null,
      candidates: response.candidates ?? [],
      promptFeedback: response.promptFeedback ?? null,
      usageMetadata: response.usageMetadata ?? null,
    });
  } catch (error) {
    const serialized = serializeError(error);
    res.status(serialized.status && serialized.status >= 400 ? serialized.status : 500).json({
      error: serialized,
    });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Vertex proxy listening on http://127.0.0.1:${port} using ${authMode}`);
});

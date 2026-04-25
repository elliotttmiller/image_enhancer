# Schematic Enhancer

React frontend for schematic and product-image workflows, now configured for local development with a Node.js Vertex AI proxy.

## Architecture

- Frontend: Vite + React on `http://localhost:3000`
- Backend: local Express proxy on `http://127.0.0.1:3001`
- AI transport: browser calls `/api/*`, proxy authenticates to Vertex AI with local server-side credentials

The browser no longer talks to Google directly and no Vertex credentials are exposed through `VITE_*`.

## Prerequisites

- Node.js 20+
- A Google Cloud project with Vertex AI enabled
- Either a service account with permission to call Vertex AI or local Application Default Credentials

## Environment

Create `.env` in the repo root. See [.env.example](/d:/AMD/projects/schematic-enhancer/.env.example).

Required variables:

```env
GOOGLE_CLOUD_PROJECT=your-gcp-project
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_API_VERSION=v1
VITE_APP_URL=http://localhost:3000/
```

Optional:

- `GOOGLE_CREDENTIALS_JSON` can be inline service account JSON, a JSON file path, or base64-encoded JSON
- if `GOOGLE_CREDENTIALS_JSON` is omitted or not parseable JSON, the proxy falls back to Application Default Credentials
- `GOOGLE_APPLICATION_CREDENTIALS` can be set in your shell before startup
- `VITE_API_BASE_URL` defaults to `/api`
- `PORT` defaults to `3001` for the local proxy

## Run Locally

Install dependencies:

```bash
npm install
```

Start both the Vertex proxy and the Vite frontend:

```bash
npm run dev
```

If startup succeeds:

- frontend: `http://localhost:3000`
- proxy health: `http://127.0.0.1:3001/api/health`

## Scripts

- `npm run dev` starts the proxy and frontend together
- `npm run dev:server` starts only the local Vertex proxy
- `npm run dev:client` starts only the Vite frontend
- `npm run build` builds the frontend bundle
- `npm run lint` runs `tsc --noEmit`

## Notes

- The GitHub Pages workflow is no longer triggered on push.
- This repo is currently optimized for local development, not static deployment.
- The proxy accepts `generateContent` requests only, which matches the current app usage.

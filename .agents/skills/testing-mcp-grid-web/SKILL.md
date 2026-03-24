# Testing MCP Grid Web Frontend

## Overview
MCP Grid is a TRON-themed AI desktop assistant with a React+Vite+Tailwind web frontend and a Python FastAPI backend. Testing covers the web SaaS UI, vision panel, billing, and command execution.

## Local Setup

### Backend
- Production backend is deployed on Render at a URL stored in the frontend `.env` as `VITE_API_URL`
- For local backend: `python -m uvicorn app.main:app --host 0.0.0.0 --port 1337` from `backend/` directory
- Required env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MCP_JWT_SECRET`, `STRIPE_SECRET_KEY`, `MCP_ADMIN_EMAILS`

### Frontend
- Working directory: `web-frontend/` (may also be symlinked/copied to `~/mcp-grid-web/`)
- Set `VITE_API_URL` in `.env` to point at backend (Render URL or localhost:1337)
- Run: `npm run dev -- --host 0.0.0.0 --port 5173`
- If port 5173 is in use, Vite auto-picks next available port (e.g., 5174)
- Build: `npm run build` (outputs to `dist/`)
- Lint: `npm run lint`

### Electron App
- Directory: `frontend/` (separate from web-frontend)
- Electron vision features (desktopCapturer, overlay, hotkeys) require a display server
- The `node-fetch` package might be missing from `frontend/package.json` — verify before testing

## Testing the Vision Panel

### Web Frontend (Degraded Mode)
The web frontend's Vision panel works in "degraded mode" without the Electron app — it calls the `/vision/*` API endpoints but sends empty image data since it can't capture the screen.

1. Open the app and log in (or use guest mode)
2. Click "Vision" button in sidebar (between Notify and History)
3. Vision panel slides in from the right with:
   - "Vision Assistant" header with cyan Eye icon
   - Analyze button (cyan, filled) and OCR button (outlined)
   - Load History and Clear buttons
   - Empty state: "No observations yet" with hotkey references
   - Note about needing Electron for full screen capture
4. Click Analyze → should show red ERROR card: "No image data provided."
5. Click OCR → should show red ERROR card: "No image data provided."
6. Click Clear → should remove all results and restore empty state
7. Badge count on Vision button updates with result count

### Backend API Endpoints
All 6 vision endpoints can be verified via curl:
```bash
# Analyze (expects base64 image)
curl -X POST $BACKEND_URL/vision/analyze -H 'Content-Type: application/json' -d '{"image":"","prompt":"test"}'
# OCR
curl -X POST $BACKEND_URL/vision/ocr -H 'Content-Type: application/json' -d '{"image":""}'
# Get context memory
curl $BACKEND_URL/vision/context
# Clear context
curl -X DELETE $BACKEND_URL/vision/context
# Set monitoring
curl -X POST $BACKEND_URL/vision/monitoring -H 'Content-Type: application/json' -d '{"enabled":true,"interval":30}'
# Get monitoring status
curl $BACKEND_URL/vision/monitoring
```

### Panel Exclusivity
Only one side panel (Vision, History, Billing) should be visible at a time. Clicking a different panel button should close the current panel and open the new one.

## Common Issues

- **OCR error silently swallowed**: Fixed in commit f1ec037. The OCR handler previously only added results for `status === "success"`, missing the error branch. Now both success and error responses display correctly.
- **Vision context memory is volatile**: The `_vision_memory` deque in `vision.py` is in-memory only, lost on server restart.
- **Vision endpoints have no auth**: All `/vision/*` endpoints are unauthenticated. If exposed publicly, JWT auth should be added.
- **CSS @import warning**: Build produces a PostCSS warning about `@import` ordering in `index.css`. Cosmetic only.
- **Render free tier ephemeral storage**: SQLite database and generated files are lost on redeploy. Not suitable for production with paying users.

## Devin Secrets Needed
- `OPENAI_API_KEY` — For AI-powered commands and vision analysis
- `ANTHROPIC_API_KEY` — Fallback AI provider
- `STRIPE_SECRET_KEY` — For billing/checkout (LIVE mode — real charges)
- `RENDER_API_KEY` — For deploying env vars to Render
- `MCP_JWT_SECRET` — JWT signing secret

# Testing MCP Grid

## Architecture
- **Frontend**: React + Vite + Tailwind SPA, deployed as static site
- **Backend**: Python FastAPI, deployed on Render.com (free tier)
- **Database**: SQLite (ephemeral on Render free tier — resets on redeploy)
- **Billing**: Stripe integration (checkout sessions, customer portal, webhooks)

## Live URLs
- Frontend: Deployed via Devin deploy_frontend command
- Backend: Deployed on Render.com
- Backend health check: `GET /health` should return `{"status": "operational"}`

## Devin Secrets Needed
- `OPENAI_API_KEY` — For AI code generation commands
- `ANTHROPIC_API_KEY` — For Claude AI provider
- Stripe secret key — For billing/checkout (set as `STRIPE_SECRET_KEY` env var on Render)
- Render API key — For triggering deploys and setting env vars via `api.render.com/v1`

## Testing the Billing Panel
1. Navigate to the frontend URL
2. Register or login with a test account
3. Click "Billing" in the sidebar (CreditCard icon, shows FREE/PRO/ENT badge)
4. Verify: "Plans & Billing" header, usage bar (e.g. "0 / 10"), 3 plan cards (Free/Pro/Enterprise)
5. Free card should show "CURRENT" badge for new accounts
6. Pro ($19/mo) and Enterprise ($99/mo) should have "Upgrade to ..." buttons
7. Clicking "Upgrade to Pro" should open `checkout.stripe.com` in a new tab

## Testing Stripe Checkout
- If `STRIPE_SECRET_KEY` is set on the backend, clicking Upgrade opens a real Stripe checkout page
- If NOT set, a system message says "Stripe not configured. Set STRIPE_SECRET_KEY to enable payments."
- **WARNING**: If using live keys (`rk_live_` or `sk_live_`), real charges will occur. Use test keys (`sk_test_`) for safe testing.

## Testing Admin Access Control
- Admin is determined by `MCP_ADMIN_EMAILS` env var (comma-separated emails, case-insensitive)
- Falls back to user ID 1 if env var is not set
- Test admin endpoint: `POST /billing/set-plan?user_id=X&plan=pro` with Bearer token
- Admin should get `{"status":"success"}`, non-admin should get `{"status":"error","message":"Admin access required"}`

## Testing Feature Gating
- Free plan allows: code, search, access, scan, alert, report, analyze, voice, mobile (mapped to `basic_commands` + `code_generation`)
- Pro plan adds: review, test, preview, github, docs, template, files, shell, schedule, notify, clip, db, apitest, plugin, gallery, collab
- Run a Pro-only command (e.g. `review test`) as a free user → should get "requires a pro plan" error
- Run a basic command (e.g. `report`) as any user → should succeed with system data

## Render Deployment
- Render deploys from a specific branch. Ensure the correct branch is selected in Render dashboard.
- Set env vars via Render API: `PUT https://api.render.com/v1/services/{service_id}/env-vars` with Bearer token
- Trigger redeploy: `POST https://api.render.com/v1/services/{service_id}/deploys` (returns 202 with empty body)
- Check deploy status: `GET https://api.render.com/v1/services/{service_id}/deploys?limit=1`
- Build takes ~3-5 minutes on free tier. Status goes: `build_in_progress` → `update_in_progress` → `live`

## Known Issues
- SQLite is ephemeral on Render free tier — user accounts reset on every deploy
- If you can't login to a previously-created account after redeploy, register again
- Stripe webhook signature verification is NOT implemented — `/billing/webhook` processes events without verifying `Stripe-Signature` header
- Rate limiting is in-memory only — resets on server restart
- The `MCP_JWT_SECRET` has an insecure default fallback

## Common Pitfalls
- Higher-tier plans must include ALL lower-tier features in their feature lists (e.g. Pro must include `basic_commands`)
- Render API deploy endpoint returns 202 with empty body (not JSON) — don't try to parse JSON from it
- Frontend must be rebuilt (`npm run build`) before redeploying if code changes
- Backend uses `FRONTEND_URL` env var for Stripe checkout redirect URLs — must be set to the deployed frontend URL
# Testing MCP Grid

## Overview
MCP Grid is a TRON-themed AI assistant with a FastAPI backend and React web frontend. It has 25 command handlers.

## Prerequisites
- Python 3.10+ with poetry
- Node.js 18+ with npm
- API keys for AI features (Anthropic and/or OpenAI)

## Devin Secrets Needed
- `ANTHROPIC_API_KEY` — for Claude-based AI features (code generation, review, docs)
- `OPENAI_API_KEY` — for OpenAI-based AI features (fallback provider)

## Starting the Backend
```bash
cd backend
source .env
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Verify: `curl http://localhost:8000/health` should return `{"status":"operational"}`

## Starting the Frontend
```bash
cd web-frontend  # or wherever the React app lives (may be at ~/mcp-grid-web during dev)
npm install
npm run dev -- --host 0.0.0.0
```
Frontend runs on port 5173 (or next available port like 5174 if 5173 is busy).

## Testing Commands via API
All 25 commands can be tested via:
```bash
curl -s -X POST http://localhost:8000/command \
  -H "Content-Type: application/json" \
  -d '{"command":"<cmd>","args":"<args>"}'
```

Useful test commands:
- `shell list files in /tmp` — runs `ls /tmp`, verifies shell execution
- `voice status` — shows voice config (DISABLED by default)
- `gallery list` — shows generated projects count
- `template list` — shows 6 available templates
- `plugin list` — shows plugins in ~/mcp_plugins/
- `mobile status` — shows mobile access status
- `schedule list` — shows scheduled tasks
- `clip history` — shows clipboard history
- `collab status` — shows collaboration overview
- `review /path` — analyzes code files
- `github status` — shows git status
- `apitest http://localhost:8000` — tests API endpoints

## Testing via Web UI
1. Navigate to frontend URL (e.g., http://localhost:5174)
2. Click "Continue as Guest" (or sign up for auth features)
3. Sidebar shows all 25 commands grouped by category
4. Click a command button to populate the input field
5. Type args and press Enter
6. Response appears in console with colored badges (YOU/MCP/SYS/ERR)

## Auth Testing
- Signup: POST `/auth/signup` with `{username, email, password}`
- Login: POST `/auth/login` with `{email, password}` → returns JWT token
- Authenticated commands: POST `/command/auth` with `Authorization: Bearer <token>`
- Project history only works with authenticated commands

## Common Issues
- Port 5173 may be in use — frontend auto-selects next available port
- Backend .env must be sourced before starting uvicorn (API keys not in environment otherwise)
- Some commands reference optional packages (pyttsx3 for voice TTS, xclip for clipboard) — they degrade gracefully when unavailable
- `preexec_fn` sandbox doesn't work under uvicorn's async workers — falls back to no limits
- The `shell` and `files` commands execute OS commands with no sandboxing — don't expose to untrusted users

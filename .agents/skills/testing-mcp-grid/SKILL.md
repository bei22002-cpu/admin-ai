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
# Testing MCP Grid

## Overview
MCP Grid is a TRON-themed AI desktop assistant with a React+Vite frontend and FastAPI backend. It has 25 commands organized into 5 categories.

## Devin Secrets Needed
- `OPENAI_API_KEY` — For AI-powered commands (code, search, review, docs, test, analyze)
- `ANTHROPIC_API_KEY` — Alternative AI provider (Claude), used as primary with OpenAI fallback
- `STRIPE_SECRET_KEY` — For billing/subscription features
- `RENDER_API_KEY` — For deploying backend updates to Render

## Deployed URLs
- **Frontend**: Deployed via Devin Apps (static site from `web-frontend/dist`)
- **Backend**: Deployed on Render at the URL configured in `.env` (`VITE_API_URL`)
- Backend health check: `GET /health` should return 200

## Local Testing Setup

### Backend
```bash
cd backend/
pip install -r requirements.txt  # or use poetry
export OPENAI_API_KEY=<key>
export ANTHROPIC_API_KEY=<key>
python -m uvicorn app.main:app --host 0.0.0.0 --port 1337
```

### Frontend
```bash
cd web-frontend/
npm install
# Update .env to point VITE_API_URL to backend (localhost:1337 for local, or Render URL)
npm run dev -- --host 0.0.0.0
```

## The 25 Commands
These are the actual backend command names (not display names):

**AI & Code**: `code`, `review`, `test`, `docs`, `preview`, `template`
**Search & Analysis**: `search`, `analyze`, `scan`, `report`
**DevOps & Tools**: `github`, `shell`, `apitest`, `db`
**Productivity**: `files`, `schedule`, `alert`, `notify`, `clip`
**Platform**: `access`, `plugin`, `gallery`, `voice`, `collab`, `mobile`

### Command Name vs Display Name Mapping
The sidebar display names may differ from backend command names:
- "Clipboard" → `clip`
- "Database" → `db`
- "Files" → `files`
- "Tests" → `test`
- "Templates" → `template`
- "Notify" → `notify`
- "API Test" → `apitest`

When clicking sidebar buttons, the frontend correctly maps to backend command names.

## Testing Commands

### Commands that need arguments
Many commands require specific sub-actions. If you pass the wrong action, the error response lists valid actions:
- `db` → schema, query, tables, create, migrate
- `github` → status, log, branch, clone, push, issues, pr
- `files` → organize, stats, cleanup, find
- `clip` → history, get, paste, save, search, clear
- `notify` → send, list, watch, webhook, clear
- `collab` → status, share, invite, activity
- `mobile` → status, enable, disable, config
- `voice` → status, enable, disable, config

### Commands that call AI (slower, need API keys)
- `code <description>` — Generates real code files, saved to `~/mcp_generated/`
- `search <query>` — AI-powered search
- `review <file_path>` — AI code review
- `docs <file_path>` — AI documentation generation
- `test <project_path>` — AI test generation
- `analyze <description>` — Screen/system analysis

### Commands that work without AI
- `report` — System vitals (CPU, RAM, disk)
- `shell <command>` — Execute shell commands
- `files stats` — File system statistics
- `github status` — Git status
- `schedule list` — List scheduled tasks
- `alert <message>` — Create alerts
- `template <name>` — Scaffold projects (fastapi, react, flask, cli, express, dashboard)
- `gallery list` — List generated projects
- `plugin list` — List installed plugins
- `access status` — Check app access
- `scan` — Network scan
- `apitest <method> <url>` — HTTP API testing

## UI Testing Checklist
1. **Auth screen**: Zap logo, glass-card form, Sign In/Register tabs, Continue as Guest
2. **Sidebar**: 5 collapsible categories with correct command counts (6, 4, 4, 5, 6)
3. **Sidebar toggle**: Collapse/expand via header button
4. **Category toggle**: Click category header to collapse/expand commands
5. **Quick command chips**: Bottom bar chips (Code, Search, Report, Review, Shell, GitHub)
6. **Message avatars**: S=cyan (System), U=green (User), M=orange (MCP Grid)
7. **Header bar**: Console v2.0, usage counter, clock
8. **SmartDataView**: Structured panels for objects, tables for arrays, status badges
9. **Code generation**: Should show "Generated Files" section with Download ZIP button
10. **Billing panel**: Accessible from header, shows tier info

## Known Behaviors
- `apitest` may show "Connection refused" on Render due to network restrictions — this is expected on the hosted backend
- `db tables` may show "Database not found: app.db" if the SQLite DB path differs on the deployment (try `/data/app.db` on Render)
- `preview` only works with HTML/CSS/JS projects, not Python-only projects
- `analyze` reports "screen capture unavailable" on headless servers — expected
- AI commands take 5-15 seconds depending on complexity
- The `code` command saves files to `~/mcp_generated/<project_name>/` on the server

## Frontend Build & Deploy
```bash
cd web-frontend/
npm run build  # Creates dist/ folder
# Deploy dist/ as static site
```
Ensure `VITE_API_URL` in `.env` points to the public backend URL before building.

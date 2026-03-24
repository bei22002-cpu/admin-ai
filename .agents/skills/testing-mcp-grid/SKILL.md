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

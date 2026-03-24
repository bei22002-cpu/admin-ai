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
MCP Grid is a TRON-themed AI coding assistant with a FastAPI backend and React (Vite) frontend.

## Devin Secrets Needed
- `OPENAI_API_KEY` - OpenAI API key for code generation
- `ANTHROPIC_API_KEY` - Anthropic API key for Claude code generation
- `RENDER_API_KEY` - Render API key for deployment management
- `STRIPE_SECRET_KEY` - Stripe key for billing features

## Environment Setup

### Backend (Local)
```bash
cd /home/ubuntu/MCP-Grid/backend
pip install fastapi uvicorn openai anthropic bcrypt pyjwt stripe
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export MCP_ADMIN_EMAILS="bei22002@byui.edu,devin@mcpgrid.com"
python -m uvicorn app.main:app --host 0.0.0.0 --port 1337
```

### Frontend (Local)
```bash
cd /home/ubuntu/mcp-grid-web
# Update .env to point to local backend
echo 'VITE_API_URL=http://localhost:1337' > .env
npm run dev -- --host 0.0.0.0
# Frontend runs on http://localhost:5173
```

### Test Accounts
Register via API:
```bash
curl -X POST http://localhost:1337/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"tester","email":"tester@mcpgrid.com","password":"test123"}'
```

## Testing Approach

### API-Level Testing
The most reliable way to test backend features:
```bash
# Get auth token
TOKEN=$(curl -s -X POST http://localhost:1337/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@mcpgrid.com","password":"test123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Run code command
curl -X POST http://localhost:1337/command/auth \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"command":"code","args":"hello world"}'

# Check file endpoints
curl http://localhost:1337/files/projects
curl http://localhost:1337/files/{project_name}
```

### UI Testing via Puppeteer
The browser_console tool may not detect Chrome as foreground. When this happens, use Puppeteer via CDP:

1. Chrome debug port is **29229** (not 9222)
2. Install puppeteer-core: `cd /tmp && npm install puppeteer-core`
3. Connect via: `puppeteer.connect({ browserURL: 'http://127.0.0.1:29229' })`

For React controlled inputs (like the command input), Puppeteer's `page.type()` is more reliable than clicking + typing via computer use tools.

Tab key navigation works for form fields on the login page.

### Key Gotchas

1. **Render Free Tier Ephemeral Storage**: Database and generated files are lost on every redeploy. Re-register accounts after redeploy.
2. **Render Env Vars**: Setting env vars via API does NOT automatically restart the service. You must trigger a manual redeploy after setting env vars.
3. **JWT Secret Reset**: If MCP_JWT_SECRET changes between deploys, all existing tokens become invalid. Users must re-login.
4. **Frontend .env**: Remember to restore `VITE_API_URL` to production URL after local testing.
5. **AI Key Check**: The code command checks `os.getenv('OPENAI_API_KEY')` - if empty or matching placeholder, returns 'no_api_key' error.

## Render Deployment

### Service ID
`srv-d70of57kijhs73a0nsl0`

### Setting Env Vars
```bash
curl -X PUT "https://api.render.com/v1/services/srv-d70of57kijhs73a0nsl0/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '[{"key":"OPENAI_API_KEY","value":"..."}]'
```

### Triggering Redeploy
```bash
curl -X POST "https://api.render.com/v1/services/srv-d70of57kijhs73a0nsl0/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H 'Content-Type: application/json' -d '{}'
```

### Checking Deploy Status
```bash
curl -s "https://api.render.com/v1/services/srv-d70of57kijhs73a0nsl0/deploys?limit=1" \
  -H "Authorization: Bearer $RENDER_API_KEY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['deploy']['status'])"
```
Wait for status to be `live` before testing.

## Live URLs
- Frontend: https://mcp-tray-app-qrjt16oz.devinapps.com
- Backend: https://admin-ai-ok2s.onrender.com
- Admin emails: bei22002@byui.edu, devin@mcpgrid.com

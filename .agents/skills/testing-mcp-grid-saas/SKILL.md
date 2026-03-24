# Testing MCP Grid SaaS Features

## Overview
MCP Grid has a React web frontend (Vite + TypeScript + Tailwind) and a FastAPI backend with JWT auth and SQLite persistence. Testing covers signup, login, code generation, project history, guest mode, and error handling.

## Environment Setup

### Backend
```bash
cd backend
poetry install
# Set API keys in .env (ANTHROPIC_API_KEY and/or OPENAI_API_KEY)
poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd web-frontend  # or mcp-grid-web depending on clone location
npm install
# Ensure .env has VITE_API_URL=http://localhost:8000
npm run dev
```

Frontend runs on http://localhost:5173, backend on http://localhost:8000.

### Fresh Database
To start with a clean database:
1. Stop the backend
2. Delete `backend/mcp_grid.db`
3. Restart the backend (it auto-creates tables via `init_db()` on startup)

**Important**: If you delete the DB while the backend is running, you MUST restart the backend. The running process won't re-initialize the tables automatically.

## Known Issues & Workarounds

### PyJWT `sub` claim must be a string
PyJWT's `jwt.decode()` raises `InvalidSubjectError` if the `sub` claim is an integer. The fix is to use `str(user_id)` when creating tokens and `int(payload["sub"])` when decoding. If auth silently fails (get_current_user returns None, /auth/me returns "Not authenticated", projects never save), check that `sub` is stored as a string in the JWT.

### bcrypt compatibility
passlib 1.7.4 is incompatible with bcrypt >= 4.1. Use the `bcrypt` library directly (`bcrypt.hashpw()` / `bcrypt.checkpw()`) instead of `passlib.hash.bcrypt`.

### browser_console tool may not work
The `browser_console` tool sometimes reports "Chrome is not in the foreground" even when Chrome is visible. Workaround: use the logout button in the UI to clear sessions instead of `localStorage.clear()` via console. Or use `xdotool` to focus Chrome before calling browser_console.

### Subprocess sandboxing disabled under uvicorn
`preexec_fn` in `subprocess.run()` fails in uvicorn's async worker context. Code execution falls back to no resource limits. The `timeout` parameter still provides time-based safety.

## Test Flows

### Auth Flow (Signup → Login → Logout)
1. Navigate to http://localhost:5173
2. Click REGISTER tab → fill username/email/password → click CREATE IDENTITY
3. Console should load with username at bottom-left, HISTORY button visible
4. Click logout icon (arrow at bottom-left) → auth screen returns
5. Login with same credentials → console loads, HISTORY shows previous projects

### Guest Mode
1. From auth screen, click "CONTINUE AS GUEST"
2. Console loads with "GUEST" at bottom-left
3. HISTORY button should NOT be visible
4. Commands still work (try REPORT)

### Code Generation + Project History
1. Login as authenticated user
2. Type "code hello world" → press Enter
3. Wait 2-10 seconds for AI response
4. Verify STATUS=SUCCESS, LANGUAGE=python in response
5. Click HISTORY → project should appear with name, status badge, language, date

### Error Handling
1. Try login with wrong password → "Invalid email or password" error in red
2. Auth screen should remain (no console access)

## Devin Secrets Needed
- `ANTHROPIC_API_KEY` — for Claude-based code generation
- `OPENAI_API_KEY` — for OpenAI-based code generation (fallback provider)
- Neither key is committed to git; they must be set in `backend/.env`

## API Endpoints for Direct Testing
```bash
# Signup
curl -X POST http://localhost:8000/auth/signup -H "Content-Type: application/json" \
  -d '{"username":"tron","email":"tron@grid.com","password":"program1"}'

# Login
curl -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"tron@grid.com","password":"program1"}'

# Verify token works (should return user info, not "Not authenticated")
curl http://localhost:8000/auth/me -H "Authorization: Bearer <token>"

# Run authenticated command
curl -X POST http://localhost:8000/command/auth -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" -d '{"command":"code","args":"hello world"}'

# List projects
curl http://localhost:8000/projects -H "Authorization: Bearer <token>"
```

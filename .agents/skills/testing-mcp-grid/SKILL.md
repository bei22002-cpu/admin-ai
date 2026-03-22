# MCP Grid Testing & Development

## Project Structure
- **Backend**: `mcp-grid/backend/` — Python FastAPI on port 1337
- **Frontend**: `mcp-grid/frontend/` — Electron app with TRON-themed UI
- **Scripts**: `mcp-grid/scripts/` — Cross-platform install/start scripts

## Starting the Backend
```bash
cd mcp-grid/backend
source .env
export OPENAI_API_KEY ANTHROPIC_API_KEY AI_PROVIDER
python -m uvicorn app.main:app --host 0.0.0.0 --port 1337
```

Verify health: `curl http://127.0.0.1:1337/health`

## Starting the Frontend
```bash
cd mcp-grid/frontend
npm install
npx electron .
```

**Important**: Use `127.0.0.1` not `localhost` — Node.js may resolve localhost to IPv6 `::1`, causing ECONNREFUSED.

## AI Provider Configuration
- Set `AI_PROVIDER=openai` or `AI_PROVIDER=anthropic` in `.env`
- OpenAI needs `OPENAI_API_KEY`, Anthropic needs `ANTHROPIC_API_KEY`
- Default provider is `openai` if not set

## Anthropic Model Names (Important!)
Anthropic deprecates model identifiers frequently. As of March 2026:
- Simple/fast: `claude-haiku-4-5-20251001`
- Complex/heavy: `claude-sonnet-4-20250514`
- **Deprecated (return 404)**: `claude-3-haiku-20240307`, `claude-3-5-haiku-20241022`
- If models start returning 404, check https://docs.anthropic.com/en/docs/about-claude/models

## Testing Commands via API
```bash
# Test code generation
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "hello world"}' | python3 -m json.tool

# Test search
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "search", "args": "quantum computing"}' | python3 -m json.tool

# Test report
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "report", "args": "status"}' | python3 -m json.tool
```

## Complexity Detection
- Simple requests: <15 words, no complexity keywords → uses light model (gpt-4o-mini / claude-haiku)
- Complex requests: 50+ trigger keywords ("database", "system", "authentication", etc.) OR >15 words → uses heavy model (gpt-4o / claude-sonnet)
- Complex mode also enables architecture planning, 10 fix attempts, 120s timeout

## Generated Code Location
- All generated code saves to `~/mcp_generated/{project_name}/`
- Memory file: `~/mcp_generated/.mcp_code_memory.json`

## Known Issues
- Complex multi-file projects with Anthropic may have runtime errors (code generates but execution fails)
- Generated code output in Electron UI can be extremely long, making scrolling difficult
- The `_handle_project` fallback path doesn't include `model` or `complex_mode` in response data
- No CI configured on the repo

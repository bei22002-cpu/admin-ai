# Testing MCP Grid Backend

## Setup

1. Navigate to `/home/ubuntu/MCP-Grid/backend`
2. Source the `.env` file: `source .env && export OPENAI_API_KEY ANTHROPIC_API_KEY AI_PROVIDER`
3. Start the backend: `python3 -m uvicorn app.main:app --host 0.0.0.0 --port 1337`
4. Verify health: `curl http://127.0.0.1:1337/health`

## Devin Secrets Needed

- `OPENAI_API_KEY` — Required if `AI_PROVIDER=openai`
- `ANTHROPIC_API_KEY` — Required if `AI_PROVIDER=anthropic`

## Provider Configuration

- Set `AI_PROVIDER=openai` or `AI_PROVIDER=anthropic` in `.env`
- Anthropic models: `claude-sonnet-4-20250514` (complex), `claude-haiku-4-5-20251001` (simple)
- OpenAI models: `gpt-4o` (complex), `gpt-4o-mini` (simple)

## Testing the Code Command

### Simple Request (fast, ~5s)
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "hello world"}' | python3 -m json.tool
```
- Expected: `complex_mode: false`, light model used, no `pipeline` field

### Complex Request — Iterative Pipeline (~10-15 min)
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "a chess game with AI opponent using minimax algorithm"}' \
  > /tmp/result.json
```
- Expected: `complex_mode: true`, heavy model, `pipeline` field with 5 phases, `quality_score` 1-10
- This takes a LONG time (10-15 min) because it makes 15-20+ sequential API calls
- Use a long timeout (600s) for curl

### Key Response Fields to Check
- `data.pipeline` — Should contain "Architecture Planning → Module-by-Module Build → ..."
- `data.quality_score` — Number 1-10 (or "N/A" if review failed)
- `data.complex_mode` — true for complex, false for simple
- `data.model` — Which AI model was used
- `data.files` — List of generated file names
- `data.file_count` — Number of files generated

## Routing Logic

- Project mode triggered by keywords in `_parse_request()`: "project", "app", "game", "system", "dashboard", etc.
- Complex mode triggered by `_is_complex()`: keywords like "database", "game", "algorithm", "chess", etc. OR word count > 15
- If both project AND complex → 5-phase iterative pipeline (`_handle_project`)
- If project but NOT complex → one-shot project generation (`_handle_project_oneshot`)
- If neither → single file generation (`_handle_single_file`)

## Common Issues

- **Port already in use**: Kill existing process with `fuser -k 1337/tcp` before restarting
- **IPv6 resolution**: Always use `127.0.0.1` not `localhost` (Node.js may resolve to IPv6)
- **Anthropic model 404**: Model names change frequently. Check the Anthropic API docs for current model names if you get 404 errors.
- **Phase 4 can break working code**: The self-review improvement pass may introduce errors into previously working files. This is a known limitation.
- **Auto-install installs local modules**: `_extract_imports()` doesn't distinguish local project modules from PyPI packages. It may try to `pip install` local module names.

## Electron Frontend Testing

1. Install frontend deps: `cd frontend && npm install`
2. Start: `npx electron .` (requires backend running)
3. Frontend connects to `http://127.0.0.1:1337`
4. Type commands in the input field (e.g., "MCP code hello world")
5. Sidebar buttons populate the input with command prefixes

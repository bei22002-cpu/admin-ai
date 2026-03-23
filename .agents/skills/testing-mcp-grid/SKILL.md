# Testing MCP Grid Backend

## Overview
MCP Grid is a TRON-themed AI desktop assistant with a FastAPI backend (port 1337) and Electron frontend. The `code` command has a complex iterative pipeline for generating multi-file projects.

## Devin Secrets Needed
- `OPENAI_API_KEY` — OpenAI API key for code generation (if using OpenAI provider)
- `ANTHROPIC_API_KEY` — Anthropic API key for code generation (if using Anthropic provider)

## Backend Setup
1. Navigate to `mcp-grid/backend/`
2. Source the `.env` file and export keys:
   ```bash
   source .env && export OPENAI_API_KEY ANTHROPIC_API_KEY AI_PROVIDER
   ```
3. Start the backend:
   ```bash
   python3 -m uvicorn app.main:app --host 0.0.0.0 --port 1337
   ```
4. Verify health: `curl -s http://127.0.0.1:1337/health`

## Testing the Iterative Pipeline

### Triggering the Pipeline
The iterative pipeline only activates for **complex requests** detected by keyword matching in `_is_complex()`. Use requests containing keywords like "game", "chess", "algorithm", "database", "authentication", etc.

```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -H "Content-Type: application/json" \
  -d '{"command": "code", "args": "a chess game with AI opponent using minimax algorithm"}' \
  --max-time 900 | python3 -m json.tool
```

**Expect**: 5-15 minutes for complex requests. The response will have `data.pipeline` with phase names.

### Key Response Fields to Verify
- `data.complex_mode`: should be `true` for complex requests
- `data.model`: should be the heavy model (e.g., `claude-sonnet-4-20250514` or `gpt-4o`)
- `data.pipeline`: should contain "Parallel Module Build", "Self-Review", "Tests", "Polish & README"
- `data.quality_score`: number 1-10 (or 0 if review failed)
- `data.tests_passed`: boolean (true/false) if Phase 5.5 ran
- `data.file_count`: should be > 3 for multi-file projects

### Simple Request Negative Test
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -H "Content-Type: application/json" \
  -d '{"command": "code", "args": "hello world"}' \
  --max-time 60 | python3 -m json.tool
```
**Expect**: `complex_mode=false`, light model (haiku/gpt-4o-mini), no `pipeline` field, completes in <30s.

### Verifying SSE Streaming (Enhancement #3)
After a pipeline run completes, query the stored events:
```bash
curl -s -X POST http://127.0.0.1:1337/command/stream \
  -H "Content-Type: application/json" \
  -d '{"project_name": "PROJECT_NAME_HERE"}' \
  --max-time 5
```
The project name is derived from the request args (spaces → underscores, truncated). Check the `data.project_dir` path from the pipeline response to find it.

### Verifying Git Integration (Enhancement #8)
```bash
ls -la {project_dir}/.git/
git -C {project_dir} log --oneline
```
**Expect**: 6-7 commits with messages like "Phase 1: Architecture plan", "Phase 2: Built N modules", etc.

### Verifying Local Module Detection (Enhancement #2)
Check `data.deps_installed` in the response. It should NOT contain any of the project's own filenames (e.g., "board", "pieces", "evaluator"). Only real PyPI packages should appear.

## Common Issues

### Anthropic Rate Limits
Anthropic's free/low tier has a rate limit of ~8,000 output tokens per minute. The iterative pipeline makes many sequential API calls and may hit this limit during Phase 2 (parallel builds). When this happens:
- Files get the rate limit error message written as code content instead of actual code
- The `_call_ai` function returns the error string, which gets saved as the module code
- This is a pre-existing error handling gap — `_call_ai` should ideally retry with backoff

**Workaround**: Use OpenAI provider (`AI_PROVIDER=openai`) which has higher rate limits, or wait 1-2 minutes between test runs.

### Port Already in Use
If port 1337 is busy: `fuser -k 1337/tcp` to kill the existing process.

### Backend URL
Always use `127.0.0.1` (not `localhost`) to avoid IPv6 resolution issues.

## Testing via Electron UI
1. Install frontend deps: `cd frontend && npm install`
2. Start frontend: `npx electron .`
3. Type commands in the console input (e.g., "MCP code a chess game with AI opponent")
4. Frontend connects to `http://127.0.0.1:1337`

Note: The Electron UI shows [MCP], [SYS], and [DATA] messages. Complex requests will take several minutes with no progress indicator in the current UI (SSE endpoint exists but frontend doesn't consume it yet).

# Testing MCP Grid Backend

## Backend Setup
1. Navigate to `/home/ubuntu/MCP-Grid/backend/`
2. Create `.env` with `AI_PROVIDER=anthropic` (or `openai`) and the corresponding API key
3. Start: `python -m uvicorn app.main:app --host 127.0.0.1 --port 1337`
4. Verify: `curl http://127.0.0.1:1337/health`

## Testing Code Generation
- Simple request: `curl -X POST http://127.0.0.1:1337/command -H 'Content-Type: application/json' -d '{"command":"code","args":"hello world"}'`
- Complex project: `curl --max-time 600 -X POST http://127.0.0.1:1337/command -H 'Content-Type: application/json' -d '{"command":"code","args":"a calculator app with history"}'`
- Generated files go to `~/mcp_generated/{project_name}/`

## Key Verification Points
- Multi-file projects: check `file_count` >= 5, `pipeline` field present, files in subdirectories
- Single-file: check `file_count` == 1, no `pipeline` or `iteration_history`
- No JSON embedding: `rg '^\{"files":' ~/mcp_generated/project/ --glob '*.py'` should find nothing
- Valid Python: `python3 -c "import py_compile; py_compile.compile('file.py', doraise=True)"`

## Known Issues
- Anthropic free tier rate limit: 8,000 tokens/min. Complex projects (10+ modules) will hit rate limits, causing some files to contain "AI error: max retries exceeded" instead of code. This is expected with low-tier API keys.
- Complex project requests take 5-10+ minutes with Anthropic due to rate limit backoff.
- `preexec_fn` sandboxing doesn't work under uvicorn — falls back to no resource limits.
- Use `--max-time 600` on curl for complex projects to avoid premature timeout.

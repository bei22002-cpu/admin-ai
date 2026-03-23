# Testing MCP Grid Backend

## Environment Setup

1. Install Python dependencies:
   ```bash
   cd backend && pip install -r requirements.txt
   ```

2. Configure `.env` in `backend/` with either:
   - `AI_PROVIDER=openai` + `OPENAI_API_KEY=<key>`
   - `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=<key>`

3. Start the backend:
   ```bash
   cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 1337
   ```

## API Testing

All commands go through `POST http://127.0.0.1:1337/command`:
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "a hello world program"}'
```

### Key Endpoints
- `POST /command` — main command handler (code, search, report, etc.)
- `POST /command/stream` — SSE streaming for real-time progress
- `GET /status` — health check
- `GET /phase` / `POST /phase` — phase management (cosmetic only)

## Testing Each Upgrade

### 1. Multi-Language Support
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -d '{"command": "code", "args": "a javascript hello world program"}'
```
Expect: `data.language == "javascript"`, `data.saved_to` ends with `.js`

### 2. Codebase Awareness
Create a test repo first, then:
```bash
curl -s -X POST http://127.0.0.1:1337/command \
  -d '{"command": "code", "args": "in /tmp/test-repo add unit tests"}'
```
Expect: `data.status == "completed"`, files created in the repo

### 3. Web Research
Test the `_web_research()` function directly via Python or verify indirectly by requesting a framework-specific project.

### 4. Long-Running Iteration
Complex projects trigger the multi-pass pipeline. Use `--max-time 1200` for curl.
Expect: `data.iteration_history` array, `data.total_passes` >= 1

### 5. Rate Limit Retry
Verify via code inspection: `_MAX_RETRIES=5`, `_RETRY_BASE_DELAY=2.0`

### 6. Subprocess Sandboxing
Test directly in Python:
```python
import subprocess, resource
def _set_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (5, 15))
result = subprocess.run(['python3', '-c', 'while True: pass'],
    capture_output=True, text=True, timeout=30, preexec_fn=_set_limits)
print(result.returncode)  # Should be -24 (SIGXCPU)
```

## Known Issues

- **Anthropic rate limits**: Free tier is 8,000 tokens/min. Complex projects take 10+ minutes. Use OpenAI for faster testing.
- **`_emit_progress` in `_handle_repo`**: Was fixed — requires 4 args: `(project_name, phase, detail, progress)`. Watch for this pattern if adding new callers.
- **`preexec_fn` in async context**: `_sandboxed_run` uses `preexec_fn=_set_limits` which may behave differently under uvicorn's async workers vs direct Python.
- **Generated code directory**: All generated code goes to `~/mcp_generated/`. Clean this between test runs.
- **Compiled languages**: Go/Rust/Java/C++ require their compilers installed on the host machine.

## Generated Code Location
- Single files: `~/mcp_generated/<project_name>/main.<ext>`
- Multi-file projects: `~/mcp_generated/<project_name>/` with multiple modules
- Git repos initialized in project dirs (check with `git log`)

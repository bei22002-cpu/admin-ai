# Testing MCP Grid Backend

## Environment Setup

1. Backend runs at `http://127.0.0.1:1337` via uvicorn
2. Start with `--log-level info` to see app-level WARNING+ messages:
   ```bash
   cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 1337 --log-level info
   ```
3. Configure `.env` in `backend/` with:
   - `AI_PROVIDER=anthropic` (or `openai`)
   - `ANTHROPIC_API_KEY=...`
   - `OPENAI_API_KEY=...` (needed for dual-provider failover)

## Important: Logger Levels

- App code uses `logging.getLogger(__name__)` which defaults to WARNING level in uvicorn
- `logger.info()` messages will NOT appear in uvicorn output unless you use `--log-level debug`
- Use `logger.warning()` for messages you need visible during testing
- Rate limit retry messages use `logger.warning()` and ARE visible
- Failover messages also use `logger.warning()` and ARE visible

## Devin Secrets Needed

- `ANTHROPIC_API_KEY` — Anthropic Claude API key for primary provider
- `OPENAI_API_KEY` — OpenAI API key for fallback provider

## Testing via API

### Simple smoke test (should complete in <5s):
```bash
curl -s --max-time 30 -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "hello world"}'
```
Expect: `status=success`, 1 attempt, output contains "Hello"

### Complex multi-file project (5-10 min):
```bash
curl -s --max-time 600 -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "a calculator app with full history and statistics"}'
```
Expect: `file_count >= 8`, multiple subdirectories, `pipeline` field present

### Blog platform (may take 10-15 min, may timeout):
```bash
curl -s --max-time 900 -X POST http://127.0.0.1:1337/command \
  -H 'Content-Type: application/json' \
  -d '{"command": "code", "args": "a blog platform system with posts and comments"}'
```
This request is very heavy and may timeout. Use calculator test instead for faster iteration.

## Validating Generated Files

Generated files are saved to `~/mcp_generated/{project_slug}/`.

```bash
# Count files
find ~/mcp_generated/{project_slug}/ -type f -not -path '*/.git/*' -not -path '*/__pycache__/*' | wc -l

# Check for error files (files containing AI error messages instead of code)
for f in $(find ~/mcp_generated/{project_slug}/ -name '*.py' -not -path '*/__pycache__/*'); do
    if head -1 "$f" | grep -q 'AI error'; then echo "ERROR: $f"; fi
done

# Validate Python syntax
for f in $(find ~/mcp_generated/{project_slug}/ -name '*.py' -not -path '*/__pycache__/*'); do
    python3 -m py_compile "$f" 2>/dev/null || echo "INVALID: $f"
done

# Check for JSON embedding (regression indicator)
grep -rl '^{"file' ~/mcp_generated/{project_slug}/*.py 2>/dev/null
```

## Dual-Provider Failover Testing

The failover triggers when:
1. Primary provider (e.g., Anthropic) exhausts all 5 retries on rate limit (429)
2. `_call_ai()` detects the error string `"AI error: max retries exceeded"`
3. Immediately retries the same request on the fallback provider (e.g., OpenAI)

To verify failover:
- Monitor backend logs for `"Provider anthropic exhausted retries, failing over to openai"`
- Or `"Primary provider in cooldown, routing to openai"`
- The failover may NOT trigger if rate limits aren't hit (depends on API tier)
- Baseline comparison: with single-provider Anthropic, complex projects produced ~5/13 error files. With dual-provider, expect 0 error files.

## Known Issues

- Complex projects (blog platform) may take 10-15 min and can timeout curl
- Anthropic rate limits (8,000 tokens/min on free tier) cause retries with exponential backoff
- Subprocess sandboxing (`preexec_fn`) doesn't work under uvicorn — falls back to no resource limits
- `status: partial` is normal for complex projects — it means the pipeline completed but some files had compilation issues

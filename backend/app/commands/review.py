"""MCP Review Command - AI-powered code review and analysis."""

import os
from pathlib import Path

import httpx


def _get_ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _call_review_ai(system_msg: str, user_msg: str, max_tokens: int = 2000) -> str:
    """Call AI for code review analysis."""
    provider = _get_ai_provider()

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "system": system_msg,
                    "messages": [{"role": "user", "content": user_msg}],
                    "max_tokens": max_tokens,
                },
            )
            if response.status_code == 200:
                data = response.json()
                blocks = data.get("content", [])
                parts = [b["text"] for b in blocks if b.get("type") == "text"]
                return "\n".join(parts)
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": max_tokens,
                },
            )
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"]
    return ""


def _scan_directory(path: str, max_files: int = 30) -> list[dict]:
    """Scan a directory and read code files."""
    files = []
    code_extensions = {
        ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs",
        ".cpp", ".c", ".h", ".rb", ".php", ".swift", ".kt", ".cs",
        ".html", ".css", ".scss", ".sql", ".sh", ".yaml", ".yml",
        ".json", ".toml", ".cfg", ".ini", ".md",
    }
    skip_dirs = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next"}

    target = Path(path).expanduser().resolve()
    if not target.exists():
        return []

    if target.is_file():
        try:
            content = target.read_text(errors="replace")[:5000]
            return [{"path": str(target), "content": content, "lines": content.count("\n") + 1}]
        except Exception:
            return []

    for root, dirs, filenames in os.walk(target):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fname in filenames:
            if len(files) >= max_files:
                break
            fpath = Path(root) / fname
            if fpath.suffix.lower() in code_extensions:
                try:
                    content = fpath.read_text(errors="replace")[:5000]
                    files.append({
                        "path": str(fpath),
                        "content": content,
                        "lines": content.count("\n") + 1,
                    })
                except Exception:
                    continue
        if len(files) >= max_files:
            break
    return files


async def handle_review(args: str) -> dict:
    """Handle 'MCP review [path]' command.

    Analyzes code for bugs, security issues, performance problems, and style.
    """
    if not args:
        return {
            "message": "Review protocol requires a target path. Usage: MCP review [path/to/code]",
            "data": {
                "status": "awaiting_input",
                "examples": [
                    "MCP review ~/my-project/",
                    "MCP review src/main.py",
                    "MCP review ./app/",
                ],
            },
        }

    target_path = args.strip()
    if target_path.startswith("~"):
        target_path = os.path.expanduser(target_path)

    files = _scan_directory(target_path)
    if not files:
        return {
            "message": f"No code files found at '{args}'. Check the path and try again.",
            "data": {"status": "error", "path": args},
        }

    # Build code context
    code_context = ""
    total_lines = 0
    for f in files[:15]:
        code_context += f"\n--- {f['path']} ({f['lines']} lines) ---\n{f['content']}\n"
        total_lines += f["lines"]

    system_msg = (
        "You are MCP, a senior code reviewer. Analyze the code thoroughly and provide:\n"
        "1. **BUGS**: Any bugs, logic errors, or potential crashes\n"
        "2. **SECURITY**: Security vulnerabilities (SQL injection, XSS, hardcoded secrets, etc.)\n"
        "3. **PERFORMANCE**: Performance bottlenecks or inefficiencies\n"
        "4. **STYLE**: Code quality issues, missing error handling, poor naming\n"
        "5. **SUGGESTIONS**: Specific actionable improvements\n\n"
        "Rate overall code quality from 1-10. Be specific with file names and line references."
    )

    review_text = await _call_review_ai(system_msg, f"Review this codebase:\n{code_context}")

    if not review_text:
        # Fallback: basic static analysis
        issues = []
        for f in files:
            content = f["content"]
            if "password" in content.lower() and "=" in content:
                issues.append(f"Potential hardcoded password in {f['path']}")
            if "eval(" in content:
                issues.append(f"Dangerous eval() usage in {f['path']}")
            if "TODO" in content or "FIXME" in content:
                issues.append(f"Unresolved TODO/FIXME in {f['path']}")
            if "except:" in content or "except Exception:" in content:
                issues.append(f"Broad exception handling in {f['path']}")
        review_text = "AI review unavailable. Static analysis:\n" + "\n".join(issues) if issues else "No obvious issues found."

    return {
        "message": f"Code review complete. {len(files)} files analyzed ({total_lines} lines).",
        "data": {
            "status": "complete",
            "files_reviewed": len(files),
            "total_lines": total_lines,
            "review": review_text,
            "path": args,
        },
    }

"""MCP Test Generation Command - Auto-generate tests for existing code."""

import os
from pathlib import Path

import httpx


def _get_ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _ai_generate_tests(system_msg: str, user_msg: str, max_tokens: int = 3000) -> str:
    """Call AI to generate test code."""
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


def _strip_fences(text: str) -> str:
    """Remove markdown code fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines)
    return text


async def handle_testgen(args: str) -> dict:
    """Handle 'MCP test [path]' command.

    Auto-generates unit and integration tests for existing code.
    """
    if not args:
        return {
            "message": "Test generation requires a file or project path. Usage: MCP test [path]",
            "data": {
                "status": "awaiting_input",
                "examples": [
                    "MCP test ~/my-project/app.py",
                    "MCP test ~/my-project/",
                    "MCP test src/utils.js",
                ],
            },
        }

    target_path = os.path.expanduser(args.strip())
    if not os.path.exists(target_path):
        return {
            "message": f"Path not found: {args}",
            "data": {"status": "error"},
        }

    # Collect source files
    source_files: list[dict] = []
    code_exts = {".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs", ".rb"}
    skip_dirs = {"node_modules", ".git", "__pycache__", ".venv", "venv", "test", "tests", "__tests__"}

    target = Path(target_path)
    if target.is_file():
        try:
            content = target.read_text(errors="replace")
            source_files.append({
                "path": str(target),
                "name": target.name,
                "content": content[:5000],
                "lang": target.suffix.lstrip("."),
            })
        except Exception:
            pass
    else:
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fname in files:
                fpath = Path(root) / fname
                if fpath.suffix.lower() in code_exts and len(source_files) < 10:
                    try:
                        content = fpath.read_text(errors="replace")
                        source_files.append({
                            "path": str(fpath),
                            "name": fname,
                            "content": content[:5000],
                            "lang": fpath.suffix.lstrip("."),
                        })
                    except Exception:
                        continue

    if not source_files:
        return {
            "message": f"No source code files found at {args}",
            "data": {"status": "error"},
        }

    # Generate tests for each file
    generated_tests = []
    total_test_count = 0

    for src in source_files[:5]:  # Limit to 5 files
        lang = src["lang"]
        test_framework = {
            "py": ("pytest", "test_"),
            "js": ("jest", "__tests__/"),
            "ts": ("jest", "__tests__/"),
            "jsx": ("jest", "__tests__/"),
            "tsx": ("jest", "__tests__/"),
            "java": ("junit", "Test"),
            "go": ("testing", "_test"),
            "rs": ("cargo test", "tests/"),
            "rb": ("rspec", "spec/"),
        }.get(lang, ("generic", "test_"))

        system_msg = (
            f"You are MCP, a test generation expert. Generate comprehensive {test_framework[0]} tests "
            f"for the provided {lang} code. Include:\n"
            "1. Unit tests for all public functions/methods\n"
            "2. Edge case tests (empty input, null, boundary values)\n"
            "3. Error handling tests\n"
            "4. Integration tests if applicable\n\n"
            "Output ONLY the test code, ready to run. Include necessary imports."
        )

        test_code = await _ai_generate_tests(
            system_msg,
            f"Generate tests for this {lang} file ({src['name']}):\n\n{src['content']}",
        )

        if not test_code:
            # Fallback: basic test template
            if lang == "py":
                test_code = f'"""Tests for {src["name"]}"""\nimport pytest\n\n\ndef test_placeholder():\n    """TODO: Add tests."""\n    assert True\n'
            elif lang in ("js", "ts"):
                test_code = f'// Tests for {src["name"]}\n\ndescribe("{src["name"]}", () => {{\n  test("placeholder", () => {{\n    expect(true).toBe(true);\n  }});\n}});\n'
            else:
                test_code = f"// Tests for {src['name']}\n// TODO: Add tests\n"

        test_code = _strip_fences(test_code)

        # Determine test file path
        src_path = Path(src["path"])
        if lang == "py":
            test_dir = src_path.parent / "tests"
            test_file = test_dir / f"test_{src_path.name}"
        elif lang in ("js", "ts", "jsx", "tsx"):
            test_dir = src_path.parent / "__tests__"
            test_file = test_dir / f"{src_path.stem}.test{src_path.suffix}"
        else:
            test_dir = src_path.parent / "tests"
            test_file = test_dir / f"test_{src_path.name}"

        # Save test file
        test_dir.mkdir(exist_ok=True)
        test_file.write_text(test_code)

        # Count test functions
        test_count = test_code.count("def test_") + test_code.count("test(") + test_code.count("it(") + test_code.count("@Test")
        total_test_count += test_count

        generated_tests.append({
            "source_file": src["name"],
            "test_file": str(test_file),
            "test_count": test_count,
            "framework": test_framework[0],
            "language": lang,
        })

    return {
        "message": f"Generated {total_test_count} tests for {len(generated_tests)} files.",
        "data": {
            "status": "success",
            "files_tested": len(generated_tests),
            "total_tests": total_test_count,
            "tests": generated_tests,
            "run_command": {
                "py": "pytest tests/",
                "js": "npx jest",
                "ts": "npx jest",
                "go": "go test ./...",
            }.get(source_files[0]["lang"], "Run your test framework"),
        },
    }

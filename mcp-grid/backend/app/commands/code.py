"""MCP Code Command - Devin-like agentic AI coding system.

Autonomous code generation with:
- Generate → Execute → Auto-fix loop (up to 5 attempts)
- Auto-install missing dependencies (pip/npm)
- Edit existing files with AI
- Multi-file project scaffolding
- Conversation memory for iterative development
- Smart language detection and proper error diagnosis
"""

import json
import os
import re
import shutil
import subprocess
import textwrap
import time

import httpx

MAX_FIX_ATTEMPTS = 5
OUTPUT_BASE = os.path.join(os.path.expanduser("~"), "mcp_generated")
MEMORY_FILE = os.path.join(OUTPUT_BASE, ".mcp_code_memory.json")


# ─── Conversation Memory ─────────────────────────────────────────


def _load_memory() -> list[dict]:
    """Load conversation memory from disk."""
    try:
        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE) as f:
                data = json.load(f)
            # Keep only last 10 entries
            return data[-10:]
    except (json.JSONDecodeError, OSError):
        pass
    return []


def _save_memory(memory: list[dict]) -> None:
    """Save conversation memory to disk."""
    os.makedirs(OUTPUT_BASE, exist_ok=True)
    with open(MEMORY_FILE, "w") as f:
        json.dump(memory[-10:], f, indent=2)


def _add_to_memory(request: str, filepath: str, language: str, success: bool) -> None:
    """Record a coding session in memory."""
    memory = _load_memory()
    memory.append({
        "timestamp": time.time(),
        "request": request,
        "filepath": filepath,
        "language": language,
        "success": success,
    })
    _save_memory(memory)


# ─── AI Communication ────────────────────────────────────────────


async def _call_ai(
    messages: list[dict], api_key: str, max_tokens: int = 2500
) -> str:
    """Send messages to OpenAI and return the response text."""
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.2,
            },
        )
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"]
        return f"AI error (HTTP {response.status_code}): {response.text[:300]}"


# ─── Code Parsing ────────────────────────────────────────────────


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences from AI output."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines)
    return text


def _detect_language(code: str, request: str) -> tuple[str, str, str]:
    """Detect language from code content.

    Returns (extension, interpreter_command, language_name).
    """
    request_lower = request.lower()
    code_lower = code.lower()

    # Check request hints first
    if any(w in request_lower for w in ["javascript", "node", "react", "express", ".js"]):
        return ".js", "node", "javascript"
    if any(w in request_lower for w in ["typescript", ".ts"]):
        return ".ts", "npx ts-node", "typescript"
    if any(w in request_lower for w in ["html", "webpage", "website"]):
        return ".html", "", "html"
    if any(w in request_lower for w in ["bash", "shell", "script"]):
        return ".sh", "bash", "bash"
    if any(w in request_lower for w in ["css", "stylesheet"]):
        return ".css", "", "css"

    # Detect from code content
    if "import " in code or "def " in code or "class " in code or "print(" in code:
        return ".py", "python3", "python"
    if "function " in code or "const " in code or "require(" in code or "console.log" in code:
        return ".js", "node", "javascript"
    if "<html" in code_lower or "<!doctype" in code_lower:
        return ".html", "", "html"
    if "#!/bin/bash" in code or "#!/bin/sh" in code:
        return ".sh", "bash", "bash"

    return ".py", "python3", "python"


def _extract_imports(code: str, lang: str) -> list[str]:
    """Extract third-party package names from import statements."""
    packages: list[str] = []
    stdlib = {
        "os", "sys", "re", "json", "math", "time", "datetime", "random",
        "collections", "itertools", "functools", "pathlib", "subprocess",
        "typing", "abc", "io", "csv", "hashlib", "hmac", "socket",
        "threading", "multiprocessing", "asyncio", "unittest", "logging",
        "argparse", "shutil", "glob", "tempfile", "textwrap", "string",
        "struct", "copy", "enum", "dataclasses", "contextlib", "operator",
        "statistics", "decimal", "fractions", "array", "queue", "heapq",
        "bisect", "pprint", "traceback", "inspect", "dis", "gc",
        "weakref", "types", "importlib", "pkgutil", "platform",
        "signal", "errno", "ctypes", "sqlite3", "xml", "html",
        "http", "urllib", "email", "mailbox", "mimetypes", "base64",
        "binascii", "codecs", "unicodedata", "locale", "gettext",
        "calendar", "zlib", "gzip", "bz2", "lzma", "zipfile", "tarfile",
        "configparser", "secrets", "uuid",
    }

    if lang == "python":
        for line in code.split("\n"):
            line = line.strip()
            if line.startswith("import "):
                pkg = line.split()[1].split(".")[0]
                if pkg not in stdlib:
                    packages.append(pkg)
            elif line.startswith("from "):
                pkg = line.split()[1].split(".")[0]
                if pkg not in stdlib:
                    packages.append(pkg)
    elif lang == "javascript":
        for match in re.findall(r'require\(["\']([^"\']+)["\']\)', code):
            if not match.startswith("."):
                packages.append(match)
        for match in re.findall(r'from\s+["\']([^"\']+)["\']', code):
            if not match.startswith("."):
                packages.append(match)

    return list(set(packages))


def _parse_multi_file(ai_response: str) -> dict | None:
    """Try to parse AI response as multi-file project structure."""
    try:
        json_match = re.search(r"\{[\s\S]*\"files\"[\s\S]*\}", ai_response)
        if json_match:
            data = json.loads(json_match.group())
            if "files" in data and isinstance(data["files"], list):
                return data
    except (json.JSONDecodeError, AttributeError):
        pass
    return None


# ─── Dependency Management ───────────────────────────────────────


def _auto_install_deps(packages: list[str], lang: str, cwd: str) -> str:
    """Auto-install missing dependencies. Returns install log."""
    if not packages:
        return ""

    # Package name mapping (import name → pip/npm name)
    pip_name_map = {
        "cv2": "opencv-python",
        "PIL": "Pillow",
        "bs4": "beautifulsoup4",
        "sklearn": "scikit-learn",
        "yaml": "pyyaml",
        "dotenv": "python-dotenv",
        "gi": "PyGObject",
        "attr": "attrs",
    }

    install_log: list[str] = []

    if lang == "python":
        for pkg in packages:
            pip_pkg = pip_name_map.get(pkg, pkg)
            try:
                result = subprocess.run(
                    ["pip", "install", pip_pkg],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    cwd=cwd,
                )
                if result.returncode == 0:
                    install_log.append(f"Installed {pip_pkg}")
                else:
                    install_log.append(f"Failed to install {pip_pkg}: {result.stderr[:100]}")
            except Exception as e:
                install_log.append(f"Install error for {pip_pkg}: {e}")

    elif lang == "javascript":
        for pkg in packages:
            try:
                result = subprocess.run(
                    ["npm", "install", pkg],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    cwd=cwd,
                )
                if result.returncode == 0:
                    install_log.append(f"Installed {pkg}")
                else:
                    install_log.append(f"Failed to install {pkg}")
            except Exception as e:
                install_log.append(f"Install error for {pkg}: {e}")

    return "; ".join(install_log)


# ─── File Operations ─────────────────────────────────────────────


def _save_code(code: str, project_name: str, ext: str, filename: str = "") -> str:
    """Save code to a file and return the path."""
    project_dir = os.path.join(OUTPUT_BASE, project_name)
    os.makedirs(project_dir, exist_ok=True)

    if not filename:
        filename = f"main{ext}"

    filepath = os.path.join(project_dir, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, "w") as f:
        f.write(code)

    return filepath


def _save_multi_file_project(project_data: dict, project_name: str) -> tuple[str, str]:
    """Save a multi-file project and return (project_dir, entry_point_path)."""
    project_dir = os.path.join(OUTPUT_BASE, project_name)
    os.makedirs(project_dir, exist_ok=True)

    entry_point = project_data.get("entry_point", "")
    entry_path = ""

    for file_info in project_data["files"]:
        # Sanitize path to prevent traversal
        safe_path = os.path.normpath(file_info["path"]).lstrip("/").lstrip("../")
        filepath = os.path.join(project_dir, safe_path)
        if not filepath.startswith(project_dir):
            continue
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w") as f:
            f.write(file_info["content"])
        if file_info["path"] == entry_point:
            entry_path = filepath

    # Run install command if provided
    install_cmd = project_data.get("install_cmd", "")
    if install_cmd:
        try:
            subprocess.run(
                install_cmd.split(),
                cwd=project_dir,
                capture_output=True,
                timeout=120,
            )
        except Exception:
            pass

    return project_dir, entry_path


# ─── Code Execution ──────────────────────────────────────────────


def _run_code(filepath: str, interpreter: str) -> tuple[bool, str, str]:
    """Execute code and return (success, stdout, stderr)."""
    if not interpreter:
        return True, f"File saved: {filepath}", ""

    try:
        cmd = (
            [interpreter, filepath]
            if " " not in interpreter
            else interpreter.split() + [filepath]
        )
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(filepath),
        )
        stdout = result.stdout[:3000] if result.stdout else ""
        stderr = result.stderr[:3000] if result.stderr else ""
        success = result.returncode == 0
        return success, stdout, stderr
    except subprocess.TimeoutExpired:
        return False, "", "Execution timed out (30s limit)."
    except FileNotFoundError:
        return False, "", f"Interpreter not found: {interpreter}"
    except Exception as e:
        return False, "", f"Execution error: {e}"


# ─── System Prompts ──────────────────────────────────────────────

SYSTEM_PROMPT_SINGLE = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer (TRON-themed).
    You write production-grade, clean, RUNNABLE code like a senior developer.

    Coding standards:
    - Return ONLY the code. No markdown fences, no prose before/after.
    - Code MUST be complete and self-contained — runs without modifications.
    - Include ALL necessary imports at the top.
    - Use proper error handling (try/except, input validation).
    - Add type hints for function parameters and return values.
    - Add docstrings to classes and important functions.
    - Include a main execution block that DEMONSTRATES the code working.
    - Use descriptive variable names, not single letters.
    - Follow PEP 8 (Python) or standard style guides.
    - If the request is vague, build something impressive and functional.
    - Prefer standard library over third-party packages when possible.
    - Structure code with classes and functions, not loose scripts.
    - NEVER use input() or any interactive stdin prompts. The code runs headlessly.
    - Instead of interactive input, use hardcoded demo values or command-line args.
    - The main block must produce visible console output to prove it works.\
""")

SYSTEM_PROMPT_FIX = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer.
    The code you previously generated had errors when executed.

    Debugging approach:
    - Analyze the FULL error traceback carefully.
    - Identify the root cause, not just the symptom.
    - If a module is missing, rewrite to avoid it OR use only stdlib.
    - If it's a logic error, fix the logic.
    - If it's a runtime error, add proper error handling.
    - Return ONLY the complete fixed code. No markdown fences, no explanations.
    - The code must be COMPLETE — don't return partial snippets.
    - Fix ALL errors, not just the first one.
    - Keep the original functionality intact.
    - Make sure the fixed code actually runs and produces output.
    - NEVER use input() or interactive stdin. Use hardcoded demo values instead.
    - The code runs headlessly — no user interaction is possible.\
""")

SYSTEM_PROMPT_EDIT = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer.
    You are editing an existing file. The user wants specific modifications.

    Rules:
    - Return the COMPLETE modified file content.
    - No markdown fences, no explanations.
    - Preserve existing functionality unless told to change it.
    - Add proper imports for any new features.
    - Maintain the existing code style and conventions.
    - Make sure the modified code still runs.\
""")

SYSTEM_PROMPT_PROJECT = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer (TRON-themed).
    Generate a professional multi-file project structure.

    Return a JSON object with this EXACT format (no other text):
    {
        "files": [
            {"path": "main.py", "content": "full file content here"},
            {"path": "utils.py", "content": "full file content here"},
            {"path": "requirements.txt", "content": "package1\\npackage2"}
        ],
        "entry_point": "main.py",
        "install_cmd": "pip install -r requirements.txt"
    }

    Project standards:
    - Separate concerns into multiple files (models, utils, main, config).
    - Include a requirements.txt or package.json with dependencies.
    - Entry point must demonstrate the project working with example usage.
    - Every file must have complete, runnable content.
    - Include proper imports between project files (relative imports).
    - Add docstrings and type hints.
    - Include error handling.
    - Return ONLY the JSON object, nothing else.\
""")


# ─── Request Parsing ─────────────────────────────────────────────


def _parse_request(args: str) -> dict:
    """Parse the user request to determine intent.

    Supports:
    - "edit <filepath> <instructions>" — edit an existing file
    - "fix <filepath>" — fix errors in an existing file
    - "add tests for the last thing" — use memory
    - "a todo list app" — multi-file project
    - "fibonacci generator" — single file
    """
    args_lower = args.lower().strip()

    # Edit existing file: "edit /path/to/file.py add logging"
    if args_lower.startswith("edit "):
        parts = args[5:].strip().split(" ", 1)
        if len(parts) >= 2:
            filepath = parts[0]
            instructions = parts[1]
            if os.path.exists(filepath):
                return {"mode": "edit", "filepath": filepath, "instructions": instructions}
            # Check in mcp_generated
            gen_path = os.path.join(OUTPUT_BASE, filepath)
            if os.path.exists(gen_path):
                return {"mode": "edit", "filepath": gen_path, "instructions": instructions}

    # Fix existing file: "fix /path/to/file.py"
    if args_lower.startswith("fix "):
        filepath = args[4:].strip()
        if os.path.exists(filepath):
            return {"mode": "fix", "filepath": filepath}
        gen_path = os.path.join(OUTPUT_BASE, filepath)
        if os.path.exists(gen_path):
            return {"mode": "fix", "filepath": gen_path}

    # Memory-based requests
    if any(phrase in args_lower for phrase in ["last thing", "previous", "that code", "last code"]):
        memory = _load_memory()
        if memory:
            last = memory[-1]
            return {
                "mode": "followup",
                "previous": last,
                "instructions": args,
            }

    # Multi-file project detection
    is_project = any(
        w in args_lower
        for w in [
            "project", "app", "application", "website", "api", "full",
            "scaffold", "with multiple files", "full stack", "backend",
            "frontend", "dashboard",
        ]
    )
    if is_project:
        return {"mode": "project", "description": args}

    # Default: single file generation
    return {"mode": "single", "description": args}


# ─── Main Handler ────────────────────────────────────────────────


async def handle_code(args: str) -> dict:
    """Handle 'MCP code [thing]' command.

    Devin-like agentic coding: generates, runs, auto-fixes, edits, remembers.
    """
    if not args:
        return {
            "message": (
                "Code protocol requires a target. Examples:\n"
                "  MCP code a calculator\n"
                "  MCP code a flask REST API app\n"
                "  MCP code edit main.py add authentication\n"
                "  MCP code fix main.py\n"
                "  MCP code add tests for the last thing"
            ),
            "data": {"status": "awaiting_input"},
        }

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key or api_key == "your-openai-api-key-here":
        return {
            "message": "AI not configured. Set OPENAI_API_KEY in .env for agentic coding.",
            "data": {"status": "no_api_key"},
        }

    has_vscode = shutil.which("code") is not None
    request = _parse_request(args)

    try:
        if request["mode"] == "edit":
            return await _handle_edit(request, api_key, has_vscode)
        elif request["mode"] == "fix":
            return await _handle_fix_existing(request, api_key, has_vscode)
        elif request["mode"] == "followup":
            return await _handle_followup(request, api_key, has_vscode)
        elif request["mode"] == "project":
            project_name = re.sub(r"[^a-z0-9_]", "_", args.lower())[:40]
            return await _handle_project(args, api_key, project_name, has_vscode)
        else:
            project_name = re.sub(r"[^a-z0-9_]", "_", args.lower())[:40]
            return await _handle_single_file(args, api_key, project_name, has_vscode)
    except Exception as e:
        return {
            "message": f"Agentic coding failed: {e}",
            "data": {"request": args, "status": "error"},
        }


# ─── Edit Existing File ──────────────────────────────────────────


async def _handle_edit(request: dict, api_key: str, has_vscode: bool) -> dict:
    """Edit an existing file using AI."""
    filepath = request["filepath"]
    instructions = request["instructions"]

    with open(filepath) as f:
        existing_code = f.read()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_EDIT},
        {"role": "user", "content": (
            f"Here is the existing file ({filepath}):\n\n"
            f"```\n{existing_code}\n```\n\n"
            f"Modifications requested: {instructions}\n\n"
            f"Return the COMPLETE modified file."
        )},
    ]

    raw_response = await _call_ai(messages, api_key, max_tokens=3000)
    new_code = _strip_markdown_fences(raw_response)

    # Save edited file
    with open(filepath, "w") as f:
        f.write(new_code)

    # Detect and run
    ext, interpreter, lang = _detect_language(new_code, filepath)
    success, stdout, stderr = _run_code(filepath, interpreter)

    # Auto-fix if edit broke something
    if not success:
        fix_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_FIX},
            {"role": "user", "content": (
                f"Edit request: {instructions}\n\n"
                f"Modified code that failed:\n```\n{new_code}\n```\n\n"
                f"Error:\n```\n{stderr}\n```\n\n"
                f"Fix the code."
            )},
        ]
        raw_fix = await _call_ai(fix_messages, api_key)
        new_code = _strip_markdown_fences(raw_fix)
        with open(filepath, "w") as f:
            f.write(new_code)
        success, stdout, stderr = _run_code(filepath, interpreter)

    _add_to_memory(f"edit: {instructions}", filepath, lang, success)

    if has_vscode:
        try:
            subprocess.Popen(["code", filepath], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    return {
        "message": (
            f"File edited: {filepath}. "
            f"{'Runs successfully.' if success else 'Has errors — check output.'}"
        ),
        "data": {
            "request": f"edit {filepath}: {instructions}",
            "status": "success" if success else "partial",
            "language": lang,
            "saved_to": filepath,
            "output": stdout[:1000] if stdout else "",
            "error": stderr[:500] if stderr and not success else "",
        },
    }


# ─── Fix Existing File ───────────────────────────────────────────


async def _handle_fix_existing(request: dict, api_key: str, has_vscode: bool) -> dict:
    """Fix errors in an existing file."""
    filepath = request["filepath"]

    with open(filepath) as f:
        existing_code = f.read()

    ext, interpreter, lang = _detect_language(existing_code, filepath)

    # Run it first to get the actual error
    success, stdout, stderr = _run_code(filepath, interpreter)

    if success:
        return {
            "message": f"File already runs without errors: {filepath}",
            "data": {
                "status": "success",
                "saved_to": filepath,
                "output": stdout[:1000],
            },
        }

    # Fix loop
    code = existing_code
    attempt = 0
    while not success and attempt < MAX_FIX_ATTEMPTS:
        attempt += 1
        fix_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_FIX},
            {"role": "user", "content": (
                f"File: {filepath}\n\n"
                f"Code with errors:\n```\n{code}\n```\n\n"
                f"Error output:\n```\n{stderr}\n```\n\n"
                f"Fix ALL errors."
            )},
        ]
        raw_fix = await _call_ai(fix_messages, api_key)
        code = _strip_markdown_fences(raw_fix)

        with open(filepath, "w") as f:
            f.write(code)
        success, stdout, stderr = _run_code(filepath, interpreter)

    _add_to_memory(f"fix: {filepath}", filepath, lang, success)

    return {
        "message": (
            f"Fix {'complete' if success else 'attempted'} for {filepath}. "
            f"{attempt} attempt(s)."
        ),
        "data": {
            "status": "success" if success else "partial",
            "saved_to": filepath,
            "attempts": attempt,
            "output": stdout[:1000] if stdout else "",
            "error": stderr[:500] if stderr and not success else "",
        },
    }


# ─── Follow-up (Memory) ──────────────────────────────────────────


async def _handle_followup(request: dict, api_key: str, has_vscode: bool) -> dict:
    """Handle requests that reference previous coding sessions."""
    previous = request["previous"]
    instructions = request["instructions"]
    prev_filepath = previous["filepath"]

    if not os.path.exists(prev_filepath):
        return {
            "message": f"Previous file not found: {prev_filepath}",
            "data": {"status": "error"},
        }

    # If previous filepath is a directory (multi-file project), find the entry point
    if os.path.isdir(prev_filepath):
        entry_candidates = ["main.py", "app.py", "index.py", "index.js", "main.js"]
        entry_file = None
        for candidate in entry_candidates:
            candidate_path = os.path.join(prev_filepath, candidate)
            if os.path.exists(candidate_path):
                entry_file = candidate_path
                break
        if not entry_file:
            # Fall back to first .py or .js file found
            for fname in sorted(os.listdir(prev_filepath)):
                if fname.endswith((".py", ".js", ".ts")) and not fname.startswith("test"):
                    entry_file = os.path.join(prev_filepath, fname)
                    break
        if not entry_file:
            return {
                "message": f"No source files found in previous project: {prev_filepath}",
                "data": {"status": "error"},
            }
        prev_filepath = entry_file

    with open(prev_filepath) as f:
        existing_code = f.read()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_EDIT},
        {"role": "user", "content": (
            f"Previous request was: {previous['request']}\n"
            f"Previous file ({prev_filepath}):\n\n"
            f"```\n{existing_code}\n```\n\n"
            f"New request: {instructions}\n\n"
            f"If this requires a new file, return the new file content.\n"
            f"If this modifies the existing file, return the complete modified file."
        )},
    ]

    raw_response = await _call_ai(messages, api_key, max_tokens=3000)
    new_code = _strip_markdown_fences(raw_response)

    ext, interpreter, lang = _detect_language(new_code, instructions)

    # Determine if it's a new file or edit
    if "test" in instructions.lower() or "spec" in instructions.lower():
        # Tests go in a separate file
        test_dir = os.path.dirname(prev_filepath)
        test_file = os.path.join(test_dir, f"test_main{ext}")
        filepath = test_file
    else:
        filepath = prev_filepath

    with open(filepath, "w") as f:
        f.write(new_code)

    # Install deps and run
    packages = _extract_imports(new_code, lang)
    install_log = _auto_install_deps(packages, lang, os.path.dirname(filepath))
    success, stdout, stderr = _run_code(filepath, interpreter)

    if not success and "ModuleNotFoundError" in stderr:
        # Extract module name and try installing
        mod_match = re.search(r"No module named '(\w+)'", stderr)
        if mod_match:
            _auto_install_deps([mod_match.group(1)], lang, os.path.dirname(filepath))
            success, stdout, stderr = _run_code(filepath, interpreter)

    _add_to_memory(instructions, filepath, lang, success)

    return {
        "message": (
            f"Follow-up for: {instructions}. "
            f"{'Runs successfully.' if success else 'Has errors.'} "
            f"Saved to {filepath}"
        ),
        "data": {
            "request": instructions,
            "status": "success" if success else "partial",
            "language": lang,
            "saved_to": filepath,
            "previous_file": prev_filepath,
            "output": stdout[:1000] if stdout else "",
            "error": stderr[:500] if stderr and not success else "",
            "deps_installed": install_log,
        },
    }


# ─── Single File Generation ──────────────────────────────────────


async def _handle_single_file(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
) -> dict:
    """Generate a single file, run it, auto-install deps, and auto-fix errors."""
    # Build context from memory
    memory = _load_memory()
    context = ""
    if memory:
        recent = memory[-3:]
        context = "\n".join(
            f"- Previously built: {m['request']} ({m['language']}, {'success' if m['success'] else 'had errors'})"
            for m in recent
        )
        context = f"\n\nRecent coding history:\n{context}\n"

    # Step 1: Generate initial code
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_SINGLE},
        {"role": "user", "content": f"Generate code for: {args}{context}"},
    ]

    raw_code = await _call_ai(messages, api_key)
    code = _strip_markdown_fences(raw_code)
    ext, interpreter, lang = _detect_language(code, args)

    # Step 2: Auto-install dependencies
    packages = _extract_imports(code, lang)
    filepath = _save_code(code, project_name, ext)
    install_log = _auto_install_deps(packages, lang, os.path.dirname(filepath))

    # Step 3: Run
    success, stdout, stderr = _run_code(filepath, interpreter)

    # Step 4: Smart auto-fix loop
    attempt = 1
    while not success and attempt < MAX_FIX_ATTEMPTS:
        attempt += 1

        # Check if it's a missing module error
        if "ModuleNotFoundError" in stderr or "Cannot find module" in stderr:
            mod_match = re.search(r"No module named '(\w+)'", stderr)
            if mod_match:
                dep_log = _auto_install_deps([mod_match.group(1)], lang, os.path.dirname(filepath))
                if dep_log:
                    install_log += "; " + dep_log if install_log else dep_log
                success, stdout, stderr = _run_code(filepath, interpreter)
                if success:
                    break

        # AI fix with full context
        fix_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_FIX},
            {"role": "user", "content": (
                f"Original request: {args}\n\n"
                f"Code that failed:\n```\n{code}\n```\n\n"
                f"Error output:\n```\n{stderr}\n```\n\n"
                f"Python version: 3.12\n"
                f"Installed packages were auto-installed: {install_log or 'none'}\n\n"
                f"Fix this code so it runs without errors. "
                f"Prefer standard library over third-party packages."
            )},
        ]

        raw_fix = await _call_ai(fix_messages, api_key)
        code = _strip_markdown_fences(raw_fix)

        # Check for new deps in fixed code
        new_packages = _extract_imports(code, lang)
        new_deps = [p for p in new_packages if p not in packages]
        if new_deps:
            dep_log = _auto_install_deps(new_deps, lang, os.path.dirname(filepath))
            if dep_log:
                install_log += "; " + dep_log if install_log else dep_log
            packages.extend(new_deps)

        filepath = _save_code(code, project_name, ext)
        success, stdout, stderr = _run_code(filepath, interpreter)

    # Record in memory
    _add_to_memory(args, filepath, lang, success)

    # Open in VSCode
    if has_vscode:
        try:
            subprocess.Popen(["code", filepath], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    if success:
        msg = (
            f"Code assimilated for: {args}. "
            f"Compiled successfully in {attempt} attempt(s). "
            f"Saved to {filepath}"
        )
    else:
        msg = (
            f"Code generated for: {args}. "
            f"Warning: execution had errors after {attempt} attempts. "
            f"Saved to {filepath}"
        )

    return {
        "message": msg,
        "data": {
            "request": args,
            "status": "success" if success else "partial",
            "language": lang,
            "saved_to": filepath,
            "attempts": attempt,
            "output": stdout[:1000] if stdout else "",
            "final_error": stderr[:500] if stderr and not success else "",
            "generated_code": code,
            "deps_installed": install_log,
        },
    }


# ─── Multi-File Project ──────────────────────────────────────────


async def _handle_project(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
) -> dict:
    """Generate a multi-file project."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_PROJECT},
        {"role": "user", "content": f"Generate a project for: {args}"},
    ]

    raw_response = await _call_ai(messages, api_key, max_tokens=4000)
    project_data = _parse_multi_file(raw_response)

    if not project_data:
        # Fallback: treat as single file
        code = _strip_markdown_fences(raw_response)
        ext, interpreter, lang = _detect_language(code, args)
        filepath = _save_code(code, project_name, ext)
        packages = _extract_imports(code, lang)
        install_log = _auto_install_deps(packages, lang, os.path.dirname(filepath))
        success, stdout, stderr = _run_code(filepath, interpreter)

        _add_to_memory(args, filepath, lang, success)

        return {
            "message": (
                f"Project scaffolding for: {args}. "
                f"Generated as single file. Saved to {filepath}"
            ),
            "data": {
                "request": args,
                "status": "success" if success else "partial",
                "language": lang,
                "saved_to": filepath,
                "output": stdout[:500] if stdout else "",
                "error": stderr[:500] if stderr else "",
                "deps_installed": install_log,
                "generated_code": code,
            },
        }

    # Save multi-file project
    project_dir, entry_path = _save_multi_file_project(project_data, project_name)
    file_list = [f["path"] for f in project_data["files"]]

    # Try to run the entry point
    output = ""
    error = ""
    run_success = False
    lang = "python"

    if entry_path:
        with open(entry_path) as f:
            entry_code = f.read()
        ext, interpreter, lang = _detect_language(entry_code, args)

        # Auto-install deps from entry point
        packages = _extract_imports(entry_code, lang)
        _auto_install_deps(packages, lang, project_dir)

        run_success, output, error = _run_code(entry_path, interpreter)

        # Auto-fix entry point if it fails (up to 3 times)
        fix_attempt = 0
        while not run_success and fix_attempt < 3:
            fix_attempt += 1

            # Try installing missing module first
            if "ModuleNotFoundError" in error:
                mod_match = re.search(r"No module named '(\w+)'", error)
                if mod_match:
                    _auto_install_deps([mod_match.group(1)], lang, project_dir)
                    run_success, output, error = _run_code(entry_path, interpreter)
                    if run_success:
                        break

            with open(entry_path) as f:
                current_code = f.read()

            fix_messages = [
                {"role": "system", "content": SYSTEM_PROMPT_FIX},
                {"role": "user", "content": (
                    f"Project: {args}\n"
                    f"Files in project: {file_list}\n\n"
                    f"Entry point code that failed:\n```\n{current_code}\n```\n\n"
                    f"Error:\n```\n{error}\n```\n\n"
                    f"Fix the code. It's part of a multi-file project in {project_dir}."
                )},
            ]
            raw_fix = await _call_ai(fix_messages, api_key)
            fixed_code = _strip_markdown_fences(raw_fix)
            with open(entry_path, "w") as f:
                f.write(fixed_code)
            run_success, output, error = _run_code(entry_path, interpreter)

    _add_to_memory(args, project_dir, lang, run_success)

    # Open project in VSCode
    if has_vscode:
        try:
            subprocess.Popen(["code", project_dir], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    return {
        "message": (
            f"Project assimilated: {args}. "
            f"{len(file_list)} files generated in {project_dir}."
        ),
        "data": {
            "request": args,
            "status": "success" if run_success else "partial",
            "project_dir": project_dir,
            "files": file_list,
            "file_count": len(file_list),
            "entry_point": project_data.get("entry_point", ""),
            "output": output[:500] if output else "",
            "error": error[:500] if error else "",
        },
    }

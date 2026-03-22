"""MCP Code Command - Agentic AI coding system.

Generates code, saves to files, executes, auto-fixes errors,
and supports multi-file project scaffolding.
"""

import json
import os
import re
import shutil
import subprocess
import textwrap

import httpx

MAX_FIX_ATTEMPTS = 3
OUTPUT_BASE = os.path.join(os.path.expanduser("~"), "mcp_generated")

# ─── AI Communication ────────────────────────────────────────────


async def _call_ai(
    messages: list[dict], api_key: str, max_tokens: int = 2000
) -> str:
    """Send messages to OpenAI and return the response text."""
    async with httpx.AsyncClient(timeout=60.0) as client:
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
            },
        )
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"]
        return f"AI error (HTTP {response.status_code}): {response.text[:200]}"


# ─── Code Parsing ────────────────────────────────────────────────


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences from AI output."""
    text = text.strip()
    # Handle ```language ... ``` blocks
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove opening fence line
        lines = lines[1:]
        # Remove closing fence line
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

    # Detect from code content
    if "import " in code or "def " in code or "class " in code or "print(" in code:
        return ".py", "python3", "python"
    if "function " in code or "const " in code or "require(" in code or "console.log" in code:
        return ".js", "node", "javascript"
    if "<html" in code_lower or "<!doctype" in code_lower:
        return ".html", "", "html"
    if "#!/bin/bash" in code or "#!/bin/sh" in code:
        return ".sh", "bash", "bash"

    # Default to Python
    return ".py", "python3", "python"


def _parse_multi_file(ai_response: str) -> list[dict] | None:
    """Try to parse AI response as multi-file project structure.

    Expected JSON format:
    {
        "files": [
            {"path": "main.py", "content": "..."},
            {"path": "utils/helpers.py", "content": "..."},
            {"path": "requirements.txt", "content": "..."}
        ],
        "entry_point": "main.py",
        "install_cmd": "pip install -r requirements.txt"
    }
    """
    try:
        # Try to find JSON in the response
        json_match = re.search(r"\{[\s\S]*\"files\"[\s\S]*\}", ai_response)
        if json_match:
            data = json.loads(json_match.group())
            if "files" in data and isinstance(data["files"], list):
                return data
    except (json.JSONDecodeError, AttributeError):
        pass
    return None


# ─── File Operations ─────────────────────────────────────────────


def _save_code(code: str, project_name: str, ext: str, filename: str = "") -> str:
    """Save code to a file and return the path."""
    project_dir = os.path.join(OUTPUT_BASE, project_name)
    os.makedirs(project_dir, exist_ok=True)

    if not filename:
        filename = f"main{ext}"

    filepath = os.path.join(project_dir, filename)

    # Create subdirectories if needed
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
        filepath = os.path.join(project_dir, file_info["path"])
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
                timeout=60,
            )
        except Exception:
            pass

    return project_dir, entry_path


# ─── Code Execution ──────────────────────────────────────────────


def _run_code(filepath: str, interpreter: str) -> tuple[bool, str, str]:
    """Execute code and return (success, stdout, stderr)."""
    if not interpreter:
        # Non-executable files (HTML, etc.)
        return True, f"File saved: {filepath}", ""

    try:
        result = subprocess.run(
            [interpreter, filepath] if " " not in interpreter else interpreter.split() + [filepath],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(filepath),
        )
        stdout = result.stdout[:2000] if result.stdout else ""
        stderr = result.stderr[:2000] if result.stderr else ""
        success = result.returncode == 0
        return success, stdout, stderr
    except subprocess.TimeoutExpired:
        return False, "", "Execution timed out (30s limit)."
    except FileNotFoundError:
        return False, "", f"Interpreter not found: {interpreter}"
    except Exception as e:
        return False, "", f"Execution error: {e}"


# ─── Main Handler ────────────────────────────────────────────────


SYSTEM_PROMPT_SINGLE = textwrap.dedent("""\
    You are MCP, an autonomous AI coding agent (TRON-themed).
    You write clean, production-ready, RUNNABLE code.

    Rules:
    - Return ONLY the code. No markdown fences, no explanations before/after.
    - Code must be complete and self-contained — it should run without modifications.
    - Include all necessary imports.
    - Include a main execution block (if __name__ == '__main__', etc.) so the code
      actually DOES something when run.
    - Add concise comments explaining key logic.
    - If the request is vague, make reasonable assumptions and build something functional.\
""")

SYSTEM_PROMPT_FIX = textwrap.dedent("""\
    You are MCP, an autonomous AI coding agent.
    The code you previously generated had errors when executed.
    Fix the code so it runs without errors.

    Rules:
    - Return ONLY the fixed code. No markdown fences, no explanations.
    - The code must be complete — don't return partial snippets.
    - Fix ALL errors, not just the first one.
    - Keep the original functionality intact.\
""")

SYSTEM_PROMPT_PROJECT = textwrap.dedent("""\
    You are MCP, an autonomous AI coding agent (TRON-themed).
    Generate a multi-file project structure.

    Return a JSON object with this exact format:
    {
        "files": [
            {"path": "relative/path/file.py", "content": "full file content"},
            {"path": "requirements.txt", "content": "package1\\npackage2"}
        ],
        "entry_point": "main.py",
        "install_cmd": "pip install -r requirements.txt"
    }

    Rules:
    - Every file must have complete, runnable content.
    - Include ALL imports and dependencies.
    - The entry_point file should demonstrate the project working.
    - Return ONLY the JSON, nothing else.\
""")


async def handle_code(args: str) -> dict:
    """Handle 'MCP code [thing]' command.

    Agentic coding: generates code, runs it, auto-fixes errors.
    Supports single files and multi-file projects.
    """
    if not args:
        return {
            "message": "Code protocol requires a target. Usage: MCP code [description]",
            "data": {"status": "awaiting_input"},
        }

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key or api_key == "your-openai-api-key-here":
        return {
            "message": "AI not configured. Set OPENAI_API_KEY in .env for agentic coding.",
            "data": {"status": "no_api_key"},
        }

    # Check if VSCode is available for opening files
    has_vscode = shutil.which("code") is not None

    # Determine if this is a multi-file project request
    is_project = any(
        w in args.lower()
        for w in ["project", "app", "application", "website", "api", "full", "scaffold"]
    )

    project_name = re.sub(r"[^a-z0-9_]", "_", args.lower())[:40]
    attempts_log: list[dict] = []

    try:
        if is_project:
            return await _handle_project(args, api_key, project_name, has_vscode)
        else:
            return await _handle_single_file(
                args, api_key, project_name, has_vscode, attempts_log
            )
    except Exception as e:
        return {
            "message": f"Agentic coding failed: {e}",
            "data": {
                "request": args,
                "status": "error",
                "attempts": len(attempts_log),
                "log": attempts_log,
            },
        }


async def _handle_single_file(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
    attempts_log: list[dict],
) -> dict:
    """Generate a single file, run it, and auto-fix errors."""
    # Step 1: Generate initial code
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_SINGLE},
        {"role": "user", "content": f"Generate code for: {args}"},
    ]

    raw_code = await _call_ai(messages, api_key)
    code = _strip_markdown_fences(raw_code)
    ext, interpreter, lang = _detect_language(code, args)

    # Step 2: Save and run
    filepath = _save_code(code, project_name, ext)
    success, stdout, stderr = _run_code(filepath, interpreter)

    attempts_log.append({
        "attempt": 1,
        "status": "success" if success else "error",
        "output": stdout[:500] if stdout else "",
        "error": stderr[:500] if stderr else "",
    })

    # Step 3: Auto-fix loop
    attempt = 1
    while not success and attempt < MAX_FIX_ATTEMPTS:
        attempt += 1

        fix_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_FIX},
            {"role": "user", "content": (
                f"Original request: {args}\n\n"
                f"Code that failed:\n```\n{code}\n```\n\n"
                f"Error output:\n```\n{stderr}\n```\n\n"
                f"Fix this code so it runs without errors."
            )},
        ]

        raw_fix = await _call_ai(fix_messages, api_key)
        code = _strip_markdown_fences(raw_fix)

        # Re-save and re-run
        filepath = _save_code(code, project_name, ext)
        success, stdout, stderr = _run_code(filepath, interpreter)

        attempts_log.append({
            "attempt": attempt,
            "status": "success" if success else "error",
            "output": stdout[:500] if stdout else "",
            "error": stderr[:500] if stderr else "",
        })

    # Open in VSCode if available
    if has_vscode:
        try:
            subprocess.Popen(
                ["code", filepath],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    # Build result
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
        },
    }


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

    raw_response = await _call_ai(messages, api_key, max_tokens=3000)
    project_data = _parse_multi_file(raw_response)

    if not project_data:
        # Fallback: treat as single file if JSON parsing fails
        code = _strip_markdown_fences(raw_response)
        ext, interpreter, lang = _detect_language(code, args)
        filepath = _save_code(code, project_name, ext)
        success, stdout, stderr = _run_code(filepath, interpreter)

        return {
            "message": (
                f"Project scaffolding for: {args}. "
                f"Generated as single file (multi-file parsing failed). "
                f"Saved to {filepath}"
            ),
            "data": {
                "request": args,
                "status": "success" if success else "partial",
                "language": lang,
                "saved_to": filepath,
                "output": stdout[:500] if stdout else "",
                "error": stderr[:500] if stderr else "",
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
    if entry_path:
        ext, interpreter, lang = _detect_language(
            open(entry_path).read(), args
        )
        run_success, output, error = _run_code(entry_path, interpreter)

        # Auto-fix entry point if it fails
        if not run_success:
            fix_messages = [
                {"role": "system", "content": SYSTEM_PROMPT_FIX},
                {"role": "user", "content": (
                    f"Original request: {args}\n\n"
                    f"Entry point code that failed:\n```\n{open(entry_path).read()}\n```\n\n"
                    f"Error:\n```\n{error}\n```\n\n"
                    f"Fix this code so it runs."
                )},
            ]
            raw_fix = await _call_ai(fix_messages, api_key)
            fixed_code = _strip_markdown_fences(raw_fix)
            with open(entry_path, "w") as f:
                f.write(fixed_code)
            run_success, output, error = _run_code(entry_path, interpreter)

    # Open project in VSCode
    if has_vscode:
        try:
            subprocess.Popen(
                ["code", project_dir],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
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

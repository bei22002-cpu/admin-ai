"""MCP Code Command - Devin-like agentic AI coding system.

Autonomous code generation with:
- Generate, Execute, Auto-fix loop (up to 10 attempts)
- Auto-install missing dependencies (pip/npm/cargo/go)
- Edit existing files with AI
- Multi-file project scaffolding in any language
- Conversation memory for iterative development
- Smart language detection and proper error diagnosis
- Codebase awareness: scan and modify existing repos
- Web research: look up docs/APIs during coding
- Long-running iteration: multi-pass pipeline until clean
- Rate-limit retry with exponential backoff
- Subprocess sandboxing for safe code execution
"""

import ast
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import textwrap
import time
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)

# ─── Rate-Limit Retry Config ────────────────────────────────────
_MAX_RETRIES = 5
_RETRY_BASE_DELAY = 2.0  # seconds — doubles each retry

MAX_FIX_ATTEMPTS = 10
MAX_FIX_ATTEMPTS_SIMPLE = 5
OUTPUT_BASE = os.path.join(os.path.expanduser("~"), "mcp_generated")
MEMORY_FILE = os.path.join(OUTPUT_BASE, ".mcp_code_memory.json")
EXEC_TIMEOUT = 120  # seconds
EXEC_TIMEOUT_SIMPLE = 30  # seconds

# ─── Progress Tracking (SSE) ────────────────────────────────────

_progress_events: dict[str, list[dict]] = {}


def _emit_progress(project_name: str, phase: str, detail: str, progress: float = 0.0) -> None:
    """Emit a progress event for SSE streaming."""
    if project_name not in _progress_events:
        _progress_events[project_name] = []
    _progress_events[project_name].append({
        "phase": phase,
        "detail": detail,
        "progress": progress,
        "timestamp": time.time(),
    })

# Complexity keywords — trigger the heavy pipeline (multi-pass iteration)
COMPLEX_KEYWORDS = {
    "business", "enterprise", "production", "fullstack", "full-stack",
    "microservice", "authentication", "authorization", "oauth",
    "database", "crud", "rest api", "graphql", "websocket",
    "dashboard", "admin panel", "e-commerce", "ecommerce",
    "payment", "stripe", "inventory", "crm", "erp",
    "machine learning", "neural network", "deep learning",
    "blockchain", "smart contract", "trading", "analytics",
    "real-time", "async", "concurrent", "distributed",
    "scraper", "crawler", "pipeline", "etl",
    "game engine", "game", "chess", "physics", "rendering",
    "algorithm", "ai opponent", "minimax", "pathfinding", "simulation",
    "compiler", "interpreter", "parser", "lexer",
    "operating system", "kernel", "driver",
    "encryption", "security", "firewall",
    "multi-file", "complex", "advanced", "sophisticated",
    "with tests", "with logging", "with config",
    # Additional keywords to catch more project types
    "blog", "platform", "system", "forum", "social",
    "chat", "messaging", "notification", "scheduler", "workflow",
    "api", "server", "client", "library", "sdk",
    "tool", "utility", "manager", "tracker", "monitor",
    "portal", "store", "marketplace", "catalog", "registry",
    "with posts", "with comments", "with users", "with roles",
    "multiple", "modules", "components", "services",
}


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


def _is_complex(request: str) -> bool:
    """Detect if a request requires the heavy pipeline."""
    req_lower = request.lower()
    # Check for complex keywords
    if any(kw in req_lower for kw in COMPLEX_KEYWORDS):
        return True
    # Long requests are usually complex
    if len(request.split()) > 15:
        return True
    return False


def _get_ai_provider() -> str:
    """Get the configured AI provider from environment."""
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _call_ai(
    messages: list[dict],
    api_key: str,
    max_tokens: int = 2500,
    use_heavy_model: bool = False,
) -> str:
    """Send messages to the configured AI provider.

    Supports OpenAI and Anthropic (Claude).
    Uses heavy models for complex tasks, light models for simple ones.
    """
    provider = _get_ai_provider()

    if provider == "anthropic":
        return await _call_anthropic(messages, api_key, max_tokens, use_heavy_model)
    else:
        return await _call_openai(messages, api_key, max_tokens, use_heavy_model)


async def _call_openai(
    messages: list[dict],
    api_key: str,
    max_tokens: int = 2500,
    use_heavy_model: bool = False,
) -> str:
    """Call OpenAI API with retry-on-rate-limit. Uses gpt-4o / gpt-4o-mini."""
    model = "gpt-4o" if use_heavy_model else "gpt-4o-mini"
    timeout = 180.0 if use_heavy_model else 90.0

    for attempt in range(_MAX_RETRIES):
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": 0.15 if use_heavy_model else 0.2,
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    return data["choices"][0]["message"]["content"]
                if response.status_code == 429:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("OpenAI rate limit hit, retrying in %.1fs (attempt %d/%d)", delay, attempt + 1, _MAX_RETRIES)
                    await asyncio.sleep(delay)
                    continue
                if response.status_code >= 500:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("OpenAI server error %d, retrying in %.1fs", response.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                return f"AI error (HTTP {response.status_code}): {response.text[:300]}"
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                if attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("OpenAI request failed (%s), retrying in %.1fs", exc, delay)
                    await asyncio.sleep(delay)
                    continue
                return f"AI error (timeout after {_MAX_RETRIES} retries): {exc}"
    return "AI error: max retries exceeded (rate limit)"


async def _call_anthropic(
    messages: list[dict],
    api_key: str,
    max_tokens: int = 2500,
    use_heavy_model: bool = False,
) -> str:
    """Call Anthropic API. Uses claude-sonnet-4-20250514 / claude-haiku-4-5-20251001."""
    model = "claude-sonnet-4-20250514" if use_heavy_model else "claude-haiku-4-5-20251001"
    timeout = 180.0 if use_heavy_model else 90.0

    # Anthropic uses a different message format:
    # system message is a top-level param, not in the messages array
    system_content = ""
    user_messages: list[dict] = []
    for msg in messages:
        if msg["role"] == "system":
            system_content = msg["content"]
        else:
            user_messages.append({"role": msg["role"], "content": msg["content"]})

    # Ensure messages alternate and start with user
    if not user_messages or user_messages[0]["role"] != "user":
        user_messages.insert(0, {"role": "user", "content": "Please proceed."})

    request_body: dict = {
        "model": model,
        "messages": user_messages,
        "max_tokens": max_tokens,
        "temperature": 0.15 if use_heavy_model else 0.2,
    }
    if system_content:
        request_body["system"] = system_content

    for attempt in range(_MAX_RETRIES):
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "content-type": "application/json",
                        "anthropic-version": "2023-06-01",
                    },
                    json=request_body,
                )
                if response.status_code == 200:
                    data = response.json()
                    content_blocks = data.get("content", [])
                    text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
                    return "\n".join(text_parts) if text_parts else "No response from AI."
                if response.status_code == 429:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("Anthropic rate limit hit, retrying in %.1fs (attempt %d/%d)", delay, attempt + 1, _MAX_RETRIES)
                    await asyncio.sleep(delay)
                    continue
                if response.status_code >= 500:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("Anthropic server error %d, retrying in %.1fs", response.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                return f"AI error (HTTP {response.status_code}): {response.text[:300]}"
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                if attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning("Anthropic request failed (%s), retrying in %.1fs", exc, delay)
                    await asyncio.sleep(delay)
                    continue
                return f"AI error (timeout after {_MAX_RETRIES} retries): {exc}"
    return "AI error: max retries exceeded (rate limit)"


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
    Supports Python, JavaScript, TypeScript, Go, Rust, Java, C++, HTML, Bash, CSS.
    """
    request_lower = request.lower()
    code_lower = code.lower()

    # Check request hints first
    if any(w in request_lower for w in ["javascript", "node", "react", "express", "next.js", ".js"]):
        return ".js", "node", "javascript"
    if any(w in request_lower for w in ["typescript", "angular", "nest.js", ".ts"]):
        return ".ts", "npx ts-node", "typescript"
    if any(w in request_lower for w in ["golang", " go ", "go app", "go api", "gin ", "fiber "]):
        return ".go", "go run", "go"
    if any(w in request_lower for w in [" rust ", "rust app", "cargo", "tokio"]):
        return ".rs", "cargo_run", "rust"
    if any(w in request_lower for w in [" java ", "java app", "spring", "maven", "gradle"]):
        return ".java", "java_compile_run", "java"
    if any(w in request_lower for w in ["c++", "cpp", "g++", "cmake"]):
        return ".cpp", "cpp_compile_run", "cpp"
    if any(w in request_lower for w in ["html", "webpage", "website", "landing page"]):
        return ".html", "", "html"
    if any(w in request_lower for w in ["bash", "shell", "script"]):
        return ".sh", "bash", "bash"
    if any(w in request_lower for w in ["css", "stylesheet"]):
        return ".css", "", "css"

    # Detect from code content
    if "package main" in code and ("func " in code or "import " in code):
        return ".go", "go run", "go"
    if "fn main()" in code or "use std::" in code or "#[derive" in code:
        return ".rs", "cargo_run", "rust"
    if "public static void main" in code or "class " in code and "System.out" in code:
        return ".java", "java_compile_run", "java"
    if "#include" in code and ("int main" in code or "std::" in code):
        return ".cpp", "cpp_compile_run", "cpp"
    if "import " in code or "def " in code or "class " in code or "print(" in code:
        return ".py", "python3", "python"
    if "function " in code or "const " in code or "require(" in code or "console.log" in code:
        return ".js", "node", "javascript"
    if "<html" in code_lower or "<!doctype" in code_lower:
        return ".html", "", "html"
    if "#!/bin/bash" in code or "#!/bin/sh" in code:
        return ".sh", "bash", "bash"

    return ".py", "python3", "python"


def _extract_imports(code: str, lang: str, project_dir: str = "") -> list[str]:
    """Extract third-party package names from import statements.

    If project_dir is provided, filters out local project modules.
    """
    packages: list[str] = []
    local_modules = _get_project_local_modules(project_dir) if project_dir else set()
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
                if pkg not in stdlib and pkg not in local_modules:
                    packages.append(pkg)
            elif line.startswith("from "):
                pkg = line.split()[1].split(".")[0]
                if pkg not in stdlib and pkg not in local_modules:
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
    """Try to parse AI response as multi-file project structure.

    Handles truncated JSON by extracting individual complete file entries
    even when the overall JSON is malformed (e.g., cut off by max_tokens).
    """
    text = _strip_markdown_fences(ai_response).strip()

    # Attempt 1: full JSON parse
    try:
        json_match = re.search(r"\{[\s\S]*\"files\"[\s\S]*\}", text)
        if json_match:
            data = json.loads(json_match.group())
            if "files" in data and isinstance(data["files"], list) and data["files"]:
                return data
    except (json.JSONDecodeError, AttributeError):
        pass

    # Attempt 2: salvage complete file entries from truncated JSON
    if '"files"' in text and '"path"' in text and '"content"' in text:
        salvaged_files: list[dict] = []
        # Find each {"path": ..., "content": ...} object
        file_pattern = re.compile(
            r'\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}',
            re.DOTALL,
        )
        for m in file_pattern.finditer(text):
            path = m.group(1)
            # Unescape the content string
            try:
                content = json.loads('"' + m.group(2) + '"')
            except json.JSONDecodeError:
                content = m.group(2).replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
            salvaged_files.append({"path": path, "content": content})

        if salvaged_files:
            # Try to extract entry_point from the text
            ep_match = re.search(r'"entry_point"\s*:\s*"([^"]+)"', text)
            entry_point = ep_match.group(1) if ep_match else "main.py"
            return {
                "files": salvaged_files,
                "entry_point": entry_point,
            }

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


# ─── Subprocess Sandboxing (Enhancement #6) ─────────────────────


def _sandboxed_run(
    cmd: list[str],
    cwd: str,
    timeout: int = EXEC_TIMEOUT_SIMPLE,
) -> subprocess.CompletedProcess[str]:
    """Run a command in a restricted subprocess.

    Applies resource limits to prevent runaway processes:
    - CPU time limit (matches timeout)
    - Address space limit (512 MB)
    - File size limit (50 MB)
    - No network restrictions (some code needs network)
    """
    def _set_limits() -> None:
        """Pre-exec function to set resource limits on child process."""
        try:
            # CPU time limit (soft = timeout, hard = timeout + 10)
            resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout + 10))
            # Address space: 512 MB
            mem_limit = 512 * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (mem_limit, mem_limit))
            # Max file size: 50 MB
            file_limit = 50 * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
        except (ValueError, OSError):
            pass  # some limits may not be supported on all platforms

    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
            preexec_fn=_set_limits,
        )
    except Exception:
        # Fallback: run without resource limits if preexec_fn fails
        # (e.g. inside uvicorn async workers)
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )


# ─── Code Execution ──────────────────────────────────────────────


def _run_code(
    filepath: str, interpreter: str, timeout: int = EXEC_TIMEOUT_SIMPLE
) -> tuple[bool, str, str]:
    """Execute code and return (success, stdout, stderr).

    Supports compiled languages (Go, Rust, Java, C++) via special interpreter
    tokens that trigger a compile-then-run workflow.
    """
    if not interpreter:
        return True, f"File saved: {filepath}", ""

    cwd = os.path.dirname(filepath)

    try:
        # ── Compiled language handlers ────────────────────────────
        if interpreter == "go run":
            cmd = ["go", "run", filepath]
        elif interpreter == "cargo_run":
            # Rust: compile with rustc, then run the binary
            binary = filepath.replace(".rs", "")
            comp = subprocess.run(
                ["rustc", filepath, "-o", binary],
                capture_output=True, text=True, timeout=timeout, cwd=cwd,
            )
            if comp.returncode != 0:
                return False, "", comp.stderr[:5000]
            cmd = [binary]
        elif interpreter == "java_compile_run":
            # Java: compile with javac, then run with java
            comp = subprocess.run(
                ["javac", filepath],
                capture_output=True, text=True, timeout=timeout, cwd=cwd,
            )
            if comp.returncode != 0:
                return False, "", comp.stderr[:5000]
            class_name = os.path.splitext(os.path.basename(filepath))[0]
            cmd = ["java", "-cp", cwd, class_name]
        elif interpreter == "cpp_compile_run":
            # C++: compile with g++, then run
            binary = filepath.replace(".cpp", "")
            comp = subprocess.run(
                ["g++", "-std=c++17", "-o", binary, filepath],
                capture_output=True, text=True, timeout=timeout, cwd=cwd,
            )
            if comp.returncode != 0:
                return False, "", comp.stderr[:5000]
            cmd = [binary]
        elif " " not in interpreter:
            cmd = [interpreter, filepath]
        else:
            cmd = interpreter.split() + [filepath]

        # ── Sandboxed execution ───────────────────────────────────
        result = _sandboxed_run(cmd, cwd=cwd, timeout=timeout)
        stdout = result.stdout[:5000] if result.stdout else ""
        stderr = result.stderr[:5000] if result.stderr else ""
        success = result.returncode == 0
        return success, stdout, stderr
    except subprocess.TimeoutExpired:
        return False, "", f"Execution timed out ({timeout}s limit)."
    except FileNotFoundError as e:
        return False, "", f"Interpreter/compiler not found: {e}"
    except Exception as e:
        return False, "", f"Execution error: {e}"


def _read_project_files(project_dir: str) -> str:
    """Read all source files in a project directory for context."""
    context_parts: list[str] = []
    max_files = 15
    max_chars = 20000
    total_chars = 0

    for root, _dirs, files in os.walk(project_dir):
        for fname in sorted(files):
            if len(context_parts) >= max_files:
                break
            if not fname.endswith((
                ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".txt",
                ".cfg", ".ini", ".yaml", ".yml", ".toml",
                ".go", ".rs", ".java", ".cpp", ".c", ".h", ".hpp", ".cs",
                ".rb", ".php", ".swift", ".kt", ".scala",
                ".html", ".css", ".scss", ".vue", ".svelte",
                ".sql", ".sh", ".bash", ".md",
            )):
                continue
            if fname.startswith(".") or "__pycache__" in root:
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, project_dir)
            try:
                with open(fpath) as f:
                    content = f.read()
                if total_chars + len(content) > max_chars:
                    continue
                total_chars += len(content)
                context_parts.append(f"--- {rel_path} ---\n{content}")
            except Exception:
                continue

    return "\n\n".join(context_parts)


def _get_project_local_modules(project_dir: str) -> set[str]:
    """Get set of module names that are local project files (not PyPI packages)."""
    local_modules: set[str] = set()
    if not project_dir or not os.path.isdir(project_dir):
        return local_modules
    for root, dirs, files in os.walk(project_dir):
        if "__pycache__" in root:
            continue
        for fname in files:
            if fname.endswith(".py"):
                local_modules.add(fname[:-3])  # e.g., "board" from "board.py"
        for d in dirs:
            init_path = os.path.join(root, d, "__init__.py")
            if os.path.exists(init_path):
                local_modules.add(d)
    return local_modules


def _extract_signatures(code: str) -> str:
    """Extract class/function signatures from Python code using AST.

    Returns a compact representation of the module's public API —
    much smaller than full source but preserves interface info for context.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        # If code doesn't parse, fall back to truncation
        return code[:2000]

    lines: list[str] = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            try:
                lines.append(ast.unparse(node))
            except Exception:
                pass
        elif isinstance(node, ast.ClassDef):
            bases_str = ", ".join(
                ast.unparse(b) for b in node.bases
            ) if node.bases else ""
            class_line = (
                f"class {node.name}({bases_str}):"
                if bases_str
                else f"class {node.name}:"
            )
            lines.append(class_line)
            # Docstring
            if (
                node.body
                and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
                and isinstance(node.body[0].value.value, str)
            ):
                doc = node.body[0].value.value.split("\n")[0][:120]
                lines.append(f'    """{doc}"""')
            # Method signatures
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    try:
                        args_str = ast.unparse(item.args)
                        ret = f" -> {ast.unparse(item.returns)}" if item.returns else ""
                        lines.append(f"    def {item.name}({args_str}){ret}: ...")
                    except Exception:
                        lines.append(f"    def {item.name}(...): ...")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            try:
                args_str = ast.unparse(node.args)
                ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
                lines.append(f"def {node.name}({args_str}){ret}: ...")
            except Exception:
                lines.append(f"def {node.name}(...): ...")
        elif isinstance(node, ast.Assign):
            # Top-level constants
            try:
                line = ast.unparse(node)
                if len(line) < 200:
                    lines.append(line)
            except Exception:
                pass

    return "\n".join(lines) if lines else code[:2000]


def _git_init_and_commit(project_dir: str, message: str) -> bool:
    """Initialize git repo (if needed) and commit current state."""
    try:
        git_dir = os.path.join(project_dir, ".git")
        if not os.path.isdir(git_dir):
            subprocess.run(
                ["git", "init"], cwd=project_dir,
                capture_output=True, timeout=10,
            )
            subprocess.run(
                ["git", "config", "user.email", "mcp@grid.local"],
                cwd=project_dir, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["git", "config", "user.name", "MCP Grid"],
                cwd=project_dir, capture_output=True, timeout=5,
            )
        subprocess.run(
            ["git", "add", "-A"], cwd=project_dir,
            capture_output=True, timeout=10,
        )
        result = subprocess.run(
            ["git", "commit", "-m", message, "--allow-empty"],
            cwd=project_dir, capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


# ─── Web Research (Upgrade #3) ──────────────────────────────────


async def _web_research(query: str) -> str:
    """Search the web for documentation, APIs, and code examples.

    Uses DuckDuckGo's HTML endpoint (no API key needed) to find relevant
    information that helps the AI generate better code.
    Returns a summary of the top results.
    """
    try:
        encoded = quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                headers={"User-Agent": "MCP-Grid/1.0"},
                follow_redirects=True,
            )
            if response.status_code != 200:
                return ""

            text = response.text
            # Extract result snippets from DuckDuckGo HTML results
            snippets: list[str] = []
            for match in re.finditer(
                r'class="result__snippet"[^>]*>(.*?)</a>', text, re.DOTALL
            ):
                snippet = re.sub(r"<[^>]+>", "", match.group(1)).strip()
                if snippet:
                    snippets.append(snippet)
                if len(snippets) >= 5:
                    break

            if not snippets:
                return ""
            return "Web research results:\n" + "\n".join(
                f"- {s}" for s in snippets
            )
    except Exception as exc:
        logger.debug("Web research failed: %s", exc)
        return ""


# ─── Codebase Awareness (Upgrade #2) ────────────────────────────

# Supported source file extensions for repo scanning
_SOURCE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java",
    ".cpp", ".c", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
    ".kt", ".scala", ".html", ".css", ".scss", ".vue", ".svelte",
    ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".txt",
    ".md", ".sql", ".sh", ".bash", ".dockerfile",
}


def _scan_repo(repo_path: str) -> dict:
    """Scan an existing repository and build a structural summary.

    Returns a dict with:
    - tree: file tree string
    - key_files: dict of important files and their first N lines
    - languages: set of detected languages
    - frameworks: list of detected frameworks
    - entry_points: list of likely entry point files
    """
    tree_lines: list[str] = []
    key_files: dict[str, str] = {}
    languages: set[str] = set()
    entry_points: list[str] = []
    total_files = 0
    max_scan_files = 200

    # Detect frameworks from config files
    frameworks: list[str] = []
    config_indicators = {
        "package.json": "Node.js",
        "requirements.txt": "Python (pip)",
        "pyproject.toml": "Python (poetry/pip)",
        "Cargo.toml": "Rust (cargo)",
        "go.mod": "Go (modules)",
        "pom.xml": "Java (Maven)",
        "build.gradle": "Java (Gradle)",
        "Gemfile": "Ruby (Bundler)",
        "composer.json": "PHP (Composer)",
        "CMakeLists.txt": "C/C++ (CMake)",
        "Makefile": "Make",
        "Dockerfile": "Docker",
        "docker-compose.yml": "Docker Compose",
        "tsconfig.json": "TypeScript",
        "next.config.js": "Next.js",
        "vite.config.ts": "Vite",
        "angular.json": "Angular",
        "vue.config.js": "Vue.js",
    }

    for root, dirs, files in os.walk(repo_path):
        # Skip hidden dirs, node_modules, __pycache__, etc.
        dirs[:] = [
            d for d in dirs
            if not d.startswith(".")
            and d not in {"node_modules", "__pycache__", "venv", ".venv",
                          "dist", "build", "target", ".git", "vendor"}
        ]
        rel_root = os.path.relpath(root, repo_path)
        depth = rel_root.count(os.sep) if rel_root != "." else 0
        if depth > 5:
            continue

        for fname in sorted(files):
            if total_files >= max_scan_files:
                break
            ext = os.path.splitext(fname)[1].lower()
            if ext not in _SOURCE_EXTENSIONS and fname not in config_indicators:
                continue
            total_files += 1

            rel_path = os.path.join(rel_root, fname) if rel_root != "." else fname
            tree_lines.append(f"  {'  ' * depth}{fname}")

            # Detect language
            lang_map = {
                ".py": "python", ".js": "javascript", ".ts": "typescript",
                ".go": "go", ".rs": "rust", ".java": "java",
                ".cpp": "cpp", ".c": "c", ".rb": "ruby", ".php": "php",
            }
            if ext in lang_map:
                languages.add(lang_map[ext])

            # Check framework indicators
            if fname in config_indicators:
                frameworks.append(config_indicators[fname])

            # Identify entry points
            if fname in {"main.py", "app.py", "index.js", "index.ts",
                         "main.go", "main.rs", "Main.java", "main.cpp",
                         "server.py", "server.js", "manage.py"}:
                entry_points.append(rel_path)

            # Read key files (first 50 lines for context)
            full_path = os.path.join(root, fname)
            if fname in config_indicators or fname in {
                "main.py", "app.py", "index.js", "README.md",
            }:
                try:
                    with open(full_path) as f:
                        content = "".join(f.readlines()[:50])
                    key_files[rel_path] = content
                except Exception:
                    pass

    return {
        "tree": "\n".join(tree_lines[:100]),
        "key_files": key_files,
        "languages": languages,
        "frameworks": frameworks,
        "entry_points": entry_points,
        "file_count": total_files,
    }


def _build_repo_context(repo_path: str) -> str:
    """Build a context string from an existing repo for the AI.

    Returns a formatted summary of the repo structure, frameworks,
    and key file contents.
    """
    info = _scan_repo(repo_path)
    parts: list[str] = []

    parts.append(f"Repository: {repo_path}")
    parts.append(f"Files scanned: {info['file_count']}")
    if info["languages"]:
        parts.append(f"Languages: {', '.join(sorted(info['languages']))}")
    if info["frameworks"]:
        parts.append(f"Frameworks: {', '.join(info['frameworks'])}")
    if info["entry_points"]:
        parts.append(f"Entry points: {', '.join(info['entry_points'])}")

    parts.append(f"\nFile tree:\n{info['tree']}")

    if info["key_files"]:
        parts.append("\nKey file contents:")
        for fpath, content in info["key_files"].items():
            parts.append(f"\n--- {fpath} ---\n{content}")

    return "\n".join(parts)


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
    - Follow PEP 8 (Python), ESLint (JS/TS), gofmt (Go), or standard style guides.
    - Generate code in whatever language best fits the request.
    - If the user specifies a language (e.g. "in Go", "using Rust"), use that language.
    - If the request is vague, build something impressive and functional.
    - Prefer standard library over third-party packages when possible.
    - Structure code with classes and functions, not loose scripts.
    - NEVER use input() or any interactive stdin prompts. The code runs headlessly.
    - Instead of interactive input, use hardcoded demo values or command-line args.
    - The main block must produce visible console output to prove it works.

    For complex requests:
    - Use design patterns (Factory, Strategy, Observer, Repository, etc.) where appropriate.
    - Implement proper separation of concerns within the file.
    - Add comprehensive error handling with custom exception classes.
    - Include logging with proper log levels.
    - Use dataclasses or NamedTuple for data structures.
    - Add input validation on all public methods.
    - Write self-documenting code with clear section headers.
    - The demo in main() should exercise ALL major features.\
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
            {"path": "models.py", "content": "full file content here"},
            {"path": "utils.py", "content": "full file content here"},
            {"path": "config.py", "content": "full file content here"},
            {"path": "requirements.txt", "content": "package1\\npackage2"}
        ],
        "entry_point": "main.py",
        "install_cmd": "pip install -r requirements.txt"
    }

    Project standards:
    - Separate concerns into multiple files (models, utils, main, config, services).
    - Include a requirements.txt or package.json with dependencies.
    - Entry point must demonstrate the project working with example usage.
    - Every file must have complete, runnable content.
    - Include proper imports between project files (relative imports).
    - Add docstrings and type hints.
    - Include error handling.
    - Return ONLY the JSON object, nothing else.

    For complex/business projects:
    - Use proper architecture: models/entities, services/business logic, repositories/data layer.
    - Support subdirectories: {"path": "models/user.py", "content": "..."}.
    - Include __init__.py files for packages.
    - Add a config.py for settings and constants.
    - Include proper logging setup.
    - Add input validation and custom exceptions.
    - Generate 5-15 files for complex projects — don't oversimplify.
    - Include a README.md explaining the project structure.
    - The entry point should run a comprehensive demo exercising all features.
    - Use design patterns: Repository, Service, Factory, etc.
    - Include error handling at every layer.
    - Use SQLite for database needs (stdlib, no external DB required).
    - NEVER use input() — all demos use hardcoded example data.\
""")

SYSTEM_PROMPT_PLAN = textwrap.dedent("""\
    You are MCP, an elite autonomous AI architect.
    Before coding a complex project, you create a detailed architecture plan.

    Given a project description, return a JSON plan with this format:
    {
        "project_name": "descriptive_name",
        "architecture": "Brief architecture description",
        "components": [
            {"name": "component_name", "file": "path/to/file.py", "responsibility": "what it does"},
        ],
        "data_models": [
            {"name": "ModelName", "fields": ["field1: type", "field2: type"]}
        ],
        "key_features": ["feature1", "feature2"],
        "dependencies": ["package1", "package2"],
        "design_patterns": ["Pattern1", "Pattern2"],
        "entry_point": "main.py",
        "build_order": ["config.py", "models.py", "utils.py", "services.py", "main.py"]
    }

    Planning rules:
    - Break complex systems into 5-15 components.
    - Identify all data models and their relationships.
    - List external dependencies needed.
    - Suggest design patterns that fit the use case.
    - Keep it practical — code must actually run headlessly.
    - Use SQLite for databases (no external DB servers).
    - Specify build_order: list files in dependency order (foundations first, entry point last).
    - Each component must have a clear responsibility and interface description.
    - Keep the entry point (main.py) THIN — it should only import from other modules and
      orchestrate/demo them.  Put all real logic in dedicated modules.
      main.py should be < 150 lines.
    - Return ONLY the JSON, no other text.\
""")

SYSTEM_PROMPT_MODULE = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer.
    You are building a project MODULE BY MODULE, like a senior developer would.

    You are generating ONE specific module. You have:
    - The architecture plan for the full project
    - The modules that have already been built (their full source code)
    - The specification for THIS module you need to build now

    Rules:
    - Return ONLY the code for this ONE module. No markdown fences, no prose.
    - The code must be COMPLETE and self-contained for this module.
    - Import from other project modules using the appropriate import mechanism.
    - The code must be compatible with the already-built modules.
    - Use the language specified in the architecture plan.
    - Use proper type annotations, documentation, error handling.
    - Follow the language's standard style guide (PEP 8, gofmt, rustfmt, etc.).
    - NEVER use interactive stdin prompts. The code runs headlessly.
    - If this is the entry point, include a comprehensive demo
      that exercises ALL features from ALL modules with hardcoded example data.
    - The demo must produce clear, formatted console output proving everything works.
    - Use design patterns appropriate for the module's role.
    - Include logging with proper log levels.
    - Add custom exception/error types where appropriate.\
""")

SYSTEM_PROMPT_REVIEW = textwrap.dedent("""\
    You are MCP, an elite autonomous AI code reviewer.
    Review the following project and identify improvements.

    Return a JSON object with this EXACT format (no other text):
    {
        "quality_score": 7,
        "issues": [
            {
                "file": "filename.py",
                "severity": "high",
                "issue": "Description of the problem",
                "fix": "How to fix it"
            }
        ],
        "improvements": [
            {
                "file": "filename.py",
                "description": "What to improve",
                "priority": "high"
            }
        ],
        "files_to_rewrite": ["filename.py"]
    }

    Review criteria:
    - Code correctness: Does it actually work? Any bugs?
    - Error handling: Are edge cases covered? Proper try/except?
    - Type safety: Are type hints complete and correct?
    - Documentation: Are docstrings clear and complete?
    - Architecture: Is separation of concerns respected?
    - Robustness: Will it handle unexpected input gracefully?
    - Demo quality: Does main() exercise ALL features convincingly?
    - Import consistency: Are all cross-module imports correct?
    - Only list files in files_to_rewrite if they have HIGH severity issues.
    - quality_score is 1-10 (10 = production-ready, 7+ = good prototype).
    - Return ONLY the JSON, no other text.\
""")

SYSTEM_PROMPT_IMPROVE = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer.
    You are IMPROVING an existing module based on a code review.

    You have:
    - The review feedback with specific issues to fix
    - The current code for this module
    - All other project files for context

    Rules:
    - Return ONLY the improved Python code. No markdown fences, no prose.
    - Fix ALL issues identified in the review for this file.
    - Maintain compatibility with other project modules.
    - Do NOT change the module's public interface unless the review says to.
    - Add missing error handling, type hints, docstrings.
    - Improve the demo in main() if this is the entry point.
    - Keep existing working functionality intact.
    - Make the code production-quality.\
""")

SYSTEM_PROMPT_POLISH = textwrap.dedent("""\
    You are MCP, an elite autonomous AI software engineer.
    Generate a polished, professional README.md for this project.

    Return ONLY the README content in markdown (no fences around it).

    Include:
    - Project title and one-line description
    - Features list with bullet points
    - Architecture overview (which files do what)
    - Quick start / usage instructions
    - Example output showing what the program produces
    - Dependencies list
    - Project structure tree
    - Keep it concise but professional — like a real GitHub README.\
""")

SYSTEM_PROMPT_TEST = textwrap.dedent("""\
    You are MCP, an elite autonomous AI test engineer.
    Generate unit tests for the given project.

    Rules:
    - Return ONLY the test code. No markdown fences, no prose.
    - Use Python's built-in unittest module.
    - Import the project modules being tested.
    - Test all public functions and methods.
    - Include edge cases and error cases.
    - Each test method should have a descriptive name.
    - Tests must be runnable with: python -m unittest test_project.py
    - Add setUp/tearDown if needed for database or file cleanup.
    - Mock external dependencies if needed (use unittest.mock).
    - Tests should be independent of each other.
    - Include at least 5 test methods.
    - Do NOT use pytest — only unittest.
    - NEVER use input() or interactive prompts.\
""")


# ─── Request Parsing ─────────────────────────────────────────────


def _parse_request(args: str) -> dict:
    """Parse the user request to determine intent.

    Supports:
    - "edit <filepath> <instructions>" — edit an existing file
    - "fix <filepath>" — fix errors in an existing file
    - "in /path/to/repo <instructions>" — modify an existing repo
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

    # Codebase awareness: "in /path/to/repo <instructions>"
    if args_lower.startswith("in "):
        parts = args[3:].strip().split(" ", 1)
        if len(parts) >= 2:
            repo_path = parts[0]
            instructions = parts[1]
            if os.path.isdir(repo_path):
                return {"mode": "repo", "repo_path": repo_path, "instructions": instructions}

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
            "frontend", "dashboard", "system", "platform", "service",
            "engine", "game", "framework", "toolkit", "suite", "manager",
            "tracker", "monitor", "panel", "portal", "store",
            "inventory", "crm", "erp", "cms", "blog",
            "e-commerce", "ecommerce", "marketplace", "business",
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

    provider = _get_ai_provider()
    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        placeholder = "your-anthropic-api-key-here"
        env_hint = "ANTHROPIC_API_KEY"
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        placeholder = "your-openai-api-key-here"
        env_hint = "OPENAI_API_KEY"

    if not api_key or api_key == placeholder:
        return {
            "message": f"AI not configured. Set {env_hint} in .env for agentic coding.",
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
        elif request["mode"] == "repo":
            return await _handle_repo(request, api_key, has_vscode)
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


# ─── Codebase Awareness: Modify Existing Repo ───────────────────


async def _handle_repo(
    request: dict, api_key: str, has_vscode: bool
) -> dict:
    """Modify an existing repository based on user instructions.

    Scans the repo structure, reads relevant files, then asks AI to generate
    changes (new files or modifications) that integrate with the existing codebase.
    """
    repo_path = request["repo_path"]
    instructions = request["instructions"]

    # Phase 1: Scan the repo
    repo_label = os.path.basename(repo_path) or "repo"
    _emit_progress(repo_label, "Scan", "Scanning repository structure...", 0.1)
    repo_context = _build_repo_context(repo_path)

    # Phase 2: Optional web research for unfamiliar topics
    research = ""
    research_keywords = [
        "library", "api", "framework", "sdk", "package",
        "integration", "oauth", "graphql", "websocket",
    ]
    if any(kw in instructions.lower() for kw in research_keywords):
        _emit_progress(repo_label, "Research", "Researching documentation...", 0.2)
        research = await _web_research(f"{instructions} programming tutorial")

    # Phase 3: Ask AI to plan the changes
    _emit_progress(repo_label, "Plan", "Planning changes to repository...", 0.3)
    plan_prompt = f"""\
You are modifying an EXISTING codebase. Here is the repository structure and
key file contents:

{repo_context}

{f"Relevant documentation:{chr(10)}{research}{chr(10)}" if research else ""}
User request: {instructions}

Produce a JSON array of file operations. Each element must be an object with:
  "path": relative file path (e.g. "src/utils/auth.py"),
  "action": "create" | "modify",
  "content": the COMPLETE file content (for modify, the full new file content)

Return ONLY the JSON array. No markdown fences, no prose.
"""
    plan_raw = await _call_ai(
        [{"role": "user", "content": plan_prompt}],
        api_key,
        max_tokens=4000,
        use_heavy_model=True,
    )
    plan_raw = _strip_markdown_fences(plan_raw)

    # Phase 4: Parse and apply changes
    _emit_progress(repo_label, "Apply", "Applying changes...", 0.6)
    try:
        changes = json.loads(plan_raw)
    except json.JSONDecodeError:
        # Try to extract JSON array from the response
        match = re.search(r"\[.*\]", plan_raw, re.DOTALL)
        if match:
            try:
                changes = json.loads(match.group(0))
            except json.JSONDecodeError:
                return {
                    "message": "Failed to parse AI change plan.",
                    "data": {"raw_plan": plan_raw[:2000], "status": "error"},
                }
        else:
            return {
                "message": "Failed to parse AI change plan.",
                "data": {"raw_plan": plan_raw[:2000], "status": "error"},
            }

    files_changed: list[str] = []
    files_created: list[str] = []

    for change in changes:
        if not isinstance(change, dict):
            continue
        rel_path = change.get("path", "")
        action = change.get("action", "create")
        content = change.get("content", "")
        if not rel_path or not content:
            continue

        abs_path = os.path.join(repo_path, rel_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)

        if action == "modify" and os.path.exists(abs_path):
            files_changed.append(rel_path)
        else:
            files_created.append(rel_path)

        with open(abs_path, "w") as f:
            f.write(content)

    # Phase 5: Try to run the entry point to verify
    entry_candidates = ["main.py", "app.py", "index.js", "main.go", "main.rs", "Main.java"]
    entry_point = None
    for candidate in entry_candidates:
        full = os.path.join(repo_path, candidate)
        if os.path.exists(full):
            entry_point = full
            break
    # Also check src/ subdirectory
    if not entry_point:
        for candidate in entry_candidates:
            full = os.path.join(repo_path, "src", candidate)
            if os.path.exists(full):
                entry_point = full
                break

    run_result = ""
    if entry_point:
        ext = os.path.splitext(entry_point)[1]
        interpreter_map = {
            ".py": "python3", ".js": "node", ".ts": "npx ts-node",
            ".go": "go run", ".rs": "cargo_run", ".java": "java_compile_run",
        }
        interp = interpreter_map.get(ext, "")
        if interp:
            success, stdout, stderr = _run_code(entry_point, interp)
            if success:
                run_result = f"Verification passed. Output:\n{stdout[:500]}"
            else:
                run_result = f"Verification had errors:\n{stderr[:500]}"

    if has_vscode:
        subprocess.Popen(["code", repo_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    total = len(files_changed) + len(files_created)
    return {
        "message": (
            f"Repository modified: {total} file(s) updated.\n"
            f"Created: {', '.join(files_created) if files_created else 'none'}\n"
            f"Modified: {', '.join(files_changed) if files_changed else 'none'}\n"
            f"{run_result}"
        ),
        "data": {
            "repo_path": repo_path,
            "files_created": files_created,
            "files_changed": files_changed,
            "verification": run_result,
            "status": "completed",
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
    complex_mode = _is_complex(args)
    max_attempts = MAX_FIX_ATTEMPTS if complex_mode else MAX_FIX_ATTEMPTS_SIMPLE
    exec_timeout = EXEC_TIMEOUT if complex_mode else EXEC_TIMEOUT_SIMPLE

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

    # Step 1: Generate initial code (use heavy model for complex requests)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_SINGLE},
        {"role": "user", "content": f"Generate code for: {args}{context}"},
    ]

    token_limit = 8000 if complex_mode else 2500
    raw_code = await _call_ai(messages, api_key, max_tokens=token_limit, use_heavy_model=complex_mode)
    code = _strip_markdown_fences(raw_code)
    ext, interpreter, lang = _detect_language(code, args)

    # Step 2: Auto-install dependencies
    packages = _extract_imports(code, lang)
    filepath = _save_code(code, project_name, ext)
    install_log = _auto_install_deps(packages, lang, os.path.dirname(filepath))

    # Step 3: Run
    success, stdout, stderr = _run_code(filepath, interpreter, timeout=exec_timeout)

    # Step 4: Smart auto-fix loop
    attempt = 1
    while not success and attempt < max_attempts:
        attempt += 1

        # Check if it's a missing module error
        if "ModuleNotFoundError" in stderr or "Cannot find module" in stderr:
            mod_match = re.search(r"No module named '(\w+)'", stderr)
            if mod_match:
                dep_log = _auto_install_deps([mod_match.group(1)], lang, os.path.dirname(filepath))
                if dep_log:
                    install_log += "; " + dep_log if install_log else dep_log
                success, stdout, stderr = _run_code(filepath, interpreter, timeout=exec_timeout)
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

        raw_fix = await _call_ai(fix_messages, api_key, use_heavy_model=complex_mode)
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
        success, stdout, stderr = _run_code(filepath, interpreter, timeout=exec_timeout)

    # Record in memory
    _add_to_memory(args, filepath, lang, success)

    # Open in VSCode
    if has_vscode:
        try:
            subprocess.Popen(["code", filepath], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    provider = _get_ai_provider()
    if provider == "anthropic":
        model_used = "claude-sonnet-4-20250514" if complex_mode else "claude-haiku-4-5-20251001"
    else:
        model_used = "gpt-4o" if complex_mode else "gpt-4o-mini"
    if success:
        msg = (
            f"Code assimilated for: {args}. "
            f"Compiled successfully in {attempt} attempt(s). "
            f"Model: {model_used}. Saved to {filepath}"
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
            "model": model_used,
            "complex_mode": complex_mode,
            "output": stdout[:2000] if stdout else "",
            "final_error": stderr[:1000] if stderr and not success else "",
            "generated_code": code,
            "deps_installed": install_log,
        },
    }


# ─── Iterative Build Helpers ─────────────────────────────────────


async def _generate_detailed_plan(
    args: str, api_key: str
) -> dict | None:
    """Phase 1: Generate a detailed architecture plan with build order.

    Includes web research for requests that mention unfamiliar libraries,
    APIs, or frameworks so the AI has documentation context.
    """
    # Web research: look up docs for any mentioned libraries/frameworks
    research_context = ""
    research_keywords = [
        "library", "api", "framework", "sdk", "package", "integration",
        "oauth", "graphql", "websocket", "redis", "kafka", "docker",
        "kubernetes", "aws", "azure", "gcp", "firebase", "supabase",
        "stripe", "twilio", "sendgrid", "tensorflow", "pytorch", "react",
        "vue", "angular", "svelte", "django", "flask", "fastapi", "express",
        "next.js", "nest.js", "spring", "gin", "fiber", "actix", "rocket",
    ]
    if any(kw in args.lower() for kw in research_keywords):
        research_context = await _web_research(
            f"{args} programming tutorial documentation"
        )

    plan_messages = [
        {"role": "system", "content": SYSTEM_PROMPT_PLAN},
        {"role": "user", "content": (
            f"Plan the architecture for: {args}"
            + (f"\n\nRelevant documentation from web research:\n{research_context}"
               if research_context else "")
        )},
    ]
    raw_plan = await _call_ai(
        plan_messages, api_key, max_tokens=3000, use_heavy_model=True
    )

    # Strip markdown fences before parsing
    cleaned = _strip_markdown_fences(raw_plan).strip()

    # Try multiple JSON extraction strategies
    plan_data = None
    for candidate in [
        cleaned,  # full response
        raw_plan,  # original
    ]:
        try:
            json_match = re.search(r"\{[\s\S]*\}", candidate)
            if json_match:
                plan_data = json.loads(json_match.group())
                break
        except (json.JSONDecodeError, AttributeError):
            continue

    if plan_data is None:
        return None

    # Ensure build_order exists
    if "build_order" not in plan_data:
        # Derive from components
        components = plan_data.get("components", [])
        plan_data["build_order"] = [
            c["file"] for c in components if "file" in c
        ]
        # Ensure entry point is last
        entry = plan_data.get("entry_point", "main.py")
        if entry in plan_data["build_order"]:
            plan_data["build_order"].remove(entry)
        plan_data["build_order"].append(entry)

    # Validate build_order has entries
    if not plan_data.get("build_order"):
        plan_data["build_order"] = ["main.py"]

    return plan_data


async def _build_single_module(
    module_file: str,
    module_spec: str,
    plan_data: dict,
    built_modules: dict[str, str],
    args: str,
    api_key: str,
) -> str:
    """Phase 2: Generate a single module with full context of plan and built modules."""
    # Build context of already-built modules using AST signatures (improvement #5)
    built_context = ""
    if built_modules:
        built_context = "\n\nAlready built modules (API signatures):\n"
        for path, code in built_modules.items():
            signatures = _extract_signatures(code)
            built_context += f"\n--- {path} ---\n{signatures}\n"

    plan_summary = (
        f"Project: {args}\n"
        f"Architecture: {plan_data.get('architecture', 'N/A')}\n"
        f"Components: {json.dumps(plan_data.get('components', []))}\n"
        f"Data models: {json.dumps(plan_data.get('data_models', []))}\n"
        f"Design patterns: {plan_data.get('design_patterns', [])}\n"
        f"Dependencies: {plan_data.get('dependencies', [])}\n"
        f"All files: {plan_data.get('build_order', [])}\n"
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_MODULE},
        {"role": "user", "content": (
            f"{plan_summary}\n"
            f"NOW BUILD THIS MODULE: {module_file}\n"
            f"Module specification: {module_spec}\n"
            f"{built_context}\n"
            f"Return ONLY the complete Python code for {module_file}."
        )},
    ]

    # Use higher token limit for entry points which tend to be larger
    is_entry = module_file == plan_data.get("entry_point", "main.py")
    token_limit = 6000 if is_entry else 4000
    raw_code = await _call_ai(
        messages, api_key, max_tokens=token_limit, use_heavy_model=True
    )
    code = _strip_markdown_fences(raw_code)

    # Guard: if the AI returned JSON instead of raw code, extract the content
    if code.lstrip().startswith("{") and '"content"' in code:
        try:
            data = json.loads(code)
            if isinstance(data, dict) and "content" in data:
                return data["content"]
        except json.JSONDecodeError:
            # Try to extract the content field value
            cm = re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', code, re.DOTALL)
            if cm:
                try:
                    return json.loads('"' + cm.group(1) + '"')
                except json.JSONDecodeError:
                    pass

    return code


async def _review_project(
    project_dir: str, args: str, api_key: str
) -> dict | None:
    """Phase 4: AI reviews the entire project and returns improvement suggestions."""
    project_code = _read_project_files(project_dir)
    if not project_code:
        return None

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_REVIEW},
        {"role": "user", "content": (
            f"Project: {args}\n\n"
            f"Full project source code:\n{project_code}\n\n"
            f"Review this project and identify improvements."
        )},
    ]

    raw_review = await _call_ai(
        messages, api_key, max_tokens=3000, use_heavy_model=True
    )
    try:
        review_match = re.search(r"\{[\s\S]*\}", raw_review)
        if review_match:
            return json.loads(review_match.group())
    except (json.JSONDecodeError, AttributeError):
        pass
    return None


async def _improve_module(
    file_path: str,
    review_data: dict,
    project_dir: str,
    args: str,
    api_key: str,
) -> str:
    """Phase 4b: Improve a specific module based on review feedback."""
    with open(file_path) as f:
        current_code = f.read()

    rel_path = os.path.relpath(file_path, project_dir)

    # Gather review issues for this file
    file_issues = [
        i for i in review_data.get("issues", [])
        if i.get("file") == rel_path or i.get("file") == os.path.basename(file_path)
    ]
    file_improvements = [
        i for i in review_data.get("improvements", [])
        if i.get("file") == rel_path or i.get("file") == os.path.basename(file_path)
    ]

    if not file_issues and not file_improvements:
        return current_code  # Nothing to improve

    project_context = _read_project_files(project_dir)

    feedback = "Issues to fix:\n"
    for issue in file_issues:
        feedback += f"- [{issue.get('severity', 'medium')}] {issue.get('issue', '')}: {issue.get('fix', '')}\n"
    feedback += "\nImprovements to apply:\n"
    for imp in file_improvements:
        feedback += f"- [{imp.get('priority', 'medium')}] {imp.get('description', '')}\n"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_IMPROVE},
        {"role": "user", "content": (
            f"Project: {args}\n\n"
            f"Review feedback for {rel_path}:\n{feedback}\n\n"
            f"Current code:\n```\n{current_code}\n```\n\n"
            f"Other project files for context:\n{project_context}\n\n"
            f"Return the improved version of {rel_path}."
        )},
    ]

    raw_improved = await _call_ai(
        messages, api_key, max_tokens=4000, use_heavy_model=True
    )
    return _strip_markdown_fences(raw_improved)


async def _generate_readme(
    project_dir: str, args: str, output_sample: str, api_key: str
) -> str:
    """Phase 5: Generate a polished README.md."""
    project_code = _read_project_files(project_dir)
    file_list = []
    for root, _dirs, files in os.walk(project_dir):
        for fname in sorted(files):
            if not fname.startswith(".") and "__pycache__" not in root:
                rel = os.path.relpath(os.path.join(root, fname), project_dir)
                file_list.append(rel)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_POLISH},
        {"role": "user", "content": (
            f"Project: {args}\n"
            f"Files: {file_list}\n\n"
            f"Source code:\n{project_code[:8000]}\n\n"
            f"Example output when running main.py:\n{output_sample[:2000]}\n\n"
            f"Generate a professional README.md."
        )},
    ]

    raw_readme = await _call_ai(
        messages, api_key, max_tokens=2000, use_heavy_model=False
    )
    return _strip_markdown_fences(raw_readme)


def _cross_file_fix_loop(
    entry_path: str,
    interpreter: str,
    project_dir: str,
    file_list: list[str],
    packages: list[str],
    lang: str,
    exec_timeout: int,
    install_log: str,
) -> tuple[bool, str, str, str]:
    """Synchronous portion of the cross-file fix loop (deps + detect error file).

    Returns (run_success, output, error, install_log).
    """
    run_success, output, error = _run_code(entry_path, interpreter, timeout=exec_timeout)

    if run_success:
        return run_success, output, error, install_log

    # Try installing missing module
    if "ModuleNotFoundError" in error:
        mod_match = re.search(r"No module named '(\w+)'", error)
        if mod_match:
            dep_log = _auto_install_deps([mod_match.group(1)], lang, project_dir)
            if dep_log:
                install_log += "; " + dep_log if install_log else dep_log
            run_success, output, error = _run_code(entry_path, interpreter, timeout=exec_timeout)

    return run_success, output, error, install_log


async def _generate_tests(
    project_dir: str, args: str, api_key: str
) -> tuple[str, bool, str]:
    """Phase 5.5: Generate and run unit tests.

    Returns (test_file_path, tests_passed, test_output).
    """
    project_code = _read_project_files(project_dir)
    if not project_code:
        return "", False, "No project code to test"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_TEST},
        {"role": "user", "content": (
            f"Project: {args}\n\n"
            f"Project source code:\n{project_code}\n\n"
            f"Generate comprehensive unit tests for this project."
        )},
    ]

    raw_tests = await _call_ai(
        messages, api_key, max_tokens=4000, use_heavy_model=True
    )
    test_code = _strip_markdown_fences(raw_tests)

    test_path = os.path.join(project_dir, "test_project.py")
    with open(test_path, "w") as f:
        f.write(test_code)

    # Run tests with unittest
    try:
        result = subprocess.run(
            ["python3", "-m", "unittest", test_path, "-v"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=project_dir,
        )
        passed = result.returncode == 0
        output = (result.stdout[:2000] + "\n" + result.stderr[:1000]).strip()
        return test_path, passed, output
    except subprocess.TimeoutExpired:
        return test_path, False, "Tests timed out (60s)"
    except Exception as e:
        return test_path, False, f"Test execution failed: {e}"


async def _build_modules_parallel(
    build_order: list[str],
    component_specs: dict[str, str],
    plan_data: dict,
    project_dir: str,
    args: str,
    api_key: str,
    project_name: str,
) -> tuple[dict[str, str], list[str]]:
    """Build modules in parallel tiers for speed.

    Splits the build order into tiers:
      Tier 0: first half of modules (foundations — typically independent)
      Tier 1: second half of modules (services — may depend on foundations)
      Tier 2: entry point (main.py — depends on everything)

    Modules within a tier are built concurrently with asyncio.gather.
    Each tier gets the context (signatures) of all previously-built tiers.
    """
    built_modules: dict[str, str] = {}
    file_list: list[str] = []
    entry_point = plan_data.get("entry_point", "main.py")

    # Split into tiers
    non_entry = [f for f in build_order if f != entry_point]
    split = max(1, len(non_entry) // 2)
    tiers = [non_entry[:split], non_entry[split:]]
    if entry_point in build_order:
        tiers.append([entry_point])

    for tier_idx, tier in enumerate(tiers):
        if not tier:
            continue

        _emit_progress(
            project_name, "Phase 2",
            f"Building tier {tier_idx + 1}/{len(tiers)} ({len(tier)} modules: {', '.join(tier)})...",
            0.15 + (tier_idx * 0.15),
        )

        # Snapshot context for this tier (modules from previous tiers only)
        tier_context = dict(built_modules)

        async def _build_one(module_file: str, ctx: dict[str, str]) -> tuple[str, str]:
            spec = component_specs.get(module_file, f"Module: {module_file}")
            code = await _build_single_module(
                module_file, spec, plan_data, ctx, args, api_key
            )
            return module_file, code

        tasks = [_build_one(mf, tier_context) for mf in tier]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, BaseException):
                continue
            module_file, module_code = result

            safe_path = os.path.normpath(module_file).lstrip("/").lstrip("../")
            filepath = os.path.join(project_dir, safe_path)
            if not filepath.startswith(project_dir):
                continue
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, "w") as f:
                f.write(module_code)

            built_modules[module_file] = module_code
            file_list.append(module_file)

    return built_modules, file_list


# ─── Multi-File Project (Iterative Devin-like Pipeline) ─────────


_MAX_PIPELINE_PASSES = 5  # Upgrade #4: max full-pipeline iterations


async def _handle_project(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
) -> dict:
    """Generate a multi-file project using an iterative Devin-like pipeline.

    Upgrade #4 — Long-running iteration: wraps the entire pipeline in a
    multi-pass loop.  If the code still has errors after a full pass, the
    pipeline re-runs (re-plan, re-build, re-test) up to _MAX_PIPELINE_PASSES.

    Enhanced 6-phase process for complex projects:
      Phase 1:   Deep architecture planning with module specs and build order
      Phase 2:   Parallel tiered module building (each tier with full context)
      Phase 3:   Integration testing and cross-file error fixing
      Phase 4:   Self-review & improvement with rollback safety net
      Phase 5:   Quality gate — retry review+improve if score < 5
      Phase 5.5: Auto-generate and run unit tests
      Phase 6:   Polish — generate README, improve demo output
      Git:       Auto-init repo, commit after each phase
      SSE:       Emit progress events for real-time streaming
      Multi-pass: Re-run full pipeline if code still fails (up to 5 passes)
    """
    complex_mode = _is_complex(args)
    max_fix = MAX_FIX_ATTEMPTS if complex_mode else MAX_FIX_ATTEMPTS_SIMPLE
    exec_timeout = EXEC_TIMEOUT if complex_mode else EXEC_TIMEOUT_SIMPLE

    # Upgrade #4: track iteration history across passes
    iteration_history: list[dict] = []
    max_passes = _MAX_PIPELINE_PASSES if complex_mode else 1

    for pipeline_pass in range(1, max_passes + 1):
        pass_label = f"Pass {pipeline_pass}/{max_passes}"
        _emit_progress(project_name, "Init", f"Starting iterative pipeline ({pass_label})...", 0.0)

        result = await _run_single_pipeline_pass(
            args, api_key, project_name, has_vscode,
            complex_mode, max_fix, exec_timeout,
            pipeline_pass, max_passes, iteration_history,
        )

        # Track this pass
        pass_status = result.get("data", {}).get("status", "error")
        iteration_history.append({
            "pass": pipeline_pass,
            "status": pass_status,
            "quality_score": result.get("data", {}).get("quality_score", "N/A"),
            "file_count": result.get("data", {}).get("file_count", 0),
        })

        # If code runs successfully or we've exhausted passes, return
        if pass_status == "success" or pipeline_pass >= max_passes:
            # Append iteration history to result
            result["data"]["iteration_history"] = iteration_history
            result["data"]["total_passes"] = pipeline_pass
            if pipeline_pass > 1:
                result["message"] = (
                    f"[{pipeline_pass} pipeline passes] " + result["message"]
                )
            return result

        # Code didn't work — clean up and retry
        _emit_progress(
            project_name, "Retry",
            f"Pass {pipeline_pass} had issues — starting pass {pipeline_pass + 1}…",
            0.0,
        )
        # Clean the project directory for a fresh attempt
        project_dir = os.path.join(OUTPUT_BASE, project_name)
        if os.path.isdir(project_dir):
            shutil.rmtree(project_dir)

    # Should not reach here, but safety return
    return result  # type: ignore[possibly-undefined]


async def _run_single_pipeline_pass(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
    complex_mode: bool,
    max_fix: int,
    exec_timeout: int,
    pipeline_pass: int,
    max_passes: int,
    iteration_history: list[dict],
) -> dict:
    """Execute one full pipeline pass (Phases 1-6).

    Separated from _handle_project to support multi-pass iteration.
    """
    pass_label = f"Pass {pipeline_pass}/{max_passes}"

    # ────────────────────────────────────────────────────────────
    # PHASE 1: Architecture Planning
    # ────────────────────────────────────────────────────────────
    _emit_progress(project_name, "Phase 1", f"Generating architecture plan… ({pass_label})", 0.05)
    plan_data = None

    # Always generate an architecture plan for project mode.
    # complex_mode only controls intensity (passes, timeouts), not planning.
    extra_context = ""
    if iteration_history:
        last = iteration_history[-1]
        extra_context = (
            f"\nPREVIOUS ATTEMPT FAILED (pass {last['pass']}). "
            f"Status: {last['status']}. "
            f"Improve the architecture to avoid the same issues."
        )
    if extra_context:
        plan_data = await _generate_detailed_plan(
            args + extra_context, api_key
        )
    else:
        plan_data = await _generate_detailed_plan(args, api_key)

    # If planning failed, fall back to one-shot generation
    if not plan_data or not plan_data.get("build_order"):
        return await _handle_project_oneshot(args, api_key, project_name, has_vscode, plan_data)

    project_dir = os.path.join(OUTPUT_BASE, project_name)
    os.makedirs(project_dir, exist_ok=True)

    # Enhancement #8: Git integration — init repo
    _git_init_and_commit(project_dir, "Initial commit (empty project)")
    _emit_progress(project_name, "Phase 1", "Architecture plan complete.", 0.10)

    # Build component spec lookup
    component_specs: dict[str, str] = {}
    for comp in plan_data.get("components", []):
        fpath = comp.get("file", "")
        component_specs[fpath] = (
            f"{comp.get('name', '')}: {comp.get('responsibility', '')}"
        )

    build_order = plan_data["build_order"]
    entry_point = plan_data.get("entry_point", "main.py")

    # Ensure config files (requirements.txt, __init__.py) are generated
    config_files = ["requirements.txt", "config.py", "__init__.py"]
    for cf in config_files:
        if cf not in build_order and any(
            cf == comp.get("file") for comp in plan_data.get("components", [])
        ):
            build_order.insert(0, cf)

    # Git commit after Phase 1
    _git_init_and_commit(project_dir, "Phase 1: Architecture plan")

    # ────────────────────────────────────────────────────────────
    # PHASE 2: Parallel Tiered Module Building  (Enhancement #4)
    # ────────────────────────────────────────────────────────────
    _emit_progress(project_name, "Phase 2", "Building modules in parallel tiers...", 0.15)

    built_modules, file_list = await _build_modules_parallel(
        build_order, component_specs, plan_data,
        project_dir, args, api_key, project_name,
    )

    # Generate requirements.txt if not already built
    if "requirements.txt" not in file_list:
        deps = plan_data.get("dependencies", [])
        if deps:
            req_path = os.path.join(project_dir, "requirements.txt")
            with open(req_path, "w") as f:
                f.write("\n".join(deps))
            file_list.append("requirements.txt")

    _emit_progress(project_name, "Phase 2", f"Built {len(file_list)} modules.", 0.45)
    # Git commit after Phase 2
    _git_init_and_commit(project_dir, f"Phase 2: Built {len(file_list)} modules")

    # ────────────────────────────────────────────────────────────
    # PHASE 3: Integration Testing & Cross-File Fixing
    # ────────────────────────────────────────────────────────────
    _emit_progress(project_name, "Phase 3", "Running integration tests...", 0.50)

    entry_path = os.path.join(project_dir, entry_point)
    if not os.path.exists(entry_path):
        for candidate in ["main.py", "app.py", "index.py"]:
            cp = os.path.join(project_dir, candidate)
            if os.path.exists(cp):
                entry_path = cp
                break

    output = ""
    error = ""
    run_success = False
    lang = "python"
    install_log = ""
    interpreter = "python3"

    if os.path.exists(entry_path):
        with open(entry_path) as f:
            entry_code = f.read()
        ext, interpreter, lang = _detect_language(entry_code, args)

        # Enhancement #2: Auto-install deps with local module filtering
        all_code = _read_project_files(project_dir)
        packages = _extract_imports(all_code, lang, project_dir)
        install_log = _auto_install_deps(packages, lang, project_dir)

        # Initial run
        run_success, output, error, install_log = _cross_file_fix_loop(
            entry_path, interpreter, project_dir, file_list,
            packages, lang, exec_timeout, install_log,
        )

        # Cross-file-aware auto-fix loop
        fix_attempt = 0
        while not run_success and fix_attempt < max_fix:
            fix_attempt += 1
            _emit_progress(
                project_name, "Phase 3",
                f"Fix attempt {fix_attempt}/{max_fix}...",
                0.50 + (fix_attempt * 0.02),
            )

            project_context = _read_project_files(project_dir)

            error_file = entry_path
            error_match = re.search(r'File "([^"]+)", line \d+', error)
            if error_match:
                matched_path = error_match.group(1)
                if matched_path.startswith(project_dir):
                    error_file = matched_path

            with open(error_file) as f:
                current_code = f.read()

            fix_messages = [
                {"role": "system", "content": SYSTEM_PROMPT_FIX},
                {"role": "user", "content": (
                    f"Project: {args}\n"
                    f"Files in project: {file_list}\n\n"
                    f"ALL project files for context:\n{project_context}\n\n"
                    f"File with error ({os.path.relpath(error_file, project_dir)}):\n"
                    f"```\n{current_code}\n```\n\n"
                    f"Error:\n```\n{error}\n```\n\n"
                    f"Fix ONLY the file that has the error. Return the complete fixed file. "
                    f"The fix must be compatible with all other project files."
                )},
            ]
            raw_fix = await _call_ai(
                fix_messages, api_key, max_tokens=4000, use_heavy_model=complex_mode
            )
            fixed_code = _strip_markdown_fences(raw_fix)
            with open(error_file, "w") as f:
                f.write(fixed_code)

            # Enhancement #2: local module filtering for newly-extracted imports
            new_packages = _extract_imports(fixed_code, lang, project_dir)
            new_deps = [p for p in new_packages if p not in packages]
            if new_deps:
                dep_log = _auto_install_deps(new_deps, lang, project_dir)
                if dep_log:
                    install_log += "; " + dep_log if install_log else dep_log
                packages.extend(new_deps)

            run_success, output, error = _run_code(
                entry_path, interpreter, timeout=exec_timeout
            )

    _emit_progress(
        project_name, "Phase 3",
        f"Integration testing {'passed' if run_success else 'completed with issues'}.",
        0.60,
    )
    # Git commit after Phase 3
    _git_init_and_commit(project_dir, f"Phase 3: Integration testing ({'pass' if run_success else 'issues'})")

    # ────────────────────────────────────────────────────────────
    # PHASE 4: Self-Review & Improvement  (Enhancement #1: rollback)
    # ────────────────────────────────────────────────────────────
    review_data = None
    quality_score = 0
    review_round = 0
    max_review_rounds = 2  # Enhancement #6: quality gate allows up to 2 rounds

    if complex_mode:
        while review_round < max_review_rounds:
            review_round += 1
            _emit_progress(
                project_name, "Phase 4",
                f"Self-review round {review_round}...",
                0.62 + (review_round * 0.05),
            )

            review_data = await _review_project(project_dir, args, api_key)
            if not review_data:
                break

            quality_score = review_data.get("quality_score", 0)
            files_to_rewrite = review_data.get("files_to_rewrite", [])

            # Enhancement #6: quality gate — skip improvement if score >= 5
            if quality_score >= 5 and review_round > 1:
                _emit_progress(
                    project_name, "Phase 4",
                    f"Quality score {quality_score}/10 — above threshold, skipping re-improvement.",
                    0.72,
                )
                break

            if not files_to_rewrite:
                break

            # Enhancement #1: Rollback safety net — backup before Phase 4 rewrites
            backup_dir = project_dir + ".backup"
            try:
                if os.path.exists(backup_dir):
                    shutil.rmtree(backup_dir)
                shutil.copytree(project_dir, backup_dir)
            except Exception:
                backup_dir = ""  # skip rollback if backup failed

            # Improve modules that need it (limit to 5 per round)
            improved_count = 0
            for rewrite_file in files_to_rewrite[:5]:
                rewrite_path = os.path.join(project_dir, rewrite_file)
                if not os.path.exists(rewrite_path):
                    for root, _dirs, files in os.walk(project_dir):
                        if rewrite_file in files:
                            rewrite_path = os.path.join(root, rewrite_file)
                            break

                if os.path.exists(rewrite_path):
                    improved_code = await _improve_module(
                        rewrite_path, review_data, project_dir, args, api_key
                    )
                    with open(rewrite_path, "w") as f:
                        f.write(improved_code)
                    improved_count += 1

            # Re-run after improvements to check if rewrites broke code
            rewrite_broke_code = False
            if improved_count > 0 and os.path.exists(entry_path):
                run_success_after, output_after, error_after = _run_code(
                    entry_path, interpreter, timeout=exec_timeout
                )

                if not run_success_after:
                    # Enhancement #1: Rollback if rewrites broke previously-working code
                    if backup_dir and os.path.isdir(backup_dir):
                        _emit_progress(
                            project_name, "Phase 4",
                            "Rewrite broke code — rolling back to backup...",
                            0.70,
                        )
                        try:
                            shutil.rmtree(project_dir)
                            shutil.copytree(backup_dir, project_dir)
                            rewrite_broke_code = True
                            # Restore previous run state
                            run_success_after, output_after, error_after = _run_code(
                                entry_path, interpreter, timeout=exec_timeout
                            )
                        except Exception:
                            pass  # rollback failed, keep broken state

                output = output_after
                error = error_after
                run_success = run_success_after

            # Cleanup backup
            if backup_dir and os.path.isdir(backup_dir):
                try:
                    shutil.rmtree(backup_dir)
                except Exception:
                    pass

            if rewrite_broke_code:
                _emit_progress(
                    project_name, "Phase 4",
                    "Rolled back — skipping further improvements.",
                    0.72,
                )
                break

            # Enhancement #6: quality gate — if score < 5, loop for another round
            if quality_score >= 5:
                break

    _emit_progress(
        project_name, "Phase 4",
        f"Review complete (score: {quality_score}/10).",
        0.75,
    )
    # Git commit after Phase 4
    _git_init_and_commit(project_dir, f"Phase 4: Self-review (score: {quality_score}/10)")

    # ────────────────────────────────────────────────────────────
    # PHASE 5.5: Test Generation  (Enhancement #7)
    # ────────────────────────────────────────────────────────────
    test_path = ""
    tests_passed = False
    test_output = ""
    if complex_mode:
        _emit_progress(project_name, "Phase 5.5", "Generating unit tests...", 0.78)
        test_path, tests_passed, test_output = await _generate_tests(
            project_dir, args, api_key
        )
        if test_path:
            if "test_project.py" not in file_list:
                file_list.append("test_project.py")
        _emit_progress(
            project_name, "Phase 5.5",
            f"Tests {'passed' if tests_passed else 'generated (some failures)'}.",
            0.82,
        )
        # Git commit after Phase 5.5
        _git_init_and_commit(project_dir, f"Phase 5.5: Tests ({'pass' if tests_passed else 'fail'})")

    # ────────────────────────────────────────────────────────────
    # PHASE 6: Polish (README + final touches)
    # ────────────────────────────────────────────────────────────
    if complex_mode:
        _emit_progress(project_name, "Phase 6", "Generating README...", 0.85)
        readme_content = await _generate_readme(
            project_dir, args, output or "", api_key
        )
        readme_path = os.path.join(project_dir, "README.md")
        with open(readme_path, "w") as f:
            f.write(readme_content)
        if "README.md" not in file_list:
            file_list.append("README.md")
        # Git commit after Phase 6
        _git_init_and_commit(project_dir, "Phase 6: README and polish")

    _emit_progress(project_name, "Complete", "Pipeline finished.", 1.0)

    # ────────────────────────────────────────────────────────────
    # Final: Record + Report
    # ────────────────────────────────────────────────────────────
    _add_to_memory(args, project_dir, lang, run_success)

    if has_vscode:
        try:
            subprocess.Popen(
                ["code", project_dir],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    provider = _get_ai_provider()
    if provider == "anthropic":
        model_used = "claude-sonnet-4-20250514" if complex_mode else "claude-haiku-4-5-20251001"
    else:
        model_used = "gpt-4o" if complex_mode else "gpt-4o-mini"

    # Build pipeline summary
    pipeline_phases = ["Architecture Planning", "Parallel Module Build"]
    if run_success or error:
        pipeline_phases.append("Integration Testing")
    if review_data:
        pipeline_phases.append(f"Self-Review (score: {quality_score}/10)")
    if test_path:
        pipeline_phases.append(f"Tests ({'pass' if tests_passed else 'fail'})")
    if complex_mode:
        pipeline_phases.append("Polish & README")

    return {
        "message": (
            f"Project assimilated: {args}. "
            f"{len(file_list)} files generated via iterative pipeline. "
            f"Pipeline: {' → '.join(pipeline_phases)}. "
            f"Model: {model_used}. "
            f"{'Runs successfully.' if run_success else 'Has issues — review output.'}"
        ),
        "data": {
            "request": args,
            "status": "success" if run_success else "partial",
            "project_dir": project_dir,
            "files": file_list,
            "file_count": len(file_list),
            "entry_point": entry_point,
            "model": model_used,
            "complex_mode": complex_mode,
            "pipeline": " → ".join(pipeline_phases),
            "quality_score": quality_score if review_data else "N/A",
            "tests_passed": tests_passed if test_path else "N/A",
            "test_output": test_output[:500] if test_output else "",
            "architecture_plan": plan_data.get("architecture", "") if plan_data else "",
            "output": output[:2000] if output else "",
            "error": error[:1000] if error else "",
            "deps_installed": install_log,
        },
    }


async def _handle_project_oneshot(
    args: str,
    api_key: str,
    project_name: str,
    has_vscode: bool,
    plan_data: dict | None,
) -> dict:
    """Fallback: one-shot project generation (non-complex or planning failed)."""
    complex_mode = _is_complex(args)
    max_fix = MAX_FIX_ATTEMPTS if complex_mode else MAX_FIX_ATTEMPTS_SIMPLE
    exec_timeout = EXEC_TIMEOUT if complex_mode else EXEC_TIMEOUT_SIMPLE

    plan_context = ""
    if plan_data:
        plan_context = (
            f"\n\nArchitecture plan to follow:\n"
            f"Components: {json.dumps(plan_data.get('components', []))}\n"
            f"Data models: {json.dumps(plan_data.get('data_models', []))}\n"
            f"Design patterns: {plan_data.get('design_patterns', [])}\n"
            f"Dependencies: {plan_data.get('dependencies', [])}\n"
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_PROJECT},
        {"role": "user", "content": f"Generate a project for: {args}{plan_context}"},
    ]

    token_limit = 12000 if complex_mode else 4000
    raw_response = await _call_ai(
        messages, api_key, max_tokens=token_limit, use_heavy_model=complex_mode
    )
    project_data = _parse_multi_file(raw_response)

    if not project_data:
        code = _strip_markdown_fences(raw_response)
        ext, interpreter, lang = _detect_language(code, args)
        filepath = _save_code(code, project_name, ext)
        packages = _extract_imports(code, lang, os.path.dirname(filepath))
        install_log = _auto_install_deps(packages, lang, os.path.dirname(filepath))
        success, stdout, stderr = _run_code(filepath, interpreter, timeout=exec_timeout)
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

    project_dir, entry_path = _save_multi_file_project(project_data, project_name)
    file_list = [f["path"] for f in project_data["files"]]

    output = ""
    error = ""
    run_success = False
    lang = "python"
    install_log = ""

    if entry_path:
        with open(entry_path) as f:
            entry_code = f.read()
        ext, interpreter, lang = _detect_language(entry_code, args)

        all_code = _read_project_files(project_dir)
        packages = _extract_imports(all_code, lang, project_dir)
        install_log = _auto_install_deps(packages, lang, project_dir)
        run_success, output, error = _run_code(entry_path, interpreter, timeout=exec_timeout)

        fix_attempt = 0
        while not run_success and fix_attempt < max_fix:
            fix_attempt += 1

            if "ModuleNotFoundError" in error:
                mod_match = re.search(r"No module named '(\w+)'", error)
                if mod_match:
                    dep_log = _auto_install_deps([mod_match.group(1)], lang, project_dir)
                    if dep_log:
                        install_log += "; " + dep_log if install_log else dep_log
                    run_success, output, error = _run_code(entry_path, interpreter, timeout=exec_timeout)
                    if run_success:
                        break

            project_context = _read_project_files(project_dir)
            error_file = entry_path
            error_match = re.search(r'File "([^"]+)", line \d+', error)
            if error_match:
                matched_path = error_match.group(1)
                if matched_path.startswith(project_dir):
                    error_file = matched_path

            with open(error_file) as f:
                current_code = f.read()

            fix_messages = [
                {"role": "system", "content": SYSTEM_PROMPT_FIX},
                {"role": "user", "content": (
                    f"Project: {args}\n"
                    f"Files: {file_list}\n\n"
                    f"ALL project files:\n{project_context}\n\n"
                    f"File with error ({os.path.relpath(error_file, project_dir)}):\n"
                    f"```\n{current_code}\n```\n\n"
                    f"Error:\n```\n{error}\n```\n\n"
                    f"Fix ONLY the file that has the error. Return the complete fixed file."
                )},
            ]
            raw_fix = await _call_ai(
                fix_messages, api_key, max_tokens=4000, use_heavy_model=complex_mode
            )
            fixed_code = _strip_markdown_fences(raw_fix)
            with open(error_file, "w") as f:
                f.write(fixed_code)

            new_packages = _extract_imports(fixed_code, lang, project_dir)
            new_deps = [p for p in new_packages if p not in packages]
            if new_deps:
                dep_log = _auto_install_deps(new_deps, lang, project_dir)
                if dep_log:
                    install_log += "; " + dep_log if install_log else dep_log
                packages.extend(new_deps)

            run_success, output, error = _run_code(entry_path, interpreter, timeout=exec_timeout)

    _add_to_memory(args, project_dir, lang, run_success)

    if has_vscode:
        try:
            subprocess.Popen(["code", project_dir], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    provider = _get_ai_provider()
    if provider == "anthropic":
        model_used = "claude-sonnet-4-20250514" if complex_mode else "claude-haiku-4-5-20251001"
    else:
        model_used = "gpt-4o" if complex_mode else "gpt-4o-mini"

    return {
        "message": (
            f"Project assimilated: {args}. "
            f"{len(file_list)} files generated. "
            f"Model: {model_used}."
        ),
        "data": {
            "request": args,
            "status": "success" if run_success else "partial",
            "project_dir": project_dir,
            "files": file_list,
            "file_count": len(file_list),
            "entry_point": project_data.get("entry_point", ""),
            "model": model_used,
            "complex_mode": complex_mode,
            "architecture_plan": plan_data.get("architecture", "") if plan_data else "",
            "output": output[:2000] if output else "",
            "error": error[:1000] if error else "",
            "deps_installed": install_log,
        },
    }

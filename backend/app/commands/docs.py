"""MCP Documentation Generator - Auto-generate project documentation."""

import os
from pathlib import Path

import httpx


def _get_ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _ai_generate(system_msg: str, user_msg: str, max_tokens: int = 3000) -> str:
    """Call AI to generate documentation."""
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


def _scan_project(path: str) -> dict:
    """Scan a project directory and extract structure info."""
    target = Path(path).expanduser().resolve()
    if not target.exists():
        return {"error": f"Path not found: {path}"}

    skip_dirs = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".tox"}
    code_exts = {".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs", ".rb", ".php", ".html", ".css"}

    structure = {
        "name": target.name,
        "files": [],
        "total_files": 0,
        "total_lines": 0,
        "languages": {},
        "has_readme": False,
        "has_tests": False,
        "has_config": False,
        "config_files": [],
        "code_samples": [],
    }

    config_names = {"package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Makefile", "Dockerfile", ".env.example", "requirements.txt", "setup.py", "setup.cfg"}

    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fname in files:
            fpath = Path(root) / fname
            rel = fpath.relative_to(target)

            if fname.lower() in {"readme.md", "readme.rst", "readme.txt", "readme"}:
                structure["has_readme"] = True

            if "test" in str(rel).lower():
                structure["has_tests"] = True

            if fname in config_names:
                structure["has_config"] = True
                try:
                    structure["config_files"].append({
                        "name": fname,
                        "content": fpath.read_text(errors="replace")[:2000],
                    })
                except Exception:
                    pass

            if fpath.suffix.lower() in code_exts:
                structure["total_files"] += 1
                lang = fpath.suffix.lower().lstrip(".")
                structure["languages"][lang] = structure["languages"].get(lang, 0) + 1

                try:
                    content = fpath.read_text(errors="replace")
                    lines = content.count("\n") + 1
                    structure["total_lines"] += lines
                    structure["files"].append({"path": str(rel), "lines": lines, "lang": lang})

                    if len(structure["code_samples"]) < 5:
                        structure["code_samples"].append({
                            "path": str(rel),
                            "content": content[:3000],
                        })
                except Exception:
                    continue

    structure["files"] = structure["files"][:50]
    return structure


async def handle_docs(args: str) -> dict:
    """Handle 'MCP docs [path]' command.

    Generates comprehensive project documentation.
    """
    if not args:
        return {
            "message": "Documentation generator requires a project path. Usage: MCP docs [path]",
            "data": {
                "status": "awaiting_input",
                "examples": [
                    "MCP docs ~/my-project/",
                    "MCP docs ./src/",
                    "MCP docs ~/repos/my-app",
                ],
            },
        }

    target_path = args.strip()
    if target_path.startswith("~"):
        target_path = os.path.expanduser(target_path)

    project = _scan_project(target_path)
    if "error" in project:
        return {
            "message": f"Documentation failed: {project['error']}",
            "data": {"status": "error"},
        }

    # Build context for AI
    context = f"Project: {project['name']}\n"
    context += f"Files: {project['total_files']}, Lines: {project['total_lines']}\n"
    context += f"Languages: {project['languages']}\n"
    context += f"Has tests: {project['has_tests']}\n\n"

    for cfg in project.get("config_files", [])[:3]:
        context += f"--- {cfg['name']} ---\n{cfg['content'][:1500]}\n\n"

    for sample in project.get("code_samples", [])[:3]:
        context += f"--- {sample['path']} ---\n{sample['content'][:2000]}\n\n"

    file_tree = "\n".join(f"  {f['path']} ({f['lines']} lines)" for f in project["files"][:30])
    context += f"\nFile tree:\n{file_tree}\n"

    system_msg = (
        "You are MCP, a documentation expert. Generate comprehensive, professional documentation "
        "for this project. Include:\n"
        "1. Project overview and purpose\n"
        "2. Architecture and structure\n"
        "3. Installation and setup instructions\n"
        "4. API reference (if applicable)\n"
        "5. Configuration options\n"
        "6. Usage examples\n"
        "7. Contributing guidelines\n\n"
        "Output in clean Markdown format. Be thorough but concise."
    )

    doc_text = await _ai_generate(system_msg, f"Generate documentation for this project:\n\n{context}")

    if not doc_text:
        # Fallback: generate basic documentation from structure
        doc_text = f"# {project['name']}\n\n"
        doc_text += f"## Overview\n\nA project with {project['total_files']} files and {project['total_lines']} lines of code.\n\n"
        doc_text += f"## Languages\n\n"
        for lang, count in project["languages"].items():
            doc_text += f"- **{lang}**: {count} files\n"
        doc_text += f"\n## Structure\n\n```\n{file_tree}\n```\n"

    # Save documentation
    doc_path = os.path.join(target_path, "DOCUMENTATION.md")
    try:
        with open(doc_path, "w") as f:
            f.write(doc_text)
        saved = True
    except Exception:
        doc_path = ""
        saved = False

    return {
        "message": f"Documentation generated for {project['name']}. {project['total_files']} files analyzed.",
        "data": {
            "status": "success",
            "project": project["name"],
            "files_analyzed": project["total_files"],
            "total_lines": project["total_lines"],
            "languages": project["languages"],
            "documentation": doc_text[:5000],
            "saved_to": doc_path if saved else None,
        },
    }

"""MCP Gallery Command - Project showcase and browsing."""

import json
import os
import time
from pathlib import Path


GALLERY_FILE = os.path.expanduser("~/mcp_gallery.json")


def _load_gallery() -> list[dict]:
    """Load gallery data."""
    if os.path.exists(GALLERY_FILE):
        try:
            with open(GALLERY_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_gallery(projects: list[dict]):
    """Save gallery data."""
    with open(GALLERY_FILE, "w") as f:
        json.dump(projects, f, indent=2)


def _scan_generated_projects() -> list[dict]:
    """Scan mcp_generated directory for projects."""
    gen_dir = os.path.expanduser("~/mcp_generated")
    if not os.path.exists(gen_dir):
        return []

    projects = []
    for item in os.listdir(gen_dir):
        project_path = os.path.join(gen_dir, item)
        if os.path.isdir(project_path):
            files = []
            total_lines = 0
            languages = set()

            for root, dirs, fnames in os.walk(project_path):
                dirs[:] = [d for d in dirs if d not in {"node_modules", "__pycache__", ".git", "venv"}]
                for fname in fnames:
                    fpath = os.path.join(root, fname)
                    ext = os.path.splitext(fname)[1].lower()
                    try:
                        with open(fpath) as f:
                            lines = f.read().count("\n") + 1
                        total_lines += lines
                        files.append(fname)

                        lang_map = {".py": "Python", ".js": "JavaScript", ".ts": "TypeScript", ".html": "HTML", ".css": "CSS", ".java": "Java", ".go": "Go", ".rs": "Rust"}
                        if ext in lang_map:
                            languages.add(lang_map[ext])
                    except Exception:
                        continue

            stat = os.stat(project_path)
            projects.append({
                "name": item,
                "path": project_path,
                "files": len(files),
                "lines": total_lines,
                "languages": list(languages),
                "created": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_ctime)),
                "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
            })

    return sorted(projects, key=lambda p: p.get("modified", ""), reverse=True)


async def handle_gallery(args: str) -> dict:
    """Handle 'MCP gallery [action]' command.

    Browse and manage generated projects.
    """
    if not args:
        args = "list"

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action in ("list", "browse", "show"):
        projects = _scan_generated_projects()
        gallery_saved = _load_gallery()

        return {
            "message": f"Project Gallery: {len(projects)} generated projects found.",
            "data": {
                "status": "success",
                "projects": projects[:30],
                "total": len(projects),
                "featured": gallery_saved[:5],
                "gallery_dir": os.path.expanduser("~/mcp_generated"),
            },
        }

    elif action == "feature":
        if not rest:
            return {"message": "Feature requires a project name.", "data": {"status": "error"}}

        gallery = _load_gallery()
        projects = _scan_generated_projects()

        project = next((p for p in projects if p["name"] == rest.strip()), None)
        if not project:
            return {"message": f"Project '{rest}' not found.", "data": {"status": "error"}}

        project["featured"] = True
        project["featured_at"] = time.strftime("%Y-%m-%d %H:%M")

        # Add to gallery if not already there
        if not any(p["name"] == project["name"] for p in gallery):
            gallery.insert(0, project)
            _save_gallery(gallery)

        return {
            "message": f"Project '{rest}' featured in gallery!",
            "data": {"status": "success", "project": project},
        }

    elif action == "details":
        if not rest:
            return {"message": "Details requires a project name.", "data": {"status": "error"}}

        project_path = os.path.join(os.path.expanduser("~/mcp_generated"), rest.strip())
        if not os.path.exists(project_path):
            return {"message": f"Project '{rest}' not found.", "data": {"status": "error"}}

        file_list = []
        for root, dirs, files in os.walk(project_path):
            dirs[:] = [d for d in dirs if d not in {"node_modules", "__pycache__", ".git"}]
            for fname in files:
                fpath = os.path.join(root, fname)
                rel = os.path.relpath(fpath, project_path)
                try:
                    size = os.path.getsize(fpath)
                    file_list.append({"path": rel, "size_kb": round(size / 1024, 1)})
                except Exception:
                    continue

        # Read main files
        previews = {}
        for fname in ["main.py", "app.py", "index.html", "server.js", "README.md"]:
            fpath = os.path.join(project_path, fname)
            if os.path.exists(fpath):
                try:
                    with open(fpath) as f:
                        previews[fname] = f.read()[:3000]
                except Exception:
                    pass

        return {
            "message": f"Project details: {rest} ({len(file_list)} files)",
            "data": {
                "status": "success",
                "name": rest,
                "path": project_path,
                "files": file_list[:50],
                "previews": previews,
                "total_files": len(file_list),
            },
        }

    elif action == "remove":
        if not rest:
            return {"message": "Remove requires a project name.", "data": {"status": "error"}}

        project_path = os.path.join(os.path.expanduser("~/mcp_generated"), rest.strip())
        if os.path.exists(project_path):
            import shutil
            shutil.rmtree(project_path)

            # Remove from gallery
            gallery = _load_gallery()
            gallery = [p for p in gallery if p.get("name") != rest.strip()]
            _save_gallery(gallery)

            return {"message": f"Project '{rest}' removed.", "data": {"status": "success"}}
        return {"message": f"Project '{rest}' not found.", "data": {"status": "error"}}

    return {
        "message": f"Gallery ready. Actions: list, feature, details, remove",
        "data": {"status": "awaiting_input"},
    }

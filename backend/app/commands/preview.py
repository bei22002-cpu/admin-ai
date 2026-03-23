"""MCP Live Preview Command - Serve generated HTML/CSS/JS projects locally."""

import http.server
import os
import threading
from pathlib import Path


# Track running preview servers
_preview_servers: dict[str, dict] = {}
_next_port = 8501


def _find_html_file(project_path: str) -> str | None:
    """Find the main HTML file in a project directory."""
    target = Path(project_path).expanduser().resolve()
    if not target.exists():
        return None

    if target.is_file() and target.suffix == ".html":
        return str(target)

    # Look for index.html first, then any .html file
    for name in ["index.html", "main.html", "app.html"]:
        candidate = target / name
        if candidate.exists():
            return str(candidate)

    # Find first HTML file
    for fpath in target.rglob("*.html"):
        return str(fpath)

    return None


async def handle_preview(args: str) -> dict:
    """Handle 'MCP preview [path]' command.

    Serves HTML/CSS/JS projects on a local dev server for preview.
    """
    global _next_port

    if not args:
        return {
            "message": "Live preview requires a project path. Usage: MCP preview [path]",
            "data": {
                "status": "awaiting_input",
                "active_previews": {k: {"port": v["port"], "path": v["path"]} for k, v in _preview_servers.items()},
                "examples": [
                    "MCP preview ~/mcp_generated/my-website/",
                    "MCP preview index.html",
                    "MCP preview stop",
                    "MCP preview list",
                ],
            },
        }

    args_stripped = args.strip()

    # List active previews
    if args_stripped.lower() == "list":
        active = {k: {"port": v["port"], "path": v["path"], "url": f"http://localhost:{v['port']}"} for k, v in _preview_servers.items()}
        return {
            "message": f"{len(active)} active preview servers.",
            "data": {"status": "success", "previews": active},
        }

    # Stop all previews
    if args_stripped.lower() == "stop":
        stopped = 0
        for key, info in list(_preview_servers.items()):
            try:
                info["server"].shutdown()
                stopped += 1
            except Exception:
                pass
        _preview_servers.clear()
        return {
            "message": f"Stopped {stopped} preview servers.",
            "data": {"status": "success", "stopped": stopped},
        }

    # Resolve path
    target_path = os.path.expanduser(args_stripped)
    if not os.path.exists(target_path):
        # Try in mcp_generated
        gen_path = os.path.join(os.path.expanduser("~/mcp_generated"), args_stripped)
        if os.path.exists(gen_path):
            target_path = gen_path
        else:
            return {
                "message": f"Path not found: {args_stripped}",
                "data": {"status": "error"},
            }

    html_file = _find_html_file(target_path)
    if not html_file:
        return {
            "message": f"No HTML files found in {args_stripped}. Preview only works with HTML/CSS/JS projects.",
            "data": {"status": "error", "path": target_path},
        }

    # Determine serve directory
    serve_dir = os.path.dirname(html_file)
    project_name = os.path.basename(target_path)

    # Check if already serving
    if project_name in _preview_servers:
        port = _preview_servers[project_name]["port"]
        return {
            "message": f"Preview already running at http://localhost:{port}",
            "data": {
                "status": "success",
                "url": f"http://localhost:{port}",
                "port": port,
                "html_file": os.path.basename(html_file),
            },
        }

    # Start HTTP server
    port = _next_port
    _next_port += 1

    try:
        handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=serve_dir, **kw)
        server = http.server.HTTPServer(("0.0.0.0", port), handler)

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        _preview_servers[project_name] = {
            "server": server,
            "port": port,
            "path": serve_dir,
            "html_file": html_file,
            "thread": thread,
        }

        return {
            "message": f"Live preview started at http://localhost:{port}",
            "data": {
                "status": "success",
                "url": f"http://localhost:{port}",
                "port": port,
                "serve_dir": serve_dir,
                "html_file": os.path.basename(html_file),
                "project": project_name,
            },
        }
    except OSError as e:
        return {
            "message": f"Failed to start preview server: {e}",
            "data": {"status": "error", "error": str(e)},
        }

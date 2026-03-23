"""MCP Plugin System - Custom command plugin support."""

import importlib.util
import json
import os
from pathlib import Path


PLUGIN_DIR = os.path.expanduser("~/mcp_plugins")
_loaded_plugins: dict[str, dict] = {}


def _ensure_plugin_dir():
    """Create plugin directory if it doesn't exist."""
    os.makedirs(PLUGIN_DIR, exist_ok=True)
    manifest_path = os.path.join(PLUGIN_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        with open(manifest_path, "w") as f:
            json.dump({"plugins": {}}, f, indent=2)


def _load_plugin(name: str) -> dict | None:
    """Load a plugin by name."""
    plugin_path = os.path.join(PLUGIN_DIR, f"{name}.py")
    if not os.path.exists(plugin_path):
        return None

    try:
        spec = importlib.util.spec_from_file_location(f"mcp_plugin_{name}", plugin_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            plugin_info = {
                "name": name,
                "path": plugin_path,
                "description": getattr(module, "DESCRIPTION", "No description"),
                "version": getattr(module, "VERSION", "1.0"),
                "author": getattr(module, "AUTHOR", "Unknown"),
                "has_handler": hasattr(module, "handle"),
                "module": module,
            }
            _loaded_plugins[name] = plugin_info
            return plugin_info
    except Exception as e:
        return {"name": name, "error": str(e)}
    return None


def _list_plugins() -> list[dict]:
    """List all available plugins."""
    _ensure_plugin_dir()
    plugins = []

    for fname in os.listdir(PLUGIN_DIR):
        if fname.endswith(".py") and not fname.startswith("_"):
            name = fname[:-3]
            plugin_path = os.path.join(PLUGIN_DIR, fname)
            try:
                with open(plugin_path) as f:
                    content = f.read()
                desc = "No description"
                for line in content.split("\n"):
                    if "DESCRIPTION" in line and "=" in line:
                        desc = line.split("=", 1)[1].strip().strip("\"'")
                        break
                plugins.append({
                    "name": name,
                    "path": plugin_path,
                    "description": desc,
                    "loaded": name in _loaded_plugins,
                })
            except Exception:
                plugins.append({"name": name, "path": plugin_path, "description": "Error reading"})

    return plugins


def _create_example_plugin(name: str) -> str:
    """Create an example plugin file."""
    _ensure_plugin_dir()
    plugin_path = os.path.join(PLUGIN_DIR, f"{name}.py")

    template = f'''"""MCP Plugin: {name}

Custom command plugin for MCP Grid.
"""

DESCRIPTION = "{name} plugin - custom MCP command"
VERSION = "1.0"
AUTHOR = "MCP User"


async def handle(args: str) -> dict:
    """Handle the plugin command.

    Args:
        args: Command arguments string

    Returns:
        dict with 'message' and 'data' keys
    """
    if not args:
        return {{
            "message": "{name} plugin ready. Pass arguments to use it.",
            "data": {{"status": "awaiting_input"}},
        }}

    # Your custom logic here
    result = f"Plugin '{name}' executed with args: {{args}}"

    return {{
        "message": result,
        "data": {{
            "status": "success",
            "plugin": "{name}",
            "args": args,
            "output": result,
        }},
    }}
'''

    with open(plugin_path, "w") as f:
        f.write(template)
    return plugin_path


async def handle_plugin(args: str) -> dict:
    """Handle 'MCP plugin [action] [name]' command.

    Actions: list, create, run, info, remove
    """
    if not args:
        return {
            "message": "Plugin system ready. Usage: MCP plugin [action] [name]",
            "data": {
                "status": "awaiting_input",
                "plugin_dir": PLUGIN_DIR,
                "actions": {
                    "list": "List all installed plugins",
                    "create": "Create a new plugin from template",
                    "run": "Execute a plugin command",
                    "info": "Show plugin details",
                    "remove": "Remove a plugin",
                },
                "examples": [
                    "MCP plugin list",
                    "MCP plugin create my-tool",
                    "MCP plugin run my-tool some arguments",
                    "MCP plugin info my-tool",
                ],
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "list":
        plugins = _list_plugins()
        return {
            "message": f"{len(plugins)} plugins found in {PLUGIN_DIR}",
            "data": {
                "status": "success",
                "plugins": plugins,
                "plugin_dir": PLUGIN_DIR,
                "total": len(plugins),
            },
        }

    elif action == "create":
        if not rest:
            return {"message": "Create requires a name. Usage: MCP plugin create [name]", "data": {"status": "error"}}

        name = rest.strip().replace(" ", "_").replace("-", "_").lower()
        path = _create_example_plugin(name)
        return {
            "message": f"Plugin '{name}' created at {path}. Edit the file to add your custom logic.",
            "data": {
                "status": "success",
                "name": name,
                "path": path,
                "plugin_dir": PLUGIN_DIR,
            },
        }

    elif action == "run":
        run_parts = rest.split(None, 1)
        if not run_parts:
            return {"message": "Run requires a plugin name. Usage: MCP plugin run [name] [args]", "data": {"status": "error"}}

        name = run_parts[0].lower()
        plugin_args = run_parts[1] if len(run_parts) > 1 else ""

        plugin = _load_plugin(name)
        if not plugin:
            return {"message": f"Plugin '{name}' not found in {PLUGIN_DIR}", "data": {"status": "error"}}
        if "error" in plugin:
            return {"message": f"Plugin load error: {plugin['error']}", "data": {"status": "error"}}
        if not plugin.get("has_handler"):
            return {"message": f"Plugin '{name}' has no handle() function", "data": {"status": "error"}}

        try:
            result = await plugin["module"].handle(plugin_args)
            return result
        except Exception as e:
            return {"message": f"Plugin execution error: {e}", "data": {"status": "error", "error": str(e)}}

    elif action == "info":
        if not rest:
            return {"message": "Info requires a plugin name.", "data": {"status": "error"}}

        name = rest.strip().lower()
        plugin = _load_plugin(name)
        if not plugin:
            return {"message": f"Plugin '{name}' not found.", "data": {"status": "error"}}

        return {
            "message": f"Plugin: {name} v{plugin.get('version', '?')}",
            "data": {
                "status": "success",
                "name": name,
                "description": plugin.get("description", "N/A"),
                "version": plugin.get("version", "N/A"),
                "author": plugin.get("author", "N/A"),
                "path": plugin.get("path", ""),
            },
        }

    elif action == "remove":
        if not rest:
            return {"message": "Remove requires a plugin name.", "data": {"status": "error"}}

        name = rest.strip().lower()
        plugin_path = os.path.join(PLUGIN_DIR, f"{name}.py")
        if os.path.exists(plugin_path):
            os.unlink(plugin_path)
            _loaded_plugins.pop(name, None)
            return {"message": f"Plugin '{name}' removed.", "data": {"status": "success", "name": name}}
        return {"message": f"Plugin '{name}' not found.", "data": {"status": "error"}}

    return {
        "message": f"Unknown plugin action: '{action}'. Use: list, create, run, info, remove",
        "data": {"status": "error"},
    }

"""MCP Clipboard Manager - Track clipboard history and manage clips."""

import time
import subprocess
import os


# In-memory clipboard history
clipboard_history: list[dict] = []
MAX_HISTORY = 100


def _get_current_clipboard() -> str:
    """Get current clipboard content."""
    try:
        # Try xclip
        result = subprocess.run(
            ["xclip", "-selection", "clipboard", "-o"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout
    except Exception:
        pass

    try:
        # Try xsel
        result = subprocess.run(
            ["xsel", "--clipboard", "--output"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout
    except Exception:
        pass

    try:
        # Try pbpaste (macOS)
        result = subprocess.run(
            ["pbpaste"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout
    except Exception:
        pass

    return ""


def _set_clipboard(text: str) -> bool:
    """Set clipboard content."""
    try:
        process = subprocess.Popen(
            ["xclip", "-selection", "clipboard"],
            stdin=subprocess.PIPE, timeout=5,
        )
        process.communicate(text.encode())
        return process.returncode == 0
    except Exception:
        pass

    try:
        process = subprocess.Popen(
            ["xsel", "--clipboard", "--input"],
            stdin=subprocess.PIPE, timeout=5,
        )
        process.communicate(text.encode())
        return process.returncode == 0
    except Exception:
        pass

    return False


async def handle_clipboard(args: str) -> dict:
    """Handle 'MCP clip [action]' command.

    Actions: history, get, paste, clear, save
    """
    if not args:
        return {
            "message": "Clipboard manager ready. Usage: MCP clip [action]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "history": "Show clipboard history",
                    "get": "Get current clipboard content",
                    "paste N": "Retrieve clip N from history",
                    "save [text]": "Save text to clipboard",
                    "clear": "Clear clipboard history",
                    "search [query]": "Search clipboard history",
                },
                "examples": [
                    "MCP clip history",
                    "MCP clip get",
                    "MCP clip paste 3",
                    "MCP clip save Hello World",
                    "MCP clip search function",
                ],
                "history_count": len(clipboard_history),
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "get":
        content = _get_current_clipboard()
        if content:
            # Add to history
            entry = {
                "id": len(clipboard_history) + 1,
                "content": content[:2000],
                "timestamp": time.time(),
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "source": "clipboard",
            }
            clipboard_history.insert(0, entry)
            if len(clipboard_history) > MAX_HISTORY:
                clipboard_history.pop()

        return {
            "message": f"Clipboard: {content[:100]}..." if len(content) > 100 else f"Clipboard: {content or '(empty)'}",
            "data": {
                "status": "success",
                "content": content[:2000] if content else "(empty)",
                "length": len(content),
            },
        }

    elif action == "history":
        limit = 20
        if rest and rest.isdigit():
            limit = int(rest)

        return {
            "message": f"Clipboard history: {len(clipboard_history)} entries",
            "data": {
                "status": "success",
                "history": clipboard_history[:limit],
                "total": len(clipboard_history),
                "showing": min(limit, len(clipboard_history)),
            },
        }

    elif action == "paste":
        if not rest or not rest.strip().isdigit():
            # Default: paste most recent
            idx = 0
        else:
            idx = int(rest.strip()) - 1

        if idx < 0 or idx >= len(clipboard_history):
            return {
                "message": f"Clip #{idx + 1} not found. History has {len(clipboard_history)} entries.",
                "data": {"status": "error"},
            }

        entry = clipboard_history[idx]
        _set_clipboard(entry["content"])

        return {
            "message": f"Pasted clip #{idx + 1} to clipboard.",
            "data": {
                "status": "success",
                "clip_id": idx + 1,
                "content": entry["content"][:500],
                "from_time": entry.get("time", ""),
            },
        }

    elif action == "save":
        if not rest:
            return {"message": "Save requires text. Usage: MCP clip save [text]", "data": {"status": "error"}}

        _set_clipboard(rest)
        entry = {
            "id": len(clipboard_history) + 1,
            "content": rest[:2000],
            "timestamp": time.time(),
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "manual",
        }
        clipboard_history.insert(0, entry)
        if len(clipboard_history) > MAX_HISTORY:
            clipboard_history.pop()

        return {
            "message": f"Saved to clipboard: {rest[:100]}",
            "data": {"status": "success", "content": rest[:500], "history_count": len(clipboard_history)},
        }

    elif action == "search":
        if not rest:
            return {"message": "Search requires a query. Usage: MCP clip search [query]", "data": {"status": "error"}}

        matches = [
            entry for entry in clipboard_history
            if rest.lower() in entry["content"].lower()
        ]

        return {
            "message": f"Found {len(matches)} clips matching '{rest}'",
            "data": {
                "status": "success",
                "query": rest,
                "matches": matches[:20],
                "total": len(matches),
            },
        }

    elif action == "clear":
        count = len(clipboard_history)
        clipboard_history.clear()
        return {
            "message": f"Clipboard history cleared ({count} entries removed).",
            "data": {"status": "success", "cleared": count},
        }

    return {
        "message": f"Unknown clipboard action: '{action}'. Use: history, get, paste, save, search, clear",
        "data": {"status": "error"},
    }

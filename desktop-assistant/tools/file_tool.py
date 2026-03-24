"""
File management tool - read, write, list, and manage files.
"""

import os
import shutil
from typing import Optional


def read_file(path: str) -> dict:
    """Read a file and return its contents."""
    path = os.path.expanduser(path)
    try:
        if not os.path.exists(path):
            return {"status": "error", "content": f"File not found: {path}"}

        size = os.path.getsize(path)
        if size > 500_000:
            return {"status": "error", "content": f"File too large: {size} bytes (max 500KB)"}

        with open(path, "r", errors="replace") as f:
            content = f.read()

        return {
            "status": "success",
            "content": content,
            "path": path,
            "size": size,
        }
    except Exception as e:
        return {"status": "error", "content": str(e)}


def write_file(path: str, content: str) -> dict:
    """Write content to a file."""
    path = os.path.expanduser(path)
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return {
            "status": "success",
            "message": f"Written {len(content)} chars to {path}",
            "path": path,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def list_dir(path: str = ".") -> dict:
    """List files in a directory."""
    path = os.path.expanduser(path)
    try:
        if not os.path.exists(path):
            return {"status": "error", "entries": [], "message": f"Path not found: {path}"}

        entries = []
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            entry = {
                "name": name,
                "type": "dir" if os.path.isdir(full) else "file",
            }
            if os.path.isfile(full):
                entry["size"] = os.path.getsize(full)
            entries.append(entry)

        return {
            "status": "success",
            "path": path,
            "entries": entries,
            "count": len(entries),
        }
    except Exception as e:
        return {"status": "error", "entries": [], "message": str(e)}


def delete_file(path: str) -> dict:
    """Delete a file or directory."""
    path = os.path.expanduser(path)
    try:
        if not os.path.exists(path):
            return {"status": "error", "message": f"Not found: {path}"}

        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

        return {"status": "success", "message": f"Deleted: {path}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

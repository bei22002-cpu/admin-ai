"""MCP File Management Command - Organize, sort, and manage files."""

import os
import shutil
import time
from collections import defaultdict
from pathlib import Path


# Extension-to-category mapping
CATEGORY_MAP = {
    "images": {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico", ".tiff"},
    "documents": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".xls", ".xlsx", ".ppt", ".pptx", ".csv"},
    "code": {".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".rb", ".php", ".html", ".css", ".scss", ".sql", ".sh", ".yaml", ".yml", ".json", ".toml", ".xml"},
    "archives": {".zip", ".tar", ".gz", ".bz2", ".rar", ".7z", ".xz"},
    "audio": {".mp3", ".wav", ".flac", ".aac", ".ogg", ".wma", ".m4a"},
    "video": {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm"},
    "data": {".db", ".sqlite", ".csv", ".json", ".xml", ".parquet"},
}


def _categorize_file(ext: str) -> str:
    """Get category for a file extension."""
    ext = ext.lower()
    for category, extensions in CATEGORY_MAP.items():
        if ext in extensions:
            return category
    return "other"


def _get_dir_stats(path: str) -> dict:
    """Get directory statistics."""
    target = Path(path).expanduser().resolve()
    if not target.exists():
        return {"error": f"Path not found: {path}"}

    stats = {
        "total_files": 0,
        "total_dirs": 0,
        "total_size_bytes": 0,
        "by_category": defaultdict(lambda: {"count": 0, "size": 0}),
        "largest_files": [],
        "duplicates": [],
    }

    size_map: dict[str, list[str]] = defaultdict(list)
    all_files: list[tuple[str, int]] = []

    for root, dirs, files in os.walk(target):
        stats["total_dirs"] += len(dirs)
        for fname in files:
            fpath = Path(root) / fname
            try:
                size = fpath.stat().st_size
                ext = fpath.suffix.lower()
                category = _categorize_file(ext)

                stats["total_files"] += 1
                stats["total_size_bytes"] += size
                stats["by_category"][category]["count"] += 1
                stats["by_category"][category]["size"] += size

                all_files.append((str(fpath), size))

                # Track potential duplicates by size
                if size > 1024:  # Skip tiny files
                    size_map[f"{size}_{ext}"].append(str(fpath))
            except (OSError, PermissionError):
                continue

    # Top 10 largest files
    all_files.sort(key=lambda x: x[1], reverse=True)
    stats["largest_files"] = [
        {"path": p, "size_mb": round(s / (1024 * 1024), 2)}
        for p, s in all_files[:10]
    ]

    # Potential duplicates (same size + extension)
    stats["duplicates"] = [
        {"files": paths, "size_mb": round(int(key.split("_")[0]) / (1024 * 1024), 2)}
        for key, paths in size_map.items()
        if len(paths) > 1
    ][:10]

    stats["total_size_mb"] = round(stats["total_size_bytes"] / (1024 * 1024), 2)
    stats["by_category"] = dict(stats["by_category"])

    return stats


def _organize_directory(path: str, dry_run: bool = False) -> dict:
    """Organize files in a directory by category."""
    target = Path(path).expanduser().resolve()
    if not target.exists() or not target.is_dir():
        return {"error": f"Not a valid directory: {path}"}

    moved = []
    errors = []

    for item in target.iterdir():
        if item.is_file() and not item.name.startswith("."):
            category = _categorize_file(item.suffix)
            dest_dir = target / category

            if not dry_run:
                dest_dir.mkdir(exist_ok=True)
                dest_path = dest_dir / item.name
                # Handle name conflicts
                counter = 1
                while dest_path.exists():
                    stem = item.stem
                    dest_path = dest_dir / f"{stem}_{counter}{item.suffix}"
                    counter += 1
                try:
                    shutil.move(str(item), str(dest_path))
                    moved.append({"from": item.name, "to": f"{category}/{dest_path.name}"})
                except Exception as e:
                    errors.append({"file": item.name, "error": str(e)})
            else:
                moved.append({"from": item.name, "to": f"{category}/{item.name}"})

    return {
        "moved": moved,
        "errors": errors,
        "total_moved": len(moved),
        "total_errors": len(errors),
        "dry_run": dry_run,
    }


async def handle_filemanage(args: str) -> dict:
    """Handle 'MCP files [action] [path]' command.

    Actions: organize, stats, cleanup, find
    """
    if not args:
        return {
            "message": "File management requires an action. Usage: MCP files [action] [path]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "organize": "Sort files into category folders (images, documents, code, etc.)",
                    "stats": "Show directory statistics (size, file types, duplicates)",
                    "cleanup": "Find and remove empty directories and temp files",
                    "find": "Find files matching a pattern",
                },
                "examples": [
                    "MCP files organize ~/Downloads",
                    "MCP files stats ~/projects",
                    "MCP files cleanup ~/Desktop",
                    "MCP files find *.py ~/projects",
                ],
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    path = parts[1] if len(parts) > 1 else "."

    if action == "organize":
        # Dry run first to show what would happen
        result = _organize_directory(path, dry_run=True)
        if "error" in result:
            return {
                "message": f"Organization failed: {result['error']}",
                "data": {"status": "error", "error": result["error"]},
            }

        # Actually organize
        result = _organize_directory(path, dry_run=False)
        return {
            "message": f"Directory organized. {result['total_moved']} files sorted into category folders.",
            "data": {
                "status": "success",
                "action": "organize",
                "path": path,
                "moved": result["moved"][:20],
                "total_moved": result["total_moved"],
                "errors": result["errors"],
            },
        }

    elif action == "stats":
        stats = _get_dir_stats(path)
        if "error" in stats:
            return {
                "message": f"Stats failed: {stats['error']}",
                "data": {"status": "error"},
            }
        return {
            "message": (
                f"Directory stats for {path}: {stats['total_files']} files, "
                f"{stats['total_dirs']} directories, {stats.get('total_size_mb', 0)} MB total"
            ),
            "data": {
                "status": "success",
                "action": "stats",
                **stats,
            },
        }

    elif action == "cleanup":
        target = Path(path).expanduser().resolve()
        if not target.exists():
            return {"message": f"Path not found: {path}", "data": {"status": "error"}}

        removed_dirs = 0
        removed_files = 0
        temp_patterns = {"*.tmp", "*.temp", "*.bak", "*.swp", "*~", ".DS_Store", "Thumbs.db"}

        # Remove empty directories
        for root, dirs, files in os.walk(target, topdown=False):
            for d in dirs:
                dpath = Path(root) / d
                try:
                    if not any(dpath.iterdir()):
                        dpath.rmdir()
                        removed_dirs += 1
                except (OSError, PermissionError):
                    continue

        # Remove temp files
        for pattern in temp_patterns:
            for fpath in target.rglob(pattern):
                try:
                    fpath.unlink()
                    removed_files += 1
                except (OSError, PermissionError):
                    continue

        return {
            "message": f"Cleanup complete. Removed {removed_dirs} empty dirs, {removed_files} temp files.",
            "data": {
                "status": "success",
                "action": "cleanup",
                "removed_dirs": removed_dirs,
                "removed_files": removed_files,
                "path": path,
            },
        }

    elif action == "find":
        parts2 = path.split(None, 1)
        pattern = parts2[0] if parts2 else "*"
        search_path = parts2[1] if len(parts2) > 1 else "."

        target = Path(search_path).expanduser().resolve()
        if not target.exists():
            return {"message": f"Path not found: {search_path}", "data": {"status": "error"}}

        found = []
        for fpath in target.rglob(pattern):
            if len(found) >= 50:
                break
            try:
                stat = fpath.stat()
                found.append({
                    "path": str(fpath),
                    "size_kb": round(stat.st_size / 1024, 1),
                    "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
                })
            except (OSError, PermissionError):
                continue

        return {
            "message": f"Found {len(found)} files matching '{pattern}' in {search_path}.",
            "data": {
                "status": "success",
                "action": "find",
                "pattern": pattern,
                "results": found,
                "total": len(found),
            },
        }

    return {
        "message": f"Unknown file action: '{action}'. Use: organize, stats, cleanup, find",
        "data": {"status": "error", "action": action},
    }

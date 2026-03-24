"""
Code generation tool - generates and saves code files.
"""

import os
import time


OUTPUT_DIR = os.path.expanduser("~/mcp_generated")


def generate_code(description: str, language: str = "python", filename: str = None) -> dict:
    """Generate code based on description. Returns dict with code info.
    
    Note: The actual AI generation happens in the engine. This tool
    handles file saving and project management.
    """
    if not filename:
        timestamp = int(time.time())
        ext_map = {
            "python": ".py", "javascript": ".js", "typescript": ".ts",
            "html": ".html", "css": ".css", "java": ".java",
            "cpp": ".cpp", "c": ".c", "go": ".go", "rust": ".rs",
            "ruby": ".rb", "php": ".php", "swift": ".swift",
            "kotlin": ".kt", "shell": ".sh", "bash": ".sh",
        }
        ext = ext_map.get(language.lower(), ".txt")
        safe_name = description.lower().replace(" ", "_")[:30]
        filename = f"{safe_name}_{timestamp}{ext}"

    return {
        "filename": filename,
        "language": language,
        "description": description,
    }


def save_code(filename: str, content: str, project_name: str = "default") -> str:
    """Save generated code to disk."""
    project_dir = os.path.join(OUTPUT_DIR, project_name)
    os.makedirs(project_dir, exist_ok=True)

    filepath = os.path.join(project_dir, filename)
    with open(filepath, "w") as f:
        f.write(content)

    return f"Saved: {filepath}"


def list_projects() -> list:
    """List all generated projects."""
    if not os.path.exists(OUTPUT_DIR):
        return []

    projects = []
    for name in os.listdir(OUTPUT_DIR):
        path = os.path.join(OUTPUT_DIR, name)
        if os.path.isdir(path):
            files = []
            for root, dirs, filenames in os.walk(path):
                for fn in filenames:
                    files.append(os.path.relpath(os.path.join(root, fn), path))
            projects.append({"name": name, "files": files, "file_count": len(files)})

    return projects

"""
Tool dispatcher - parses AI responses for tool calls and executes them.
"""

import json
import re
from typing import Optional

from tools.screenshot import capture_screen, save_screenshot
from tools.shell_tool import run_command, get_shell_info
from tools.file_tool import read_file, write_file, list_dir, delete_file
from tools.system_tool import get_system_info
from tools.clipboard_tool import get_clipboard, set_clipboard
from tools.code_gen import save_code, list_projects


def extract_tool_call(response: str) -> Optional[dict]:
    """Extract a tool call from the AI response."""
    # Look for ```tool or ```json code blocks containing a tool call
    for pattern in [
        r'```tool\s*\n?(.*?)\n?```',
        r'```json\s*\n?(.*?)\n?```',
        r'```\s*\n?(.*?)\n?```',
    ]:
        match = re.search(pattern, response, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(1).strip())
                if isinstance(parsed, dict) and "tool" in parsed:
                    return parsed
            except json.JSONDecodeError:
                continue

    # Look for raw JSON with "tool" key (handles nested args with braces)
    for match in re.finditer(r'\{[^}]*"tool"\s*:', response):
        start = match.start()
        # Find matching closing brace
        depth = 0
        for i in range(start, len(response)):
            if response[i] == '{':
                depth += 1
            elif response[i] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(response[start:i+1])
                        if "tool" in parsed:
                            return parsed
                    except json.JSONDecodeError:
                        break
                    break

    return None


def execute_tool(tool_call: dict, engine=None) -> str:
    """Execute a tool call and return the result as a string."""
    tool_name = tool_call.get("tool", "")
    args = tool_call.get("args", {})

    try:
        if tool_name == "screenshot":
            image_b64 = capture_screen()
            if image_b64 and engine:
                prompt = args.get("prompt", "Describe what you see on this screen in detail.")
                analysis = engine.analyze_image(image_b64, prompt)
                engine.memory.add_screen_observation(analysis[:200])
                return f"Screen captured and analyzed:\n{analysis}"
            elif image_b64:
                return "Screen captured (no AI engine available for analysis)"
            else:
                return "Failed to capture screen"

        elif tool_name == "shell":
            command = args.get("command", "")
            if not command:
                return "Error: No command provided"
            cwd = args.get("cwd", None)
            timeout = args.get("timeout", 30)
            result = run_command(command, cwd=cwd, timeout=timeout)
            return f"[{result['status']}] (exit {result['return_code']})\n{result['output']}"

        elif tool_name == "files":
            action = args.get("action", "list")
            path = args.get("path", ".")
            if action == "read":
                result = read_file(path)
                if result["status"] == "success":
                    return f"File: {result['path']} ({result['size']} bytes)\n{result['content']}"
                return result["content"]
            elif action == "write":
                content = args.get("content", "")
                result = write_file(path, content)
                return result.get("message", str(result))
            elif action == "list":
                result = list_dir(path)
                if result["status"] == "success":
                    lines = [f"Directory: {result['path']} ({result['count']} items)"]
                    for entry in result["entries"]:
                        icon = "D" if entry["type"] == "dir" else "F"
                        size = f" ({entry.get('size', 0)} bytes)" if entry["type"] == "file" else ""
                        lines.append(f"  [{icon}] {entry['name']}{size}")
                    return "\n".join(lines)
                return result.get("message", "List failed")
            elif action == "delete":
                result = delete_file(path)
                return result.get("message", str(result))
            else:
                return f"Unknown file action: {action}"

        elif tool_name == "code":
            description = args.get("description", "")
            language = args.get("language", "python")
            filename = args.get("filename", "")
            content = args.get("content", "")
            project = args.get("project", "default")
            if content and filename:
                result = save_code(filename, content, project)
                return result
            return f"Ready to generate: {description} ({language})"

        elif tool_name == "system":
            info_type = args.get("type", "all")
            result = get_system_info(info_type)
            return json.dumps(result, indent=2)

        elif tool_name == "clipboard":
            action = args.get("action", "get")
            if action == "get":
                result = get_clipboard()
                if result["status"] == "success":
                    return f"Clipboard ({result['length']} chars):\n{result['text']}"
                return result.get("message", "Clipboard read failed")
            elif action == "set":
                text = args.get("text", "")
                result = set_clipboard(text)
                return result.get("message", str(result))
            else:
                return f"Unknown clipboard action: {action}"

        elif tool_name == "search":
            query = args.get("query", "")
            return f"Web search not available locally. Query: {query}\nTip: Use the shell tool to run 'curl' for web requests."

        elif tool_name == "projects":
            projects = list_projects()
            if not projects:
                return "No generated projects found."
            lines = ["Generated Projects:"]
            for p in projects:
                lines.append(f"  {p['name']} ({p['file_count']} files)")
                for f in p["files"][:5]:
                    lines.append(f"    - {f}")
                if len(p["files"]) > 5:
                    lines.append(f"    ... and {len(p['files']) - 5} more")
            return "\n".join(lines)

        else:
            return f"Unknown tool: {tool_name}"

    except Exception as e:
        return f"Tool error ({tool_name}): {str(e)}"

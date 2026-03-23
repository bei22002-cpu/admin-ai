"""MCP Shell Command - Natural language shell command assistant."""

import os
import platform
import subprocess

import httpx


def _get_ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _ai_shell(query: str) -> str:
    """Ask AI to generate a shell command from natural language."""
    system_msg = (
        f"You are MCP, a shell command expert on {platform.system()}. "
        "Given a natural language request, respond with ONLY the shell command to execute. "
        "No explanation, no markdown, just the raw command. "
        "If the request is dangerous (rm -rf /, format disk, etc.), respond with: DANGEROUS: [reason]"
    )
    provider = _get_ai_provider()

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=30.0) as client:
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
                    "messages": [{"role": "user", "content": query}],
                    "max_tokens": 300,
                },
            )
            if response.status_code == 200:
                data = response.json()
                blocks = data.get("content", [])
                parts = [b["text"] for b in blocks if b.get("type") == "text"]
                return "\n".join(parts).strip()
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=30.0) as client:
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
                        {"role": "user", "content": query},
                    ],
                    "max_tokens": 300,
                },
            )
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"].strip()
    return ""


async def handle_shell(args: str) -> dict:
    """Handle 'MCP shell [query]' command.

    Translates natural language to shell commands, executes them, and returns results.
    """
    if not args:
        return {
            "message": "Shell protocol requires a query. Usage: MCP shell [what you want to do]",
            "data": {
                "status": "awaiting_input",
                "examples": [
                    "MCP shell find all large files over 100MB",
                    "MCP shell show disk usage by folder",
                    "MCP shell list running processes using most memory",
                    "MCP shell count lines of code in this project",
                ],
            },
        }

    # Get AI-generated command
    command = await _ai_shell(args)

    if not command:
        # Fallback: common command mappings
        query_lower = args.lower()
        if "disk" in query_lower and ("usage" in query_lower or "space" in query_lower):
            command = "df -h"
        elif "large file" in query_lower:
            command = "find / -type f -size +100M 2>/dev/null | head -20"
        elif "process" in query_lower or "running" in query_lower:
            command = "ps aux --sort=-%mem | head -20"
        elif "memory" in query_lower or "ram" in query_lower:
            command = "free -h"
        elif "uptime" in query_lower:
            command = "uptime"
        elif "network" in query_lower or "ip" in query_lower:
            command = "ip addr show 2>/dev/null || ifconfig"
        else:
            return {
                "message": f"Could not determine shell command for: '{args}'. AI unavailable.",
                "data": {"status": "error", "query": args},
            }

    # Safety check
    if command.startswith("DANGEROUS:"):
        return {
            "message": f"Command blocked for safety. {command}",
            "data": {"status": "blocked", "reason": command, "query": args},
        }

    dangerous_patterns = ["rm -rf /", "mkfs", "dd if=", ":(){", "fork bomb", "chmod -R 777 /"]
    for pattern in dangerous_patterns:
        if pattern in command.lower():
            return {
                "message": f"Dangerous command blocked: {command}",
                "data": {"status": "blocked", "command": command, "query": args},
            }

    # Execute command
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.expanduser("~"),
        )
        output = result.stdout[:3000] if result.stdout else ""
        error = result.stderr[:1000] if result.stderr else ""

        return {
            "message": f"Command executed: `{command}`",
            "data": {
                "status": "success" if result.returncode == 0 else "error",
                "command": command,
                "output": output or "(no output)",
                "error": error if error else None,
                "return_code": result.returncode,
                "query": args,
            },
        }
    except subprocess.TimeoutExpired:
        return {
            "message": f"Command timed out (30s): `{command}`",
            "data": {"status": "timeout", "command": command, "query": args},
        }
    except Exception as e:
        return {
            "message": f"Command execution failed: {e}",
            "data": {"status": "error", "command": command, "error": str(e)},
        }

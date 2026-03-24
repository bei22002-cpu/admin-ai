"""
Shell command execution tool - runs commands safely.
"""

import subprocess
import os
import platform


# Commands that should never be run
BLOCKED_COMMANDS = [
    "rm -rf /", "rm -rf /*", "mkfs", "dd if=/dev/zero",
    ":(){ :|:& };:", "chmod -R 777 /",
]


def run_command(command: str, cwd: str = None, timeout: int = 30) -> dict:
    """Run a shell command and return the result."""
    # Safety check
    cmd_lower = command.strip().lower()
    for blocked in BLOCKED_COMMANDS:
        if blocked in cmd_lower:
            return {
                "status": "blocked",
                "output": f"Command blocked for safety: {command}",
                "return_code": -1,
            }

    if not cwd:
        cwd = os.path.expanduser("~")

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )

        output = result.stdout
        if result.stderr:
            output += "\n" + result.stderr if output else result.stderr

        # Cap output length
        if len(output) > 10000:
            output = output[:5000] + "\n...(truncated)...\n" + output[-2000:]

        return {
            "status": "success" if result.returncode == 0 else "error",
            "output": output.strip(),
            "return_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "output": f"Command timed out after {timeout}s",
            "return_code": -1,
        }
    except Exception as e:
        return {
            "status": "error",
            "output": str(e),
            "return_code": -1,
        }


def get_shell_info() -> dict:
    """Get info about the current shell environment."""
    return {
        "platform": platform.system(),
        "platform_version": platform.version(),
        "python_version": platform.python_version(),
        "home": os.path.expanduser("~"),
        "cwd": os.getcwd(),
        "user": os.environ.get("USER", os.environ.get("USERNAME", "unknown")),
    }

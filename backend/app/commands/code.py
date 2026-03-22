"""MCP Code Command - Opens VSCode, generates code."""

import shutil
import subprocess


async def handle_code(args: str) -> dict:
    """Handle 'MCP code [thing]' command.

    Opens VSCode and generates code based on the request.
    """
    if not args:
        return {
            "message": "Code protocol requires a target. Usage: MCP code [description]",
            "data": {"status": "awaiting_input"},
        }

    # Check if VSCode is available
    vscode_path = shutil.which("code")
    has_vscode = vscode_path is not None

    # Try to open VSCode if available
    if has_vscode:
        try:
            subprocess.Popen(
                ["code", "--new-window"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            vscode_status = "VSCode launched."
        except Exception as e:
            vscode_status = f"VSCode launch failed: {e}"
    else:
        vscode_status = "VSCode not detected. Code will be generated inline."

    return {
        "message": f"Code protocol initiated for: {args}. {vscode_status}",
        "data": {
            "request": args,
            "vscode_available": has_vscode,
            "vscode_status": vscode_status,
            "suggestion": f"Generating code blueprint for: {args}",
            "phase": 1,
        },
    }

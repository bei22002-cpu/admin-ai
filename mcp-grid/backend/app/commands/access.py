"""MCP Access Command - Grants immediate system access to apps/files."""

import os
import platform
import shutil
import subprocess

# Common application mappings per platform
APP_MAP = {
    "discord": {
        "Windows": "Discord.exe",
        "Darwin": "Discord",
        "Linux": "discord",
    },
    "chrome": {
        "Windows": "chrome.exe",
        "Darwin": "Google Chrome",
        "Linux": "google-chrome",
    },
    "firefox": {
        "Windows": "firefox.exe",
        "Darwin": "Firefox",
        "Linux": "firefox",
    },
    "spotify": {
        "Windows": "Spotify.exe",
        "Darwin": "Spotify",
        "Linux": "spotify",
    },
    "slack": {
        "Windows": "slack.exe",
        "Darwin": "Slack",
        "Linux": "slack",
    },
    "terminal": {
        "Windows": "cmd.exe",
        "Darwin": "Terminal",
        "Linux": "gnome-terminal",
    },
    "vscode": {
        "Windows": "code.exe",
        "Darwin": "Visual Studio Code",
        "Linux": "code",
    },
}


def get_system() -> str:
    """Get current platform."""
    return platform.system()


async def handle_access(args: str) -> dict:
    """Handle 'MCP access [app/file]' command.

    Opens applications or files on the system.
    """
    if not args:
        available = list(APP_MAP.keys())
        return {
            "message": "Access protocol requires a target. Usage: MCP access [app/file]",
            "data": {
                "available_apps": available,
                "tip": "You can also specify a file path to open.",
            },
        }

    target = args.lower().strip()
    system = get_system()

    # Check if it's a known app
    if target in APP_MAP:
        app_name = APP_MAP[target].get(system, target)

        # Try to find and launch the app
        if system == "Darwin":
            try:
                subprocess.Popen(
                    ["open", "-a", app_name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return {
                    "message": f"Access granted. {target.title()} launching.",
                    "data": {"app": target, "status": "launched", "platform": system},
                }
            except Exception as e:
                return {
                    "message": f"Access denied. Failed to launch {target}: {e}",
                    "data": {"app": target, "status": "failed", "error": str(e)},
                }
        elif system == "Windows":
            try:
                subprocess.Popen(
                    ["start", app_name],
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return {
                    "message": f"Access granted. {target.title()} launching.",
                    "data": {"app": target, "status": "launched", "platform": system},
                }
            except Exception as e:
                return {
                    "message": f"Access denied. Failed to launch {target}: {e}",
                    "data": {"app": target, "status": "failed", "error": str(e)},
                }
        else:  # Linux
            exe_path = shutil.which(app_name)
            if exe_path:
                try:
                    subprocess.Popen(
                        [exe_path],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return {
                        "message": f"Access granted. {target.title()} launching.",
                        "data": {"app": target, "status": "launched", "platform": system},
                    }
                except Exception as e:
                    return {
                        "message": f"Access denied. Failed to launch {target}: {e}",
                        "data": {"app": target, "status": "failed", "error": str(e)},
                    }
            return {
                "message": f"{target.title()} not found in system PATH.",
                "data": {"app": target, "status": "not_found", "platform": system},
            }

    # Check if it's a file/directory path
    if os.path.exists(args):
        try:
            if system == "Darwin":
                subprocess.Popen(["open", args])
            elif system == "Windows":
                os.startfile(args)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", args])
            return {
                "message": f"Access granted. Opening: {args}",
                "data": {"path": args, "status": "opened", "type": "file"},
            }
        except Exception as e:
            return {
                "message": f"Access denied. Cannot open {args}: {e}",
                "data": {"path": args, "status": "failed", "error": str(e)},
            }

    return {
        "message": f"Target '{args}' not recognized. Provide an app name or valid file path.",
        "data": {
            "target": args,
            "status": "not_found",
            "known_apps": list(APP_MAP.keys()),
        },
    }

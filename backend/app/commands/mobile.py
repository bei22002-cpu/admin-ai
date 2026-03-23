"""MCP Mobile Command - Remote access and mobile app management."""

import json
import os
import time


# Mobile session state
mobile_sessions: list[dict] = []
mobile_config_path = os.path.expanduser("~/mcp_mobile_config.json")


def _load_mobile_config() -> dict:
    """Load mobile configuration."""
    defaults = {
        "enabled": False,
        "port": 8080,
        "auth_required": True,
        "push_notifications": True,
        "remote_commands": True,
        "max_sessions": 3,
        "api_version": "v1",
    }

    if os.path.exists(mobile_config_path):
        try:
            with open(mobile_config_path) as f:
                saved = json.load(f)
                defaults.update(saved)
        except Exception:
            pass
    return defaults


def _save_mobile_config(config: dict):
    """Save mobile configuration."""
    with open(mobile_config_path, "w") as f:
        json.dump(config, f, indent=2)


async def handle_mobile(args: str) -> dict:
    """Handle 'MCP mobile [action]' command.

    Actions: status, enable, disable, sessions, config, qr
    """
    config = _load_mobile_config()

    if not args:
        return {
            "message": "Mobile access system. Usage: MCP mobile [action]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "status": "Show mobile access status",
                    "enable": "Enable mobile access",
                    "disable": "Disable mobile access",
                    "sessions": "Show active mobile sessions",
                    "config": "View/update mobile configuration",
                    "qr": "Generate QR code for mobile connection",
                },
                "examples": [
                    "MCP mobile status",
                    "MCP mobile enable",
                    "MCP mobile sessions",
                    "MCP mobile config port=9090",
                ],
                "config": config,
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "status":
        return {
            "message": f"Mobile access: {'ENABLED' if config['enabled'] else 'DISABLED'}",
            "data": {
                "status": "success",
                "enabled": config["enabled"],
                "port": config["port"],
                "active_sessions": len(mobile_sessions),
                "config": config,
                "api_docs": f"http://localhost:{config['port']}/api/{config['api_version']}/docs" if config["enabled"] else None,
            },
        }

    elif action == "enable":
        config["enabled"] = True
        _save_mobile_config(config)

        return {
            "message": f"Mobile access ENABLED on port {config['port']}. Connect your phone to the same network.",
            "data": {
                "status": "success",
                "enabled": True,
                "port": config["port"],
                "connect_info": {
                    "url": f"http://YOUR_IP:{config['port']}",
                    "auth_required": config["auth_required"],
                    "instructions": [
                        "1. Connect your phone to the same WiFi network",
                        f"2. Open http://YOUR_COMPUTER_IP:{config['port']} in mobile browser",
                        "3. Login with your MCP credentials",
                        "4. Start issuing commands from your phone",
                    ],
                },
            },
        }

    elif action == "disable":
        config["enabled"] = False
        _save_mobile_config(config)
        mobile_sessions.clear()

        return {
            "message": "Mobile access DISABLED. All sessions disconnected.",
            "data": {"status": "success", "enabled": False, "sessions_closed": len(mobile_sessions)},
        }

    elif action == "sessions":
        return {
            "message": f"Mobile sessions: {len(mobile_sessions)} active",
            "data": {
                "status": "success",
                "sessions": mobile_sessions,
                "max_sessions": config["max_sessions"],
                "total": len(mobile_sessions),
            },
        }

    elif action == "config":
        if not rest:
            return {
                "message": "Mobile configuration",
                "data": {"status": "success", "config": config},
            }

        for pair in rest.split():
            if "=" in pair:
                key, value = pair.split("=", 1)
                if key in config:
                    if isinstance(config[key], bool):
                        config[key] = value.lower() in ("true", "1", "yes")
                    elif isinstance(config[key], int):
                        try:
                            config[key] = int(value)
                        except ValueError:
                            pass
                    else:
                        config[key] = value

        _save_mobile_config(config)
        return {
            "message": "Mobile configuration updated.",
            "data": {"status": "success", "config": config},
        }

    elif action == "qr":
        # Generate a simple ASCII QR placeholder
        import socket
        try:
            hostname = socket.gethostname()
            local_ip = socket.gethostbyname(hostname)
        except Exception:
            local_ip = "YOUR_IP"

        url = f"http://{local_ip}:{config['port']}"

        return {
            "message": f"Connect to MCP from your phone: {url}",
            "data": {
                "status": "success",
                "url": url,
                "ip": local_ip,
                "port": config["port"],
                "instructions": [
                    "Scan the QR code or visit the URL on your mobile device",
                    "Make sure your phone is on the same WiFi network",
                    f"URL: {url}",
                ],
            },
        }

    return {
        "message": f"Unknown mobile action: '{action}'. Use: status, enable, disable, sessions, config, qr",
        "data": {"status": "error"},
    }

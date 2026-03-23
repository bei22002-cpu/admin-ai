"""MCP Email/Notification Command - Send notifications and manage alerts."""

import json
import os
import time
import subprocess


# In-memory notification queue
notifications: list[dict] = []
watchers: list[dict] = []


async def handle_email(args: str) -> dict:
    """Handle 'MCP notify [action] [args]' command.

    Actions: send, list, watch, webhooks, clear
    """
    if not args:
        return {
            "message": "Notification system ready. Usage: MCP notify [action] [args]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "send": "Send a notification",
                    "list": "Show notification history",
                    "watch": "Watch a process and notify when done",
                    "webhook": "Send to a webhook URL",
                    "clear": "Clear notifications",
                },
                "examples": [
                    "MCP notify send Build finished successfully",
                    "MCP notify watch 'npm run build'",
                    "MCP notify webhook https://hooks.slack.com/... Build done!",
                    "MCP notify list",
                ],
                "pending_notifications": len(notifications),
                "active_watchers": len(watchers),
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "send":
        if not rest:
            return {"message": "Send requires a message. Usage: MCP notify send [message]", "data": {"status": "error"}}

        notification = {
            "id": len(notifications) + 1,
            "type": "manual",
            "message": rest,
            "timestamp": time.time(),
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "sent",
        }

        # Try desktop notification
        try:
            subprocess.run(
                ["notify-send", "MCP Grid", rest],
                capture_output=True, timeout=5,
            )
            notification["delivery"] = "desktop"
        except Exception:
            notification["delivery"] = "logged"

        notifications.append(notification)

        return {
            "message": f"Notification sent: {rest[:100]}",
            "data": {"status": "success", "notification": notification},
        }

    elif action == "list":
        limit = 20
        if rest and rest.isdigit():
            limit = int(rest)

        return {
            "message": f"Notifications: {len(notifications)} total",
            "data": {
                "status": "success",
                "notifications": notifications[-limit:],
                "total": len(notifications),
                "watchers": watchers,
            },
        }

    elif action == "watch":
        if not rest:
            return {"message": "Watch requires a command. Usage: MCP notify watch [command]", "data": {"status": "error"}}

        command = rest.strip().strip("'\"")

        # Run command and notify when done
        try:
            start = time.time()
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=300,  # 5 min timeout
                cwd=os.path.expanduser("~"),
            )
            elapsed = round(time.time() - start, 1)

            success = result.returncode == 0
            msg = f"Command {'completed' if success else 'failed'}: {command} ({elapsed}s)"

            notification = {
                "id": len(notifications) + 1,
                "type": "watcher",
                "message": msg,
                "command": command,
                "success": success,
                "elapsed": elapsed,
                "output": result.stdout[:500] if result.stdout else "",
                "error": result.stderr[:500] if result.stderr else "",
                "timestamp": time.time(),
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "status": "sent",
            }

            # Desktop notification
            try:
                subprocess.run(
                    ["notify-send", "MCP Grid", msg],
                    capture_output=True, timeout=5,
                )
                notification["delivery"] = "desktop"
            except Exception:
                notification["delivery"] = "logged"

            notifications.append(notification)

            return {
                "message": msg,
                "data": {
                    "status": "success" if success else "error",
                    "notification": notification,
                },
            }
        except subprocess.TimeoutExpired:
            return {
                "message": f"Command timed out (5 min): {command}",
                "data": {"status": "timeout", "command": command},
            }
        except Exception as e:
            return {
                "message": f"Watch error: {e}",
                "data": {"status": "error", "error": str(e)},
            }

    elif action == "webhook":
        webhook_parts = rest.split(None, 1)
        if len(webhook_parts) < 2:
            return {"message": "Webhook requires URL and message. Usage: MCP notify webhook [url] [message]", "data": {"status": "error"}}

        url = webhook_parts[0]
        message = webhook_parts[1]

        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Slack-compatible webhook format
                payload = {"text": f"[MCP Grid] {message}"}
                resp = await client.post(url, json=payload)

                notification = {
                    "id": len(notifications) + 1,
                    "type": "webhook",
                    "message": message,
                    "url": url[:50] + "...",
                    "status_code": resp.status_code,
                    "timestamp": time.time(),
                    "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "status": "sent" if resp.status_code == 200 else "failed",
                }
                notifications.append(notification)

                return {
                    "message": f"Webhook {'sent' if resp.status_code == 200 else 'failed'}: {message[:100]}",
                    "data": {"status": "success" if resp.status_code == 200 else "error", "notification": notification},
                }
        except Exception as e:
            return {
                "message": f"Webhook error: {e}",
                "data": {"status": "error", "error": str(e)},
            }

    elif action == "clear":
        count = len(notifications)
        notifications.clear()
        return {
            "message": f"Notifications cleared ({count} removed).",
            "data": {"status": "success", "cleared": count},
        }

    return {
        "message": f"Unknown notify action: '{action}'. Use: send, list, watch, webhook, clear",
        "data": {"status": "error"},
    }

"""MCP Alert Command - System-wide notifications."""

import re
import time
from datetime import datetime, timedelta

# In-memory alert storage
active_alerts: list[dict] = []


def parse_time_delta(time_str: str) -> timedelta | None:
    """Parse time strings like '5 minutes', '1 hour', '30 seconds', '1800 hours'."""
    time_str = time_str.strip().lower()

    # Try parsing military time (e.g., "1800 hours")
    match = re.match(r"(\d{4})\s*hours?$", time_str)
    if match:
        military = int(match.group(1))
        hours = military // 100
        minutes = military % 100
        now = datetime.now()
        target = now.replace(hour=hours, minute=minutes, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target - now

    # Parse relative time
    patterns = {
        r"(\d+)\s*s(?:ec(?:ond)?s?)?": "seconds",
        r"(\d+)\s*m(?:in(?:ute)?s?)?": "minutes",
        r"(\d+)\s*h(?:(?:ou)?rs?)?": "hours",
        r"(\d+)\s*d(?:ays?)?": "days",
    }

    for pattern, unit in patterns.items():
        match = re.match(pattern, time_str)
        if match:
            value = int(match.group(1))
            return timedelta(**{unit: value})

    return None


async def handle_alert(args: str) -> dict:
    """Handle 'MCP alert [task] in [time]' command.

    Creates system-wide notification alerts.
    """
    if not args:
        return {
            "message": "Alert protocol requires parameters. "
            "Usage: MCP alert [task] in [time]",
            "data": {
                "active_alerts": len(active_alerts),
                "examples": [
                    "MCP alert backup protocol in 30 minutes",
                    "MCP alert system check in 1 hour",
                    "MCP alert meeting in 5 minutes",
                    "MCP alert backup protocol 1800 hours",
                ],
            },
        }

    # Parse "task in time" format
    parts = args.rsplit(" in ", 1)
    if len(parts) == 2:
        task = parts[0].strip()
        time_str = parts[1].strip()
    else:
        # Try to find time at end
        match = re.search(r"(.+?)\s+(\d+\s*(?:sec|min|hour|day|h|m|s|d)\w*)\s*$", args)
        if match:
            task = match.group(1).strip()
            time_str = match.group(2).strip()
        else:
            task = args
            time_str = "5 minutes"

    delta = parse_time_delta(time_str)
    if delta is None:
        return {
            "message": f"Cannot parse time: '{time_str}'. Use formats like '5 minutes', '1 hour'.",
            "data": {"status": "error", "time_input": time_str},
        }

    trigger_time = time.time() + delta.total_seconds()
    alert = {
        "id": len(active_alerts) + 1,
        "task": task,
        "trigger_time": trigger_time,
        "trigger_datetime": datetime.fromtimestamp(trigger_time).isoformat(),
        "created": time.time(),
        "status": "armed",
        "delta_seconds": delta.total_seconds(),
    }
    active_alerts.append(alert)

    minutes = int(delta.total_seconds() / 60)
    time_desc = f"{minutes} minutes" if minutes > 0 else f"{int(delta.total_seconds())} seconds"

    return {
        "message": f"Alert armed. '{task}' will trigger in {time_desc}.",
        "data": {
            "alert": alert,
            "active_alerts": len(active_alerts),
        },
    }

"""MCP Schedule Command - Task scheduling and cron management."""

import os
import re
import subprocess
import time
from datetime import datetime, timedelta


# In-memory scheduled tasks
scheduled_tasks: list[dict] = []


def _parse_schedule(time_str: str) -> dict | None:
    """Parse schedule strings like 'every day at 9am', 'every 30 minutes', 'in 2 hours'."""
    time_str = time_str.strip().lower()

    # "every X minutes/hours"
    match = re.match(r"every\s+(\d+)\s*(min(?:ute)?s?|hours?|h|m|days?|d)", time_str)
    if match:
        value = int(match.group(1))
        unit = match.group(2)
        if unit.startswith("m"):
            cron = f"*/{value} * * * *" if value < 60 else f"0 */{value // 60} * * *"
            interval_sec = value * 60
        elif unit.startswith("h"):
            cron = f"0 */{value} * * *"
            interval_sec = value * 3600
        else:
            cron = f"0 0 */{value} * *"
            interval_sec = value * 86400
        return {"cron": cron, "interval_seconds": interval_sec, "type": "recurring", "description": time_str}

    # "every day at Xam/pm"
    match = re.match(r"every\s+day\s+at\s+(\d{1,2})\s*(am|pm)?", time_str)
    if match:
        hour = int(match.group(1))
        ampm = match.group(2)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return {"cron": f"0 {hour} * * *", "interval_seconds": 86400, "type": "daily", "description": time_str}

    # "every hour"
    if "every hour" in time_str:
        return {"cron": "0 * * * *", "interval_seconds": 3600, "type": "hourly", "description": time_str}

    # "every minute"
    if "every minute" in time_str:
        return {"cron": "* * * * *", "interval_seconds": 60, "type": "per_minute", "description": time_str}

    # "in X minutes/hours" (one-time)
    match = re.match(r"in\s+(\d+)\s*(min(?:ute)?s?|hours?|h|m)", time_str)
    if match:
        value = int(match.group(1))
        unit = match.group(2)
        seconds = value * 60 if unit.startswith("m") else value * 3600
        trigger_time = time.time() + seconds
        return {
            "trigger_time": trigger_time,
            "interval_seconds": seconds,
            "type": "one_time",
            "description": time_str,
        }

    return None


async def handle_schedule(args: str) -> dict:
    """Handle 'MCP schedule [task] [when]' command.

    Manages scheduled tasks and cron jobs.
    """
    if not args:
        return {
            "message": "Schedule protocol requires parameters. Usage: MCP schedule [action/task] [timing]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "list": "Show all scheduled tasks",
                    "add": "Add a new scheduled task",
                    "remove": "Remove a scheduled task by ID",
                    "clear": "Remove all scheduled tasks",
                },
                "examples": [
                    "MCP schedule backup ~/projects every day at 9am",
                    "MCP schedule disk cleanup every 30 minutes",
                    "MCP schedule list",
                    "MCP schedule remove 1",
                ],
            },
        }

    args_lower = args.strip().lower()

    # List scheduled tasks
    if args_lower == "list":
        # Also check system crontab
        system_crons = []
        try:
            result = subprocess.run(
                ["crontab", "-l"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                for line in result.stdout.strip().split("\n"):
                    if line.strip() and not line.startswith("#"):
                        system_crons.append(line.strip())
        except Exception:
            pass

        return {
            "message": f"Scheduled tasks: {len(scheduled_tasks)} active, {len(system_crons)} system crons.",
            "data": {
                "status": "success",
                "tasks": scheduled_tasks,
                "system_crons": system_crons,
                "total": len(scheduled_tasks),
            },
        }

    # Clear all
    if args_lower == "clear":
        count = len(scheduled_tasks)
        scheduled_tasks.clear()
        return {
            "message": f"Cleared {count} scheduled tasks.",
            "data": {"status": "success", "cleared": count},
        }

    # Remove by ID
    if args_lower.startswith("remove "):
        try:
            task_id = int(args_lower.split()[1])
            for i, task in enumerate(scheduled_tasks):
                if task["id"] == task_id:
                    removed = scheduled_tasks.pop(i)
                    return {
                        "message": f"Removed scheduled task #{task_id}: {removed['task']}",
                        "data": {"status": "success", "removed": removed},
                    }
            return {
                "message": f"Task #{task_id} not found.",
                "data": {"status": "error"},
            }
        except (ValueError, IndexError):
            return {
                "message": "Invalid task ID. Usage: MCP schedule remove [id]",
                "data": {"status": "error"},
            }

    # Add new task - parse "task every/in time"
    # Try to split on common schedule keywords
    schedule_keywords = ["every", " in "]
    task = args
    schedule_str = ""

    for keyword in schedule_keywords:
        idx = args.lower().find(keyword)
        if idx > 0:
            task = args[:idx].strip()
            schedule_str = args[idx:].strip()
            break

    if not schedule_str:
        # Default: one-time in 5 minutes
        schedule_str = "in 5 minutes"

    schedule = _parse_schedule(schedule_str)
    if not schedule:
        return {
            "message": f"Cannot parse schedule: '{schedule_str}'. Use formats like 'every 30 minutes', 'every day at 9am', 'in 2 hours'.",
            "data": {"status": "error", "schedule_input": schedule_str},
        }

    task_entry = {
        "id": len(scheduled_tasks) + 1,
        "task": task,
        "schedule": schedule,
        "created": time.time(),
        "created_at": datetime.now().isoformat(),
        "status": "active",
        "next_run": schedule.get("trigger_time", time.time() + schedule.get("interval_seconds", 300)),
    }
    scheduled_tasks.append(task_entry)

    next_run_dt = datetime.fromtimestamp(task_entry["next_run"]).strftime("%Y-%m-%d %H:%M:%S")

    return {
        "message": f"Task scheduled: '{task}' — {schedule['description']}. Next run: {next_run_dt}",
        "data": {
            "status": "success",
            "task": task_entry,
            "next_run": next_run_dt,
            "total_scheduled": len(scheduled_tasks),
        },
    }

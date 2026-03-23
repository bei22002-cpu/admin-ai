"""MCP Collaboration Command - Share projects and manage team access."""

import json
import os
import time
import shutil
from pathlib import Path


# In-memory collaboration state
shared_projects: dict[str, dict] = {}
team_members: list[dict] = []
activity_log: list[dict] = []


def _log_activity(action: str, user: str, project: str, details: str = ""):
    """Log a collaboration activity."""
    entry = {
        "id": len(activity_log) + 1,
        "action": action,
        "user": user,
        "project": project,
        "details": details,
        "timestamp": time.time(),
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    activity_log.insert(0, entry)
    if len(activity_log) > 200:
        activity_log.pop()


async def handle_collab(args: str) -> dict:
    """Handle 'MCP collab [action] [args]' command.

    Actions: share, team, activity, export, import
    """
    if not args:
        return {
            "message": "Collaboration system ready. Usage: MCP collab [action] [args]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "share": "Share a project with team",
                    "unshare": "Stop sharing a project",
                    "team": "Manage team members",
                    "activity": "View collaboration activity log",
                    "export": "Export project as shareable archive",
                    "import": "Import a shared project archive",
                    "status": "Show collaboration status",
                },
                "examples": [
                    "MCP collab share ~/my-project",
                    "MCP collab team add alice developer",
                    "MCP collab activity",
                    "MCP collab export ~/my-project",
                    "MCP collab status",
                ],
                "shared_projects": len(shared_projects),
                "team_size": len(team_members),
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "share":
        if not rest:
            return {"message": "Share requires a project path. Usage: MCP collab share [path]", "data": {"status": "error"}}

        project_path = os.path.expanduser(rest.strip())
        if not os.path.exists(project_path):
            return {"message": f"Path not found: {rest}", "data": {"status": "error"}}

        project_name = os.path.basename(project_path)
        share_id = f"share_{int(time.time())}_{project_name}"

        shared_projects[share_id] = {
            "id": share_id,
            "name": project_name,
            "path": project_path,
            "shared_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "shared_by": "owner",
            "access": ["read", "write"],
            "team": [m["name"] for m in team_members],
        }

        _log_activity("share", "owner", project_name, f"Shared project: {project_path}")

        return {
            "message": f"Project '{project_name}' shared with team. Share ID: {share_id}",
            "data": {
                "status": "success",
                "share_id": share_id,
                "project": project_name,
                "path": project_path,
                "team": [m["name"] for m in team_members],
            },
        }

    elif action == "unshare":
        if not rest:
            return {"message": "Unshare requires a share ID.", "data": {"status": "error"}}

        share_id = rest.strip()
        if share_id in shared_projects:
            removed = shared_projects.pop(share_id)
            _log_activity("unshare", "owner", removed["name"])
            return {"message": f"Project '{removed['name']}' unshared.", "data": {"status": "success"}}
        return {"message": f"Share ID '{share_id}' not found.", "data": {"status": "error"}}

    elif action == "team":
        team_parts = rest.split(None, 2)
        if not team_parts:
            return {
                "message": f"Team: {len(team_members)} members",
                "data": {"status": "success", "members": team_members, "total": len(team_members)},
            }

        sub_action = team_parts[0].lower()

        if sub_action == "add":
            if len(team_parts) < 2:
                return {"message": "Usage: MCP collab team add [name] [role]", "data": {"status": "error"}}

            name = team_parts[1]
            role = team_parts[2] if len(team_parts) > 2 else "developer"

            member = {
                "name": name,
                "role": role,
                "added_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "status": "active",
            }
            team_members.append(member)
            _log_activity("team_add", "owner", "", f"Added {name} as {role}")

            return {
                "message": f"Added {name} as {role}.",
                "data": {"status": "success", "member": member, "total": len(team_members)},
            }

        elif sub_action == "remove":
            if len(team_parts) < 2:
                return {"message": "Usage: MCP collab team remove [name]", "data": {"status": "error"}}

            name = team_parts[1]
            before = len(team_members)
            team_members[:] = [m for m in team_members if m["name"] != name]
            removed = before - len(team_members)

            if removed:
                _log_activity("team_remove", "owner", "", f"Removed {name}")
                return {"message": f"Removed {name} from team.", "data": {"status": "success"}}
            return {"message": f"Member '{name}' not found.", "data": {"status": "error"}}

        elif sub_action == "list":
            return {
                "message": f"Team: {len(team_members)} members",
                "data": {"status": "success", "members": team_members},
            }

    elif action == "activity":
        limit = 20
        if rest and rest.isdigit():
            limit = int(rest)

        return {
            "message": f"Activity log: {len(activity_log)} entries",
            "data": {
                "status": "success",
                "activities": activity_log[:limit],
                "total": len(activity_log),
            },
        }

    elif action == "export":
        if not rest:
            return {"message": "Export requires a project path. Usage: MCP collab export [path]", "data": {"status": "error"}}

        project_path = os.path.expanduser(rest.strip())
        if not os.path.exists(project_path):
            return {"message": f"Path not found: {rest}", "data": {"status": "error"}}

        project_name = os.path.basename(project_path)
        export_dir = os.path.expanduser("~/mcp_exports")
        os.makedirs(export_dir, exist_ok=True)

        archive_path = os.path.join(export_dir, project_name)
        try:
            shutil.make_archive(archive_path, "zip", project_path)
            archive_file = f"{archive_path}.zip"
            size_mb = round(os.path.getsize(archive_file) / (1024 * 1024), 2)

            _log_activity("export", "owner", project_name, f"Exported as {archive_file}")

            return {
                "message": f"Project exported: {archive_file} ({size_mb} MB)",
                "data": {
                    "status": "success",
                    "archive": archive_file,
                    "size_mb": size_mb,
                    "project": project_name,
                },
            }
        except Exception as e:
            return {"message": f"Export failed: {e}", "data": {"status": "error", "error": str(e)}}

    elif action == "import":
        if not rest:
            return {"message": "Import requires an archive path.", "data": {"status": "error"}}

        archive_path = os.path.expanduser(rest.strip())
        if not os.path.exists(archive_path):
            return {"message": f"Archive not found: {rest}", "data": {"status": "error"}}

        project_name = os.path.splitext(os.path.basename(archive_path))[0]
        dest = os.path.join(os.path.expanduser("~/mcp_generated"), project_name)

        try:
            shutil.unpack_archive(archive_path, dest)
            _log_activity("import", "owner", project_name, f"Imported from {archive_path}")

            return {
                "message": f"Project imported to {dest}",
                "data": {"status": "success", "path": dest, "project": project_name},
            }
        except Exception as e:
            return {"message": f"Import failed: {e}", "data": {"status": "error", "error": str(e)}}

    elif action == "status":
        return {
            "message": f"Collaboration: {len(shared_projects)} shared projects, {len(team_members)} team members",
            "data": {
                "status": "success",
                "shared_projects": list(shared_projects.values()),
                "team_members": team_members,
                "recent_activity": activity_log[:5],
            },
        }

    return {
        "message": f"Unknown collab action: '{action}'. Use: share, team, activity, export, import, status",
        "data": {"status": "error"},
    }

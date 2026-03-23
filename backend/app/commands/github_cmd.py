"""MCP GitHub Command - Git operations and GitHub integration."""

import os
import subprocess
from pathlib import Path

import httpx


async def _github_api(endpoint: str, method: str = "GET", body: dict | None = None) -> dict | None:
    """Call GitHub API."""
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        return None

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        if method == "GET":
            resp = await client.get(f"https://api.github.com{endpoint}", headers=headers)
        elif method == "POST":
            resp = await client.post(f"https://api.github.com{endpoint}", headers=headers, json=body or {})
        else:
            return None

        if resp.status_code in (200, 201):
            return resp.json()
    return None


def _git_command(args: list[str], cwd: str | None = None) -> dict:
    """Run a git command and return result."""
    try:
        result = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=cwd,
        )
        return {
            "success": result.returncode == 0,
            "output": result.stdout.strip(),
            "error": result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "output": "", "error": "Command timed out"}
    except Exception as e:
        return {"success": False, "output": "", "error": str(e)}


async def handle_github(args: str) -> dict:
    """Handle 'MCP github [action] [args]' command.

    Actions: push, clone, status, log, branch, pr, issues
    """
    if not args:
        return {
            "message": "GitHub protocol requires an action. Usage: MCP github [action] [args]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "status": "Show git status of current/specified directory",
                    "log": "Show recent commit history",
                    "branch": "List or create branches",
                    "clone": "Clone a repository",
                    "push": "Commit and push changes",
                    "pr": "Create a pull request (requires GITHUB_TOKEN)",
                    "issues": "List issues for a repository",
                },
                "examples": [
                    "MCP github status ~/my-project",
                    "MCP github push ~/my-project 'fix: resolve login bug'",
                    "MCP github clone https://github.com/user/repo",
                    "MCP github issues user/repo",
                    "MCP github log ~/my-project",
                ],
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "status":
        cwd = os.path.expanduser(rest) if rest else os.getcwd()
        result = _git_command(["status", "--porcelain"], cwd=cwd)
        branch = _git_command(["branch", "--show-current"], cwd=cwd)

        if not result["success"] and "not a git repository" in result["error"]:
            return {
                "message": f"Not a git repository: {cwd}",
                "data": {"status": "error", "path": cwd},
            }

        changes = result["output"].split("\n") if result["output"] else []
        return {
            "message": f"Git status: {len(changes)} changes on branch '{branch['output']}'",
            "data": {
                "status": "success",
                "branch": branch["output"],
                "changes": changes[:30],
                "total_changes": len(changes),
                "clean": len(changes) == 0,
                "path": cwd,
            },
        }

    elif action == "log":
        cwd = os.path.expanduser(rest) if rest else os.getcwd()
        result = _git_command(
            ["log", "--oneline", "--graph", "--decorate", "-20"],
            cwd=cwd,
        )
        return {
            "message": f"Git log for {cwd}",
            "data": {
                "status": "success" if result["success"] else "error",
                "log": result["output"][:3000],
                "path": cwd,
            },
        }

    elif action == "branch":
        rest_parts = rest.split(None, 1)
        cwd = os.path.expanduser(rest_parts[0]) if rest_parts else os.getcwd()

        if len(rest_parts) > 1:
            # Create new branch
            branch_name = rest_parts[1]
            result = _git_command(["checkout", "-b", branch_name], cwd=cwd)
            return {
                "message": f"Branch '{branch_name}' {'created' if result['success'] else 'failed'}",
                "data": {
                    "status": "success" if result["success"] else "error",
                    "branch": branch_name,
                    "output": result["output"] or result["error"],
                },
            }
        else:
            result = _git_command(["branch", "-a"], cwd=cwd)
            branches = [b.strip() for b in result["output"].split("\n") if b.strip()]
            return {
                "message": f"{len(branches)} branches found",
                "data": {
                    "status": "success",
                    "branches": branches,
                    "total": len(branches),
                },
            }

    elif action == "clone":
        if not rest:
            return {"message": "Clone requires a URL. Usage: MCP github clone [url]", "data": {"status": "error"}}

        url = rest.strip()
        repo_name = url.rstrip("/").split("/")[-1].replace(".git", "")
        dest = os.path.expanduser(f"~/repos/{repo_name}")

        result = _git_command(["clone", url, dest])
        return {
            "message": f"Repository {'cloned' if result['success'] else 'clone failed'}: {repo_name}",
            "data": {
                "status": "success" if result["success"] else "error",
                "repo": repo_name,
                "path": dest,
                "output": result["output"] or result["error"],
            },
        }

    elif action == "push":
        rest_parts = rest.split(None, 1)
        cwd = os.path.expanduser(rest_parts[0]) if rest_parts else os.getcwd()
        message = rest_parts[1].strip("'\"") if len(rest_parts) > 1 else "MCP auto-commit"

        # Stage all changes
        _git_command(["add", "-A"], cwd=cwd)
        # Commit
        commit = _git_command(["commit", "-m", message], cwd=cwd)
        if not commit["success"]:
            if "nothing to commit" in commit["output"] or "nothing to commit" in commit["error"]:
                return {
                    "message": "Nothing to commit. Working tree clean.",
                    "data": {"status": "success", "clean": True},
                }
            return {
                "message": f"Commit failed: {commit['error']}",
                "data": {"status": "error", "error": commit["error"]},
            }
        # Push
        push = _git_command(["push"], cwd=cwd)
        return {
            "message": f"Changes pushed. Commit: {message}",
            "data": {
                "status": "success" if push["success"] else "partial",
                "commit_message": message,
                "push_output": push["output"] or push["error"],
            },
        }

    elif action == "issues":
        if not rest:
            return {"message": "Issues requires owner/repo. Usage: MCP github issues user/repo", "data": {"status": "error"}}

        repo = rest.strip()
        issues = await _github_api(f"/repos/{repo}/issues?state=open&per_page=10")
        if issues is None:
            return {
                "message": "Failed to fetch issues. Check GITHUB_TOKEN and repo path.",
                "data": {"status": "error", "repo": repo},
            }

        issue_list = [
            {
                "number": i["number"],
                "title": i["title"],
                "state": i["state"],
                "author": i["user"]["login"],
                "labels": [l["name"] for l in i.get("labels", [])],
                "created": i["created_at"][:10],
            }
            for i in issues
            if isinstance(i, dict) and "number" in i
        ]

        return {
            "message": f"{len(issue_list)} open issues for {repo}",
            "data": {
                "status": "success",
                "repo": repo,
                "issues": issue_list,
                "total": len(issue_list),
            },
        }

    elif action == "pr":
        # Create PR requires more args: "pr owner/repo title base_branch head_branch"
        pr_parts = rest.split(None, 3)
        if len(pr_parts) < 2:
            return {
                "message": "PR requires: MCP github pr owner/repo 'PR title'",
                "data": {"status": "error"},
            }

        repo = pr_parts[0]
        title = pr_parts[1].strip("'\"") if len(pr_parts) > 1 else "MCP auto-PR"
        base = pr_parts[2] if len(pr_parts) > 2 else "main"
        head = pr_parts[3] if len(pr_parts) > 3 else None

        if not head:
            # Try to detect current branch
            branch_result = _git_command(["branch", "--show-current"])
            head = branch_result["output"] if branch_result["success"] else "main"

        pr_body = {"title": title, "head": head, "base": base, "body": f"Auto-created by MCP Grid.\n\nBranch: {head} -> {base}"}
        result = await _github_api(f"/repos/{repo}/pulls", method="POST", body=pr_body)

        if result:
            return {
                "message": f"PR created: #{result.get('number')} - {title}",
                "data": {
                    "status": "success",
                    "pr_number": result.get("number"),
                    "pr_url": result.get("html_url"),
                    "title": title,
                },
            }
        return {
            "message": "PR creation failed. Check GITHUB_TOKEN and repo permissions.",
            "data": {"status": "error", "repo": repo},
        }

    return {
        "message": f"Unknown GitHub action: '{action}'. Use: status, log, branch, clone, push, issues, pr",
        "data": {"status": "error", "action": action},
    }

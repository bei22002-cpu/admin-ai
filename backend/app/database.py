"""SQLite database for MCP Grid - users and project history."""

import asyncio
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

# Use /data for persistent storage in deployment, fallback to local
DB_DIR = Path(os.getenv("MCP_DB_DIR", "/data")) if os.path.isdir("/data") else Path(".")
DB_PATH = DB_DIR / "mcp_grid.db"

_db_lock = asyncio.Lock()


def _get_conn() -> sqlite3.Connection:
    """Get a SQLite connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            file_count INTEGER DEFAULT 0,
            language TEXT DEFAULT 'python',
            output TEXT DEFAULT '',
            error_count INTEGER DEFAULT 0,
            created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
            completed_at REAL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    """)
    conn.commit()
    conn.close()


async def create_user(username: str, email: str, password_hash: str) -> dict[str, Any]:
    """Create a new user."""
    async with _db_lock:
        conn = _get_conn()
        try:
            cursor = conn.execute(
                "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (username, email, password_hash, time.time()),
            )
            conn.commit()
            user_id = cursor.lastrowid
            return {"id": user_id, "username": username, "email": email}
        except sqlite3.IntegrityError as e:
            if "username" in str(e):
                raise ValueError("Username already taken")
            raise ValueError("Email already registered")
        finally:
            conn.close()


async def get_user_by_email(email: str) -> dict[str, Any] | None:
    """Get user by email."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


async def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    """Get user by ID."""
    conn = _get_conn()
    row = conn.execute("SELECT id, username, email, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


async def save_project(
    user_id: int,
    name: str,
    description: str = "",
    status: str = "pending",
    file_count: int = 0,
    language: str = "python",
    output: str = "",
    error_count: int = 0,
) -> int:
    """Save a project to the database."""
    async with _db_lock:
        conn = _get_conn()
        cursor = conn.execute(
            """INSERT INTO projects
               (user_id, name, description, status, file_count, language, output, error_count, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, name, description, status, file_count, language, output, error_count, time.time()),
        )
        conn.commit()
        project_id = cursor.lastrowid
        conn.close()
        return project_id


async def update_project(
    project_id: int,
    status: str | None = None,
    file_count: int | None = None,
    output: str | None = None,
    error_count: int | None = None,
) -> None:
    """Update a project's status."""
    async with _db_lock:
        conn = _get_conn()
        updates = []
        params: list[Any] = []
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if file_count is not None:
            updates.append("file_count = ?")
            params.append(file_count)
        if output is not None:
            updates.append("output = ?")
            params.append(output)
        if error_count is not None:
            updates.append("error_count = ?")
            params.append(error_count)
        if status in ("success", "partial", "error"):
            updates.append("completed_at = ?")
            params.append(time.time())
        if updates:
            params.append(project_id)
            conn.execute(
                f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",
                params,
            )
            conn.commit()
        conn.close()


async def get_user_projects(user_id: int, limit: int = 50) -> list[dict[str, Any]]:
    """Get projects for a user."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


async def get_project(project_id: int) -> dict[str, Any] | None:
    """Get a specific project."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

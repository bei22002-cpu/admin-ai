"""MCP Database Management Command - Schema generation, migrations, and queries."""

import os
import sqlite3
from pathlib import Path

import httpx


def _get_ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _ai_sql(prompt: str) -> str:
    """Call AI to generate SQL."""
    system_msg = (
        "You are MCP, a database expert. Generate clean, production-ready SQL. "
        "Output ONLY the SQL code, no explanations or markdown. "
        "Use proper data types, constraints, indexes, and foreign keys."
    )
    provider = _get_ai_provider()

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "system": system_msg,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2000,
                },
            )
            if response.status_code == 200:
                data = response.json()
                blocks = data.get("content", [])
                parts = [b["text"] for b in blocks if b.get("type") == "text"]
                return "\n".join(parts)
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key or api_key.startswith("your-"):
            return ""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 2000,
                },
            )
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"]
    return ""


async def handle_dbmanage(args: str) -> dict:
    """Handle 'MCP db [action] [args]' command.

    Actions: schema, query, tables, create, migrate
    """
    if not args:
        return {
            "message": "Database protocol requires an action. Usage: MCP db [action] [args]",
            "data": {
                "status": "awaiting_input",
                "actions": {
                    "schema": "Generate a database schema from description",
                    "query": "Run a SQL query on a SQLite database",
                    "tables": "List tables in a database",
                    "create": "Create a new SQLite database with schema",
                    "migrate": "Generate migration SQL for schema changes",
                },
                "examples": [
                    "MCP db schema a blog with users, posts, and comments",
                    "MCP db query app.db SELECT * FROM users LIMIT 10",
                    "MCP db tables app.db",
                    "MCP db create myapp.db a todo list with categories",
                ],
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "schema":
        if not rest:
            return {"message": "Schema requires a description. E.g.: MCP db schema an e-commerce platform", "data": {"status": "error"}}

        sql = await _ai_sql(
            f"Generate a complete SQLite database schema for: {rest}\n"
            "Include: CREATE TABLE statements, proper data types, PRIMARY KEY, FOREIGN KEY, "
            "NOT NULL constraints, DEFAULT values, indexes for common queries, "
            "and INSERT statements for sample data."
        )

        if not sql:
            # Fallback: generate basic schema
            sql = f"-- Schema for: {rest}\n"
            sql += "CREATE TABLE IF NOT EXISTS items (\n"
            sql += "    id INTEGER PRIMARY KEY AUTOINCREMENT,\n"
            sql += "    name TEXT NOT NULL,\n"
            sql += "    description TEXT DEFAULT '',\n"
            sql += "    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n"
            sql += ");\n"

        # Save to file
        output_dir = os.path.expanduser("~/mcp_generated/schemas")
        os.makedirs(output_dir, exist_ok=True)
        safe_name = rest.replace(" ", "_")[:30].lower()
        output_path = os.path.join(output_dir, f"{safe_name}_schema.sql")
        with open(output_path, "w") as f:
            f.write(sql)

        return {
            "message": f"Database schema generated for: {rest}",
            "data": {
                "status": "success",
                "action": "schema",
                "description": rest,
                "sql": sql[:3000],
                "saved_to": output_path,
            },
        }

    elif action == "query":
        rest_parts = rest.split(None, 1)
        if len(rest_parts) < 2:
            return {"message": "Query requires: MCP db query [db_path] [SQL]", "data": {"status": "error"}}

        db_path = os.path.expanduser(rest_parts[0])
        sql = rest_parts[1]

        if not os.path.exists(db_path):
            return {"message": f"Database not found: {db_path}", "data": {"status": "error"}}

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(sql)

            if sql.strip().upper().startswith("SELECT"):
                rows = cursor.fetchall()
                results = [dict(row) for row in rows[:100]]
                conn.close()
                return {
                    "message": f"Query returned {len(results)} rows.",
                    "data": {
                        "status": "success",
                        "action": "query",
                        "sql": sql,
                        "results": results,
                        "row_count": len(results),
                    },
                }
            else:
                conn.commit()
                affected = cursor.rowcount
                conn.close()
                return {
                    "message": f"Query executed. {affected} rows affected.",
                    "data": {
                        "status": "success",
                        "action": "query",
                        "sql": sql,
                        "rows_affected": affected,
                    },
                }
        except Exception as e:
            return {
                "message": f"Query error: {e}",
                "data": {"status": "error", "sql": sql, "error": str(e)},
            }

    elif action == "tables":
        db_path = os.path.expanduser(rest) if rest else "app.db"
        if not os.path.exists(db_path):
            return {"message": f"Database not found: {db_path}", "data": {"status": "error"}}

        try:
            conn = sqlite3.connect(db_path)
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()

            table_info = []
            for (name,) in tables:
                cols = conn.execute(f"PRAGMA table_info({name})").fetchall()
                count = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                table_info.append({
                    "name": name,
                    "columns": [{"name": c[1], "type": c[2], "notnull": bool(c[3]), "pk": bool(c[5])} for c in cols],
                    "row_count": count,
                })
            conn.close()

            return {
                "message": f"Found {len(table_info)} tables in {db_path}.",
                "data": {
                    "status": "success",
                    "action": "tables",
                    "db_path": db_path,
                    "tables": table_info,
                    "total": len(table_info),
                },
            }
        except Exception as e:
            return {"message": f"Error reading database: {e}", "data": {"status": "error", "error": str(e)}}

    elif action == "create":
        rest_parts = rest.split(None, 1)
        if len(rest_parts) < 2:
            return {"message": "Create requires: MCP db create [name.db] [description]", "data": {"status": "error"}}

        db_name = rest_parts[0]
        description = rest_parts[1]

        if not db_name.endswith(".db"):
            db_name += ".db"

        db_path = os.path.join(os.path.expanduser("~/mcp_generated"), db_name)
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        sql = await _ai_sql(
            f"Generate a complete SQLite database schema for: {description}\n"
            "Include CREATE TABLE statements and INSERT sample data."
        )

        if not sql:
            sql = f"CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"

        try:
            conn = sqlite3.connect(db_path)
            conn.executescript(sql)
            conn.commit()

            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            conn.close()

            return {
                "message": f"Database '{db_name}' created with {len(tables)} tables.",
                "data": {
                    "status": "success",
                    "action": "create",
                    "db_path": db_path,
                    "tables": [t[0] for t in tables],
                    "sql": sql[:2000],
                },
            }
        except Exception as e:
            return {"message": f"Database creation failed: {e}", "data": {"status": "error", "error": str(e)}}

    elif action == "migrate":
        if not rest:
            return {"message": "Migrate requires a description. E.g.: MCP db migrate add email column to users table", "data": {"status": "error"}}

        sql = await _ai_sql(f"Generate SQLite migration SQL for: {rest}")
        if not sql:
            sql = f"-- Migration: {rest}\n-- TODO: Add migration SQL here\n"

        return {
            "message": f"Migration SQL generated for: {rest}",
            "data": {
                "status": "success",
                "action": "migrate",
                "description": rest,
                "sql": sql[:3000],
            },
        }

    return {
        "message": f"Unknown database action: '{action}'. Use: schema, query, tables, create, migrate",
        "data": {"status": "error", "action": action},
    }

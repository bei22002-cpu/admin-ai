"""MCP Grid Backend - TRON-themed AI Desktop Assistant API."""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("mcp_grid")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

# Request timeout: 10 min for code generation, 30s for other endpoints
REQUEST_TIMEOUT_CODE = 600
REQUEST_TIMEOUT_DEFAULT = 30

from app.auth import create_token, decode_token, hash_password, verify_password
from app.commands import (
    handle_access,
    handle_alert,
    handle_analyze,
    handle_code,
    handle_report,
    handle_scan,
    handle_search,
)
from app.commands.code import _progress_events
from app.database import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    get_user_projects,
    init_db,
    save_project,
    update_project,
)
from app.utils.phase_manager import PhaseManager
from app.voice.tts import speak_response

load_dotenv()

phase_manager = PhaseManager()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    """MCP Grid startup/shutdown lifecycle."""
    init_db()
    print("╔══════════════════════════════════════════╗")
    print("║       MCP ONLINE - GRID INITIALIZED      ║")
    print("║       Awaiting user input...              ║")
    print("╚══════════════════════════════════════════╝")
    yield
    print("MCP shutting down. End of line.")


app = FastAPI(
    title="MCP Grid",
    description="TRON-themed AI Desktop Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - allow Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ──────────────────────────────────────────────────────

class CommandRequest(BaseModel):
    command: str
    args: str = ""


class CommandResponse(BaseModel):
    status: str
    message: str
    data: dict | None = None
    tron_quote: str = "Command acknowledged. Executing."
    timestamp: float = 0.0


class PhaseRequest(BaseModel):
    phase: int


class SignupRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


# ─── Auth Helper ──────────────────────────────────────────────────


async def get_current_user(authorization: str | None = Header(default=None)) -> dict | None:
    """Extract user from Authorization header. Returns None if not authenticated."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        return None
    user = await get_user_by_id(payload["sub"])
    return user


# ─── Command Router ─────────────────────────────────────────────

COMMAND_MAP = {
    "code": handle_code,
    "search": handle_search,
    "access": handle_access,
    "scan": handle_scan,
    "alert": handle_alert,
    "report": handle_report,
    "analyze": handle_analyze,
}

TRON_QUOTES = [
    "End of line.",
    "I speak for the Master Control Program.",
    "Access granted.",
    "Processing... grid scan complete.",
    "Command acknowledged. Executing.",
    "Sector secured.",
    "All programs have a purpose.",
]


def get_tron_quote() -> str:
    """Cycle through TRON quotes."""
    idx = int(time.time()) % len(TRON_QUOTES)
    return TRON_QUOTES[idx]


@app.get("/")
async def root() -> dict[str, str]:
    """MCP Grid root endpoint."""
    return {
        "status": "online",
        "message": "MCP online. Awaiting user input.",
        "phase": str(phase_manager.current_phase),
    }


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "operational", "message": "MCP systems nominal."}


@app.post("/command", response_model=CommandResponse)
async def execute_command(request: CommandRequest) -> CommandResponse:
    """Execute an MCP command.

    Parses natural language like 'MCP code tron dashboard' or
    direct commands like 'code' with args.
    """
    cmd = request.command.lower().strip()
    args = request.args.strip()

    # Parse "MCP <command> <args>" format
    if cmd.startswith("mcp "):
        parts = cmd[4:].split(" ", 1)
        cmd = parts[0]
        if len(parts) > 1:
            args = parts[1] + (" " + args if args else "")

    handler = COMMAND_MAP.get(cmd)
    if not handler:
        return CommandResponse(
            status="error",
            message=f"Unknown command: {cmd}. Available: {', '.join(COMMAND_MAP.keys())}",
            tron_quote="Program not recognized. End of line.",
            timestamp=time.time(),
        )

    try:
        result = await asyncio.wait_for(
            handler(args),
            timeout=REQUEST_TIMEOUT_CODE if cmd == "code" else REQUEST_TIMEOUT_DEFAULT,
        )
    except asyncio.TimeoutError:
        logger.error(f"Command '{cmd}' timed out")
        return CommandResponse(
            status="error",
            message=f"Command '{cmd}' timed out. Try a simpler request.",
            tron_quote="System timeout. End of line.",
            timestamp=time.time(),
        )
    except Exception as e:
        logger.error(f"Command '{cmd}' failed: {e}")
        return CommandResponse(
            status="error",
            message=f"Command failed: {str(e)[:200]}",
            tron_quote="System malfunction. Retry sequence initiated.",
            timestamp=time.time(),
        )
    return CommandResponse(
        status="success",
        message=result["message"],
        data=result.get("data"),
        tron_quote=get_tron_quote(),
        timestamp=time.time(),
    )


@app.post("/phase")
async def set_phase(request: PhaseRequest) -> dict[str, str | int]:
    """Assimilate a new phase. 'MCP assimilate phase X'."""
    if request.phase < 1 or request.phase > 4:
        return {"status": "error", "message": "Invalid phase. Range: 1-4."}
    phase_manager.current_phase = request.phase
    phase_manager.save_phase()
    return {
        "status": "success",
        "message": f"Phase {request.phase} assimilated. New capabilities unlocked.",
        "phase": request.phase,
        "capabilities": len(phase_manager.get_available_commands()),
    }


@app.get("/phase")
async def get_phase() -> dict[str, int | list[str]]:
    """Get current MCP phase and available commands."""
    return {
        "phase": phase_manager.current_phase,
        "available_commands": phase_manager.get_available_commands(),
    }


@app.post("/tts")
async def text_to_speech(request: CommandRequest) -> dict[str, str]:
    """Generate TRON-style TTS audio."""
    result = await speak_response(request.command)
    return result


# ─── Auth Endpoints ────────────────────────────────────────────────


@app.post("/auth/signup")
async def signup(request: SignupRequest) -> dict:
    """Create a new MCP Grid user account."""
    if len(request.password) < 6:
        return {"status": "error", "message": "Password must be at least 6 characters"}
    if len(request.username) < 2:
        return {"status": "error", "message": "Username must be at least 2 characters"}
    try:
        pw_hash = hash_password(request.password)
        user = await create_user(request.username, request.email, pw_hash)
        token = create_token(user["id"], user["username"])
        return {
            "status": "success",
            "token": token,
            "user": {"id": user["id"], "username": user["username"], "email": user["email"]},
        }
    except ValueError as e:
        return {"status": "error", "message": str(e)}


@app.post("/auth/login")
async def login(request: LoginRequest) -> dict:
    """Log in to MCP Grid."""
    user = await get_user_by_email(request.email)
    if not user or not verify_password(request.password, user["password_hash"]):
        return {"status": "error", "message": "Invalid email or password"}
    token = create_token(user["id"], user["username"])
    return {
        "status": "success",
        "token": token,
        "user": {"id": user["id"], "username": user["username"], "email": user["email"]},
    }


@app.get("/auth/me")
async def get_me(authorization: str | None = Header(default=None)) -> dict:
    """Get current authenticated user."""
    user = await get_current_user(authorization)
    if not user:
        return {"status": "error", "message": "Not authenticated"}
    return {"status": "success", "user": user}


# ─── Project History Endpoints ───────────────────────────────────


@app.get("/projects")
async def list_projects(authorization: str | None = Header(default=None)) -> dict:
    """List projects for the authenticated user."""
    user = await get_current_user(authorization)
    if not user:
        return {"status": "error", "message": "Not authenticated"}
    projects = await get_user_projects(user["id"])
    return {"status": "success", "projects": projects}


@app.post("/command/auth")
async def execute_command_auth(
    request: CommandRequest,
    authorization: str | None = Header(default=None),
) -> CommandResponse:
    """Execute an MCP command with optional auth (saves to project history)."""
    user = await get_current_user(authorization)

    cmd = request.command.lower().strip()
    args = request.args.strip()

    if cmd.startswith("mcp "):
        parts = cmd[4:].split(" ", 1)
        cmd = parts[0]
        if len(parts) > 1:
            args = parts[1] + (" " + args if args else "")

    handler = COMMAND_MAP.get(cmd)
    if not handler:
        return CommandResponse(
            status="error",
            message=f"Unknown command: {cmd}. Available: {', '.join(COMMAND_MAP.keys())}",
            tron_quote="Program not recognized. End of line.",
            timestamp=time.time(),
        )

    # Save project to history if user is authenticated and command is 'code'
    project_id = None
    if user and cmd == "code":
        project_id = await save_project(
            user_id=user["id"],
            name=args[:100],
            description=args,
            status="processing",
        )

    try:
        result = await asyncio.wait_for(
            handler(args),
            timeout=REQUEST_TIMEOUT_CODE if cmd == "code" else REQUEST_TIMEOUT_DEFAULT,
        )
    except asyncio.TimeoutError:
        logger.error(f"Authenticated command '{cmd}' timed out")
        if project_id:
            await update_project(project_id=project_id, status="error")
        return CommandResponse(
            status="error",
            message=f"Command '{cmd}' timed out. Try a simpler request.",
            tron_quote="System timeout. End of line.",
            timestamp=time.time(),
        )
    except Exception as e:
        logger.error(f"Authenticated command '{cmd}' failed: {e}")
        if project_id:
            await update_project(project_id=project_id, status="error")
        return CommandResponse(
            status="error",
            message=f"Command failed: {str(e)[:200]}",
            tron_quote="System malfunction. Retry sequence initiated.",
            timestamp=time.time(),
        )
    response = CommandResponse(
        status="success",
        message=result["message"],
        data=result.get("data"),
        tron_quote=get_tron_quote(),
        timestamp=time.time(),
    )

    # Update project history
    if project_id and result.get("data"):
        data = result["data"]
        await update_project(
            project_id=project_id,
            status=data.get("status", "success"),
            file_count=data.get("file_count", 0),
            output=data.get("output", "")[:500],
            error_count=data.get("error_count", 0),
        )

    return response


# ─── SSE Streaming Endpoint (Enhancement #3) ────────────────────


class StreamRequest(BaseModel):
    project_name: str


@app.post("/command/stream")
async def command_stream(request: StreamRequest) -> StreamingResponse:
    """Stream pipeline progress events via Server-Sent Events.

    The frontend polls this endpoint to get real-time phase updates
    while a complex code generation pipeline is running.
    """
    project = request.project_name

    async def event_generator() -> AsyncGenerator[str, None]:
        sent = 0
        idle_count = 0
        max_idle = 300  # 5 minutes of no new events → close stream

        while idle_count < max_idle:
            events = _progress_events.get(project, [])
            if sent < len(events):
                for evt in events[sent:]:
                    data = (
                        f'{{"phase":"{evt["phase"]}",'
                        f'"detail":"{evt["detail"]}",'
                        f'"progress":{evt["progress"]},'
                        f'"timestamp":{evt["timestamp"]}}}'
                    )
                    yield f"data: {data}\n\n"
                sent = len(events)
                idle_count = 0

                # If pipeline is complete, close the stream
                if events and events[-1]["phase"] == "Complete":
                    yield 'data: {"phase":"Complete","detail":"Stream closed.","progress":1.0}\n\n'
                    break
            else:
                idle_count += 1

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── WebSocket for real-time communication ───────────────────────

connected_clients: list[WebSocket] = []


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket for real-time MCP communication with frontend."""
    await websocket.accept()
    connected_clients.append(websocket)
    await websocket.send_json({
        "type": "system",
        "message": "MCP online. Awaiting user input.",
        "phase": phase_manager.current_phase,
    })
    try:
        while True:
            data = await websocket.receive_json()
            cmd = data.get("command", "")
            args = data.get("args", "")

            request = CommandRequest(command=cmd, args=args)
            response = await execute_command(request)

            await websocket.send_json({
                "type": "response",
                "status": response.status,
                "message": response.message,
                "data": response.data,
                "tron_quote": response.tron_quote,
                "timestamp": response.timestamp,
            })
    except WebSocketDisconnect:
        connected_clients.remove(websocket)
    except Exception:
        connected_clients.remove(websocket)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("MCP_PORT", "1337"))
    host = os.getenv("MCP_HOST", "0.0.0.0")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)

"""MCP Grid Backend - TRON-themed AI Desktop Assistant API."""

import os
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.commands import (
    handle_access,
    handle_alert,
    handle_analyze,
    handle_code,
    handle_report,
    handle_scan,
    handle_search,
)
from app.utils.phase_manager import PhaseManager
from app.voice.tts import speak_response

load_dotenv()

phase_manager = PhaseManager()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    """MCP Grid startup/shutdown lifecycle."""
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

    result = await handler(args)
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


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("MCP_PORT", "1337"))
    host = os.getenv("MCP_HOST", "0.0.0.0")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)

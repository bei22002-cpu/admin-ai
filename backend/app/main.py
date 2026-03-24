"""MCP Grid Backend - TRON-themed AI Desktop Assistant API."""

import asyncio
import io
import logging
import os
import time
import zipfile
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("mcp_grid")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

# Request timeout: 10 min for code generation, 30s for other endpoints
REQUEST_TIMEOUT_CODE = 600
REQUEST_TIMEOUT_DEFAULT = 30

from app.auth import create_token, decode_token, hash_password, verify_password
from app.billing import (
    PLANS,
    check_feature_access,
    check_rate_limit,
    create_checkout_session,
    create_portal_session,
    get_plan_comparison,
    handle_webhook_event,
    increment_usage,
)
from app.commands import (
    handle_access,
    handle_alert,
    handle_analyze,
    handle_apitest,
    handle_clipboard,
    handle_code,
    handle_collab,
    handle_dbmanage,
    handle_docs,
    handle_email,
    handle_filemanage,
    handle_gallery,
    handle_github,
    handle_mobile,
    handle_plugin,
    handle_preview,
    handle_report,
    handle_review,
    handle_scan,
    handle_schedule,
    handle_search,
    handle_shell,
    handle_templates,
    handle_testgen,
    handle_voice,
)
from app.commands.code import OUTPUT_BASE, _progress_events, get_project_files, list_projects as list_generated_projects
from app.vision import (
    analyze_screenshot,
    clear_vision_context,
    extract_text,
    get_vision_context,
    set_monitoring,
)
from app.database import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    get_user_by_stripe_customer,
    get_user_projects,
    init_db,
    save_project,
    update_project,
    update_user_plan,
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
    "review": handle_review,
    "shell": handle_shell,
    "files": handle_filemanage,
    "schedule": handle_schedule,
    "apitest": handle_apitest,
    "docs": handle_docs,
    "github": handle_github,
    "template": handle_templates,
    "db": handle_dbmanage,
    "plugin": handle_plugin,
    "gallery": handle_gallery,
    "voice": handle_voice,
    "clip": handle_clipboard,
    "notify": handle_email,
    "collab": handle_collab,
    "mobile": handle_mobile,
    "preview": handle_preview,
    "test": handle_testgen,
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

    # ── Tiered plan enforcement ──────────────────────────────
    user_plan = user.get("plan", "free") if user else "free"
    user_id = user["id"] if user else 0

    # Check feature access
    allowed, gate_msg = check_feature_access(cmd, user_plan)
    if not allowed:
        return CommandResponse(
            status="error",
            message=gate_msg,
            tron_quote="Access denied. Upgrade required.",
            timestamp=time.time(),
        )

    # Check rate limit
    if user_id:
        allowed, limit_msg = check_rate_limit(user_id, user_plan)
        if not allowed:
            return CommandResponse(
                status="error",
                message=limit_msg,
                tron_quote="Rate limit exceeded. End of line.",
                timestamp=time.time(),
            )
        increment_usage(user_id)

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


# ─── Billing Endpoints ──────────────────────────────────────────


class CheckoutRequest(BaseModel):
    plan: str
    interval: str = "monthly"
    success_url: str = ""
    cancel_url: str = ""


@app.get("/billing/plans")
async def get_plans() -> dict:
    """Get available plans and pricing."""
    return {"status": "success", "plans": get_plan_comparison()}


@app.get("/billing/usage")
async def get_usage(authorization: str | None = Header(default=None)) -> dict:
    """Get current user's plan and usage stats."""
    user = await get_current_user(authorization)
    if not user:
        return {
            "status": "success",
            "plan": "free",
            "usage": {"commands_today": 0, "commands_limit": 10},
        }
    plan = user.get("plan", "free")
    plan_config = PLANS.get(plan, PLANS["free"])
    from app.billing import get_user_usage
    usage = get_user_usage(user["id"])
    return {
        "status": "success",
        "plan": plan,
        "plan_name": plan_config["name"],
        "usage": {
            "commands_today": usage["commands"],
            "commands_limit": plan_config["commands_per_day"],
        },
        "features": plan_config["features"],
    }


@app.post("/billing/checkout")
async def create_checkout(
    request: CheckoutRequest,
    authorization: str | None = Header(default=None),
) -> dict:
    """Create a Stripe checkout session for upgrading."""
    user = await get_current_user(authorization)
    if not user:
        return {"status": "error", "message": "Must be logged in to upgrade"}
    result = await create_checkout_session(
        user_id=user["id"],
        plan=request.plan,
        interval=request.interval,
        success_url=request.success_url,
        cancel_url=request.cancel_url,
    )
    return result


@app.post("/billing/portal")
async def billing_portal(
    authorization: str | None = Header(default=None),
) -> dict:
    """Create a Stripe customer portal session."""
    user = await get_current_user(authorization)
    if not user:
        return {"status": "error", "message": "Not authenticated"}
    stripe_id = user.get("stripe_customer_id", "")
    if not stripe_id:
        return {"status": "error", "message": "No active subscription"}
    result = await create_portal_session(stripe_id)
    return result


@app.post("/billing/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Handle Stripe webhook events."""
    body = await request.json()
    event_type = body.get("type", "")
    data = body.get("data", {}).get("object", {})

    result = handle_webhook_event(event_type, data)

    if result["action"] == "upgrade":
        user_id = result.get("user_id", 0)
        if user_id:
            await update_user_plan(
                user_id=user_id,
                plan=result["plan"],
                stripe_customer_id=result.get("stripe_customer_id", ""),
                stripe_subscription_id=result.get("stripe_subscription_id", ""),
            )
    elif result["action"] == "downgrade":
        user = await get_user_by_stripe_customer(result.get("stripe_customer_id", ""))
        if user:
            await update_user_plan(user_id=user["id"], plan="free")
    elif result["action"] == "payment_failed":
        logger.warning("Payment failed for customer %s", result.get("stripe_customer_id"))

    return {"status": "received"}


# ── Admin helpers ──────────────────────────────────────────────

def _is_admin(user: dict) -> bool:
    """Check if a user has admin privileges.

    Admin is determined by the MCP_ADMIN_EMAILS env var (comma-separated list).
    Falls back to user ID 1 if the env var is not set.
    """
    admin_emails = os.getenv("MCP_ADMIN_EMAILS", "").strip()
    if admin_emails:
        allowed = [e.strip().lower() for e in admin_emails.split(",") if e.strip()]
        return user.get("email", "").lower() in allowed
    # Fallback: first registered user is admin
    return user["id"] == 1


# Owner/admin override — set any user's plan without Stripe
@app.post("/billing/set-plan")
async def admin_set_plan(
    authorization: str | None = Header(default=None),
    user_id: int = 0,
    plan: str = "pro",
) -> dict:
    """Admin: manually set a user's plan (bypasses Stripe)."""
    admin = await get_current_user(authorization)
    if not admin:
        return {"status": "error", "message": "Not authenticated"}
    if not _is_admin(admin):
        return {"status": "error", "message": "Admin access required"}
    target_id = user_id if user_id else admin["id"]
    if plan not in PLANS:
        return {"status": "error", "message": f"Unknown plan: {plan}"}
    await update_user_plan(user_id=target_id, plan=plan)
    return {"status": "success", "message": f"Plan set to {plan} for user {target_id}"}


# ── File Download Endpoints ────────────────────────────────────


@app.get("/files/projects")
async def list_file_projects() -> dict:
    """List all generated projects."""
    projects = list_generated_projects()
    return {"status": "success", "projects": projects}


@app.get("/files/{project_name}")
async def get_project_file_list(project_name: str) -> dict:
    """Get all files and contents for a project."""
    files = get_project_files(project_name)
    if not files:
        return {"status": "error", "message": f"Project not found: {project_name}"}
    return {"status": "success", "project_name": project_name, "files": files}


@app.get("/files/{project_name}/zip")
async def download_project_zip(project_name: str) -> Response:
    """Download an entire project as a ZIP file."""
    project_dir = os.path.join(OUTPUT_BASE, project_name)
    if not os.path.isdir(project_dir):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"Project not found: {project_name}"},
        )
    buf = io.BytesIO()
    skip_dirs = {".git", "__pycache__", "node_modules", ".venv", "venv"}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, filenames in os.walk(project_dir):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fname in filenames:
                full = os.path.join(root, fname)
                arc_name = os.path.join(project_name, os.path.relpath(full, project_dir))
                zf.write(full, arc_name)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.zip"'},
    )


@app.get("/files/{project_name}/{file_path:path}")
async def download_single_file(project_name: str, file_path: str) -> Response:
    """Download a single file from a project."""
    project_dir = os.path.join(OUTPUT_BASE, project_name)
    full_path = os.path.normpath(os.path.join(project_dir, file_path))
    # Prevent directory traversal
    if not full_path.startswith(project_dir) or not os.path.isfile(full_path):
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": f"File not found: {file_path}"},
        )
    with open(full_path, "rb") as f:
        content = f.read()
    # Guess media type
    ext = os.path.splitext(file_path)[1].lower()
    media_types = {
        ".py": "text/x-python", ".js": "text/javascript", ".ts": "text/typescript",
        ".html": "text/html", ".css": "text/css", ".json": "application/json",
        ".md": "text/markdown", ".txt": "text/plain", ".yaml": "text/yaml",
        ".yml": "text/yaml", ".toml": "text/plain", ".rs": "text/plain",
        ".go": "text/plain", ".java": "text/plain", ".rb": "text/plain",
    }
    media = media_types.get(ext, "application/octet-stream")
    fname = os.path.basename(file_path)
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Vision / Desktop Assistant Endpoints ───────────────────────


class VisionAnalyzeRequest(BaseModel):
    image: str  # base64-encoded PNG
    prompt: str = ""
    include_context: bool = True


class VisionOCRRequest(BaseModel):
    image: str  # base64-encoded PNG


class MonitoringConfigRequest(BaseModel):
    enabled: bool | None = None
    interval: int | None = None
    auto_actions: bool | None = None


@app.post("/vision/analyze")
async def vision_analyze(request: VisionAnalyzeRequest) -> dict:
    """Analyze a screenshot using AI vision.

    The Electron desktop app captures the screen and sends the base64 image.
    The AI analyzes what's on screen and provides helpful context.
    """
    if not request.image:
        return {"status": "error", "message": "No image data provided."}
    result = await analyze_screenshot(
        image_b64=request.image,
        prompt=request.prompt,
        include_context=request.include_context,
    )
    return result


@app.post("/vision/ocr")
async def vision_ocr(request: VisionOCRRequest) -> dict:
    """Extract text from a screenshot using AI-powered OCR."""
    if not request.image:
        return {"status": "error", "message": "No image data provided."}
    result = await extract_text(image_b64=request.image)
    return result


@app.get("/vision/context")
async def vision_context_get(limit: int = 20) -> dict:
    """Get recent vision context memory.

    Returns what the AI has recently observed on the user's screen.
    """
    return get_vision_context(limit=limit)


@app.delete("/vision/context")
async def vision_context_clear() -> dict:
    """Clear the vision context memory."""
    return clear_vision_context()


@app.post("/vision/monitoring")
async def vision_monitoring(request: MonitoringConfigRequest) -> dict:
    """Configure continuous screen monitoring.

    When enabled, the Electron app will periodically capture and analyze
    the screen, building up context about what the user is doing.
    """
    return set_monitoring(
        enabled=request.enabled,
        interval=request.interval,
        auto_actions=request.auto_actions,
    )


@app.get("/vision/monitoring")
async def vision_monitoring_status() -> dict:
    """Get current monitoring configuration and status."""
    return set_monitoring()  # returns current state without changes


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("MCP_PORT", "1337"))
    host = os.getenv("MCP_HOST", "0.0.0.0")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)

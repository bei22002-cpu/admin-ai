#!/usr/bin/env bash
# ╔══════════════════════════════════════════╗
# ║       MCP GRID - STARTUP PROTOCOL        ║
# ╚══════════════════════════════════════════╝
# Starts both backend (FastAPI) and frontend (Electron)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════╗"
echo "║       MCP GRID - INITIALIZING...         ║"
echo "╚══════════════════════════════════════════╝"

# ─── Start Backend ───────────────────────────────────────
echo "[MCP] Starting backend on port 1337..."
cd "$PROJECT_DIR/backend"

if [ ! -d ".venv" ]; then
    echo "[MCP] Installing Python dependencies..."
    poetry install --no-interaction
fi

poetry run uvicorn app.main:app --host 0.0.0.0 --port 1337 &
BACKEND_PID=$!
echo "[MCP] Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "[MCP] Waiting for backend..."
for i in $(seq 1 30); do
    if curl -s http://localhost:1337/health > /dev/null 2>&1; then
        echo "[MCP] Backend online."
        break
    fi
    sleep 1
done

# ─── Start Frontend ─────────────────────────────────────
echo "[MCP] Starting Electron frontend..."
cd "$PROJECT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "[MCP] Installing Node dependencies..."
    npm install
fi

npm start &
FRONTEND_PID=$!
echo "[MCP] Frontend PID: $FRONTEND_PID"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       MCP ONLINE - GRID ACTIVATED        ║"
echo "║       Backend:  http://localhost:1337     ║"
echo "║       Ctrl+Space: Quick Command           ║"
echo "║       Ctrl+Shift+Space: Console           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Cleanup on exit
cleanup() {
    echo "[MCP] Shutting down... End of line."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
}

trap cleanup EXIT INT TERM

# Wait for processes
wait

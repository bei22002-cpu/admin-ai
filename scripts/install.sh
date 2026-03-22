#!/usr/bin/env bash
# ╔══════════════════════════════════════════╗
# ║       MCP GRID - INSTALL PROTOCOL        ║
# ╚══════════════════════════════════════════╝
# Auto-detects OS and installs all dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════╗"
echo "║       MCP GRID - INSTALL PROTOCOL        ║"
echo "╚══════════════════════════════════════════╝"

# Detect OS
OS="$(uname -s)"
echo "[MCP] Detected OS: $OS"

# ─── Check Python ────────────────────────────────────────
echo "[MCP] Checking Python 3.11+..."
if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    echo "[MCP] Python $PY_VERSION found."
else
    echo "[MCP] ERROR: Python 3.11+ required. Install from https://python.org"
    exit 1
fi

# ─── Check Node.js ───────────────────────────────────────
echo "[MCP] Checking Node.js 18+..."
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    echo "[MCP] Node $NODE_VERSION found."
else
    echo "[MCP] ERROR: Node.js 18+ required. Install from https://nodejs.org"
    exit 1
fi

# ─── Check Poetry ────────────────────────────────────────
echo "[MCP] Checking Poetry..."
if ! command -v poetry &>/dev/null; then
    echo "[MCP] Installing Poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
fi

# ─── Install Backend Dependencies ─────────────────────────
echo "[MCP] Installing backend dependencies..."
cd "$PROJECT_DIR/backend"
poetry install --no-interaction

# ─── Install Frontend Dependencies ────────────────────────
echo "[MCP] Installing frontend dependencies..."
cd "$PROJECT_DIR/frontend"
npm install

# ─── Install Optional System Dependencies ─────────────────
echo "[MCP] Checking optional dependencies..."

# Tesseract OCR
if ! command -v tesseract &>/dev/null; then
    echo "[MCP] Tesseract OCR not found."
    case "$OS" in
        Linux*)
            echo "[MCP] Install with: sudo apt-get install tesseract-ocr"
            ;;
        Darwin*)
            echo "[MCP] Install with: brew install tesseract"
            ;;
    esac
else
    echo "[MCP] Tesseract OCR: installed."
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       MCP GRID - INSTALL COMPLETE        ║"
echo "║                                          ║"
echo "║  Next steps:                             ║"
echo "║  1. Copy .env.example to .env            ║"
echo "║  2. Add your API keys                    ║"
echo "║  3. Run: ./scripts/start.sh              ║"
echo "║                                          ║"
echo "║  MCP initialization complete.            ║"
echo "╚══════════════════════════════════════════╝"

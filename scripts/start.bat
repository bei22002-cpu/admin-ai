@echo off
REM ╔══════════════════════════════════════════╗
REM ║       MCP GRID - STARTUP PROTOCOL        ║
REM ╚══════════════════════════════════════════╝

echo ========================================
echo        MCP GRID - INITIALIZING...
echo ========================================

REM Start Backend
echo [MCP] Starting backend on port 1337...
cd /d "%~dp0\..\backend"
start /B poetry run uvicorn app.main:app --host 0.0.0.0 --port 1337

REM Wait for backend
echo [MCP] Waiting for backend...
timeout /t 5 /nobreak > nul

REM Start Frontend
echo [MCP] Starting Electron frontend...
cd /d "%~dp0\..\frontend"
if not exist node_modules (
    echo [MCP] Installing Node dependencies...
    npm install
)
start npm start

echo.
echo ========================================
echo        MCP ONLINE - GRID ACTIVATED
echo        Backend:  http://localhost:1337
echo        Ctrl+Space: Quick Command
echo        Ctrl+Shift+Space: Console
echo ========================================
echo.

pause

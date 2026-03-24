@echo off
echo ============================================
echo   MCP Grid Desktop Assistant - Setup
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Download from: https://python.org/downloads
    pause
    exit /b 1
)

:: Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

:: Check for .env
if not exist .env (
    echo.
    echo No .env file found. Creating from template...
    copy .env.example .env
    echo.
    echo IMPORTANT: Edit .env and add your API key:
    echo   - OPENAI_API_KEY=sk-your-key
    echo   - or ANTHROPIC_API_KEY=sk-ant-your-key
    echo.
    notepad .env
)

echo.
echo Setup complete! Run: python assistant.py
pause

# MCP Grid Desktop Assistant

A local AI desktop assistant that can see your screen, generate code, run commands, and manage files.

## Quick Start

### Windows
```
1. Double-click setup.bat
2. Edit .env with your API key
3. Double-click start.bat
```

### macOS / Linux
```bash
chmod +x setup.sh start.sh
./setup.sh
# Edit .env with your API key
./start.sh
```

### Manual Setup
```bash
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API key
python assistant.py
```

## Features

- **Screen Vision** - Captures and analyzes your screen using AI
- **Code Generation** - Write code in any language, saved to ~/mcp_generated/
- **Shell Commands** - Run terminal commands directly from chat
- **File Management** - Read, write, list, and delete files
- **System Monitor** - CPU, memory, disk usage, running processes
- **Clipboard** - Read and write clipboard contents
- **Conversation Memory** - Remembers context across your session
- **System Tray** - Minimizes to tray, always accessible

## Requirements

- Python 3.9+
- OpenAI API key OR Anthropic API key
- Works on Windows, macOS, and Linux

## Configuration

Edit `.env` to configure:
```
OPENAI_API_KEY=sk-your-key        # For GPT-4o-mini
ANTHROPIC_API_KEY=sk-ant-your-key  # For Claude 3.5 Sonnet
```

## Architecture

```
desktop-assistant/
├── assistant.py          # Entry point
├── core/
│   ├── engine.py         # AI engine (OpenAI/Anthropic, memory)
│   └── dispatcher.py     # Tool call parser and executor
├── tools/
│   ├── screenshot.py     # Screen capture (mss)
│   ├── code_gen.py       # Code generation + file saving
│   ├── shell_tool.py     # Shell command execution
│   ├── file_tool.py      # File management
│   ├── system_tool.py    # System info (psutil)
│   └── clipboard_tool.py # Clipboard operations
└── gui/
    └── main_window.py    # PyQt6 chat window + system tray
```

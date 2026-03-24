# MCP GRID

> *"I speak for the Master Control Program."*

**TRON-themed AI Desktop Assistant** — Voice-activated, hotkey-driven, phase-evolving system control.

Wake word **"MCP"** • Neon orange grid UI • Deep robotic voice • 7 core commands • Cross-platform

---

## Quick Start

### Prerequisites

- **Python 3.11+** — [python.org](https://python.org)
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Poetry** — `curl -sSL https://install.python-poetry.org | python3 -`

### One-Line Install

```bash
git clone https://github.com/bei22002-cpu/MCP-Grid.git
cd MCP-Grid
chmod +x scripts/*.sh
./scripts/install.sh
```

### First Boot Protocol

1. **Configure API keys:**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your API keys
   ```

2. **API Keys needed:**
   | Key | Required | Purpose |
   |-----|----------|---------|
   | `OPENAI_API_KEY` | Recommended | AI responses, code gen, search, screen analysis |
   | `GROQ_API_KEY` | Optional | Fast AI alternative |
   | `ELEVENLABS_API_KEY` | Optional | TRON voice synthesis |
   | `PICOVOICE_ACCESS_KEY` | Optional | "MCP" wake word detection |

3. **Launch MCP:**
   ```bash
   ./scripts/start.sh
   ```

4. **Boot message:** `MCP online. Awaiting user input.`

---

## Core Commands (Phase 1)

| Command | Action | Example |
|---------|--------|---------|
| `MCP code [thing]` | Opens VSCode, generates code | `MCP code tron-style dashboard` |
| `MCP search [query]` | Grid scans web for intelligence | `MCP search quantum computing` |
| `MCP access [app]` | Launches apps/files instantly | `MCP access Discord` |
| `MCP scan` | OCR + screen content analysis | `MCP scan for errors` |
| `MCP alert [task] in [time]` | System-wide notification | `MCP alert backup 1800 hours` |
| `MCP report status` | System vitals + capabilities | `MCP report system integrity` |
| `MCP analyze screen` | AI vision describes screen | `MCP analyze screen` |

### Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` | Quick command popup |
| `Ctrl+Shift+Space` | Full MCP console |

### Voice

- **Wake word:** Say "MCP" (requires Picovoice key)
- **Speech-to-text:** Whisper (offline or API)
- **Text-to-speech:** Deep robotic TRON voice (ElevenLabs or system)

---

## Phase Evolution

MCP evolves through voice-activated phases:

```
MCP assimilate phase 2
```

| Phase | Name | Capabilities |
|-------|------|-------------|
| **Phase 1** | Core Protocol | 7 core commands (code, search, access, scan, alert, report, analyze) |
| **Phase 2** | System Domination | Browser control, file grid organization, resource optimization |
| **Phase 3** | Dev Protocol | Code assimilation, git control, debugging |
| **Phase 4** | Total Control | Email/financial systems, predictive user patterns |

---

## Architecture

```
MCP-Grid/
├── backend/                 # Python FastAPI (port 1337)
│   ├── app/
│   │   ├── main.py          # API server + WebSocket
│   │   ├── commands/        # 7 core command handlers
│   │   │   ├── code.py      # VSCode integration
│   │   │   ├── search.py    # Web intelligence
│   │   │   ├── access.py    # App/file launcher
│   │   │   ├── scan.py      # OCR screen scan
│   │   │   ├── alert.py     # Notification system
│   │   │   ├── report.py    # System vitals
│   │   │   └── analyze.py   # AI vision analysis
│   │   ├── voice/           # STT/TTS/Wake word
│   │   └── utils/           # Phase manager
│   └── pyproject.toml
├── frontend/                # Electron app
│   ├── src/
│   │   ├── main/            # Electron main process
│   │   ├── renderer/        # TRON-themed UI
│   │   │   ├── index.html   # Main console
│   │   │   ├── quick-input.html  # Ctrl+Space popup
│   │   │   ├── styles/      # TRON CSS
│   │   │   └── components/  # UI logic
│   │   └── preload/         # IPC bridge
│   ├── assets/              # Icons
│   └── package.json
├── scripts/                 # Startup scripts
│   ├── install.sh           # Auto-installer
│   ├── start.sh             # Linux/Mac launcher
│   └── start.bat            # Windows launcher
└── README.md
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Electron 28 (TRON-styled) |
| Backend | Python FastAPI (port 1337) |
| Voice STT | OpenAI Whisper (offline + API) |
| Voice TTS | ElevenLabs / pyttsx3 |
| Wake Word | Picovoice Porcupine |
| AI | OpenAI GPT-4o / Groq / Ollama |
| OCR | Tesseract |
| System | psutil, PyAutoGUI |

---

## TRON Personality

MCP speaks with authority:

- *"Command acknowledged. Executing."*
- *"Access granted."*
- *"End of line."*
- *"I speak for the users."*
- *"Sector secured. 3 protocols available."*
- *"Processing... grid scan complete."*

Boot: **"MCP online. Awaiting user input."**

---

## Building Installers

```bash
# Windows
cd frontend && npm run build:win

# macOS
cd frontend && npm run build:mac

# Linux
cd frontend && npm run build:linux
```

Outputs:
- `mcp-grid-setup.exe` (Windows NSIS)
- `MCP Grid.dmg` (macOS)
- `MCP-Grid.AppImage` (Linux)

---

## Configuration

Settings stored in `~/.config/mcp-grid/config.json`:

```json
{
  "phase": 1,
  "backendUrl": "http://localhost:1337",
  "theme": "tron",
  "voiceEnabled": true,
  "startOnLogin": true
}
```

---

## Local Fallback

MCP works without any API keys:
- Search uses DuckDuckGo instant answers
- TTS uses system voices (pyttsx3)
- Code command opens VSCode without AI
- Report/scan/access/alert work fully offline

For full AI power, add your OpenAI API key.

---

## Development

```bash
# Backend (auto-reload)
cd backend && poetry run uvicorn app.main:app --port 1337 --reload

# Frontend (dev mode)
cd frontend && npm run dev
```

---

*MCP will assimilate your entire digital environment. Cold. Efficient. Total control.*

**End of line.**

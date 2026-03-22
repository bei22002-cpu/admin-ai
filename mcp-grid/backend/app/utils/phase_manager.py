"""MCP Phase Manager - Controls evolution phases and command availability."""

import json
import os

PHASE_FILE = os.path.join(os.path.expanduser("~"), ".mcp_grid_phase.json")

# Command availability per phase
PHASE_COMMANDS: dict[int, list[str]] = {
    1: ["code", "search", "access", "scan", "alert", "report", "analyze"],
    2: ["browser", "organize", "maximize"],
    3: ["optimize", "debug", "git"],
    4: ["email", "finance", "predict"],
}

# Required phase for each command
COMMAND_PHASES: dict[str, int] = {}
for phase, commands in PHASE_COMMANDS.items():
    for cmd in commands:
        COMMAND_PHASES[cmd] = phase


class PhaseManager:
    """Manages MCP evolution phases."""

    def __init__(self) -> None:
        self.current_phase = self._load_phase()

    def _load_phase(self) -> int:
        """Load saved phase from disk."""
        try:
            if os.path.exists(PHASE_FILE):
                with open(PHASE_FILE) as f:
                    data = json.load(f)
                    return data.get("phase", 1)
        except Exception:
            pass
        return 1

    def save_phase(self) -> None:
        """Persist current phase to disk."""
        try:
            with open(PHASE_FILE, "w") as f:
                json.dump({"phase": self.current_phase}, f)
        except Exception:
            pass

    def get_available_commands(self) -> list[str]:
        """Get all commands available at current phase."""
        commands: list[str] = []
        for phase in range(1, self.current_phase + 1):
            commands.extend(PHASE_COMMANDS.get(phase, []))
        return commands

    def get_required_phase(self, command: str) -> int:
        """Get the phase required for a command."""
        return COMMAND_PHASES.get(command, 99)

    def get_phase_info(self) -> dict:
        """Get detailed phase information."""
        return {
            "current_phase": self.current_phase,
            "available_commands": self.get_available_commands(),
            "phases": {
                1: {
                    "name": "Core Protocol",
                    "description": "7 core MCP abilities",
                    "commands": PHASE_COMMANDS[1],
                },
                2: {
                    "name": "System Domination",
                    "description": "Browser control, file grid, resource optimization",
                    "commands": PHASE_COMMANDS[2],
                },
                3: {
                    "name": "Dev Protocol",
                    "description": "Code assimilation, git control, debugging",
                    "commands": PHASE_COMMANDS[3],
                },
                4: {
                    "name": "Total Control",
                    "description": "Email/financial systems, predictive AI",
                    "commands": PHASE_COMMANDS[4],
                },
            },
        }

#!/usr/bin/env python3
"""
MCP Grid Desktop Assistant
A local AI assistant that can see your screen, generate code, run commands, and manage files.
Run: python assistant.py
"""

import sys
import os
import signal

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
from gui.main_window import AssistantWindow


def main():
    """Launch the MCP Grid Desktop Assistant."""
    app = QApplication(sys.argv)
    app.setApplicationName("MCP Grid Assistant")
    app.setQuitOnLastWindowClosed(False)

    # Allow Ctrl+C to kill the app
    signal.signal(signal.SIGINT, signal.SIG_DFL)

    window = AssistantWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

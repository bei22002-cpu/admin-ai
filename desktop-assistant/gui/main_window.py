"""
Main GUI window for the MCP Grid Desktop Assistant.
PyQt6-based floating chat window with system tray.
"""

import os
import sys
import json
import threading

from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTextEdit, QLineEdit, QPushButton, QLabel,
    QSystemTrayIcon, QMenu, QApplication, QFrame,
    QScrollArea, QSizePolicy,
)
from PyQt6.QtCore import Qt, QSize, pyqtSignal, QThread
from PyQt6.QtGui import (
    QIcon, QFont, QColor, QPalette, QAction,
    QTextCursor, QPixmap, QPainter, QBrush, QPen,
)

from core.engine import AIEngine
from core.dispatcher import extract_tool_call, execute_tool


# ── Color Theme (TRON-inspired) ──────────────────────────────────────────────
COLORS = {
    "bg": "#0a0a14",
    "bg_light": "#12121e",
    "bg_input": "#1a1a2e",
    "border": "#1e1e3a",
    "text": "#e0e0e0",
    "text_dim": "#888899",
    "cyan": "#00ffd5",
    "orange": "#ff6600",
    "red": "#ff4444",
    "green": "#44ff88",
    "purple": "#aa88ff",
}

STYLESHEET = f"""
QMainWindow {{
    background-color: {COLORS['bg']};
}}
QWidget {{
    background-color: {COLORS['bg']};
    color: {COLORS['text']};
    font-family: 'Segoe UI', 'SF Pro', 'Helvetica Neue', sans-serif;
    font-size: 13px;
}}
QTextEdit {{
    background-color: {COLORS['bg_light']};
    color: {COLORS['text']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    selection-background-color: {COLORS['cyan']};
    selection-color: {COLORS['bg']};
}}
QLineEdit {{
    background-color: {COLORS['bg_input']};
    color: {COLORS['text']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 14px;
}}
QLineEdit:focus {{
    border: 1px solid {COLORS['cyan']};
}}
QPushButton {{
    background-color: {COLORS['bg_input']};
    color: {COLORS['cyan']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: bold;
}}
QPushButton:hover {{
    background-color: {COLORS['border']};
    border-color: {COLORS['cyan']};
}}
QPushButton:pressed {{
    background-color: {COLORS['cyan']};
    color: {COLORS['bg']};
}}
QPushButton#sendBtn {{
    background-color: rgba(0, 255, 213, 0.15);
    border-color: {COLORS['cyan']};
    min-width: 70px;
}}
QPushButton#sendBtn:hover {{
    background-color: rgba(0, 255, 213, 0.3);
}}
QPushButton#screenBtn {{
    background-color: rgba(255, 102, 0, 0.15);
    color: {COLORS['orange']};
    border-color: rgba(255, 102, 0, 0.3);
}}
QPushButton#screenBtn:hover {{
    background-color: rgba(255, 102, 0, 0.3);
}}
QLabel#titleLabel {{
    color: {COLORS['cyan']};
    font-size: 16px;
    font-weight: bold;
}}
QLabel#statusLabel {{
    color: {COLORS['text_dim']};
    font-size: 11px;
}}
"""


def create_tray_icon() -> QPixmap:
    """Create a simple tray icon programmatically."""
    pixmap = QPixmap(32, 32)
    pixmap.fill(QColor(0, 0, 0, 0))
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QBrush(QColor(0, 255, 213)))
    painter.setPen(QPen(QColor(0, 200, 170), 2))
    painter.drawEllipse(4, 4, 24, 24)
    painter.setBrush(QBrush(QColor(10, 10, 20)))
    painter.drawEllipse(10, 10, 12, 12)
    painter.end()
    return pixmap


class AIWorker(QThread):
    """Background thread for AI calls so GUI doesn't freeze."""
    response_ready = pyqtSignal(str)
    tool_result_ready = pyqtSignal(str, str)  # tool_name, result

    def __init__(self, engine: AIEngine, message: str):
        super().__init__()
        self.engine = engine
        self.message = message

    def run(self):
        response = self.engine.chat(self.message)

        # Check for tool calls
        tool_call = extract_tool_call(response)
        if tool_call:
            tool_name = tool_call.get("tool", "unknown")
            result = execute_tool(tool_call, self.engine)
            self.tool_result_ready.emit(tool_name, result)

            # Feed tool result back to AI for a follow-up response
            follow_up = self.engine.chat(
                f"Tool '{tool_name}' returned:\n{result}\n\n"
                "Summarize the result for the user. Be concise."
            )
            self.response_ready.emit(follow_up)
        else:
            self.response_ready.emit(response)


class ScreenAnalyzeWorker(QThread):
    """Background thread for screen capture + analysis."""
    result_ready = pyqtSignal(str)

    def __init__(self, engine: AIEngine, prompt: str = ""):
        super().__init__()
        self.engine = engine
        self.prompt = prompt or "Describe what you see on this screen. Be concise and helpful."

    def run(self):
        from tools.screenshot import capture_screen
        image_b64 = capture_screen()
        if image_b64:
            analysis = self.engine.analyze_image(image_b64, self.prompt)
            self.engine.memory.add_screen_observation(analysis[:200])
            self.result_ready.emit(analysis)
        else:
            self.result_ready.emit("Failed to capture screen. Make sure mss and Pillow are installed.")


class AssistantWindow(QMainWindow):
    """Main assistant window with chat interface."""

    def __init__(self):
        super().__init__()
        self.engine = AIEngine()
        self.worker = None
        self.screen_worker = None

        self._setup_window()
        self._setup_ui()
        self._setup_tray()
        self._show_welcome()

    def _setup_window(self):
        """Configure window properties."""
        self.setWindowTitle("MCP Grid Assistant")
        self.setMinimumSize(480, 600)
        self.resize(520, 700)
        self.setStyleSheet(STYLESHEET)

        # Window flags: frameless for custom title bar, stay on top optional
        self.setWindowFlags(
            Qt.WindowType.Window |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.WindowCloseButtonHint |
            Qt.WindowType.WindowMinimizeButtonHint
        )

    def _setup_ui(self):
        """Build the UI layout."""
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        # ── Header ─────────────────────────────────────────────
        header = QHBoxLayout()
        title = QLabel("MCP Grid Assistant")
        title.setObjectName("titleLabel")
        header.addWidget(title)

        header.addStretch()

        self.status_label = QLabel("Ready")
        self.status_label.setObjectName("statusLabel")
        header.addWidget(self.status_label)

        layout.addLayout(header)

        # ── Provider info ──────────────────────────────────────
        provider_text = f"AI: {self.engine.provider.upper()}" if self.engine.provider != "none" else "No AI key configured"
        provider_label = QLabel(provider_text)
        provider_label.setStyleSheet(
            f"color: {COLORS['cyan'] if self.engine.provider != 'none' else COLORS['red']}; "
            f"font-size: 11px; padding: 2px 0;"
        )
        layout.addWidget(provider_label)

        # ── Separator ──────────────────────────────────────────
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {COLORS['border']};")
        layout.addWidget(sep)

        # ── Chat display ───────────────────────────────────────
        self.chat_display = QTextEdit()
        self.chat_display.setReadOnly(True)
        self.chat_display.setFont(QFont("JetBrains Mono", 12))
        self.chat_display.setMinimumHeight(300)
        layout.addWidget(self.chat_display, stretch=1)

        # ── Quick action buttons ───────────────────────────────
        actions = QHBoxLayout()
        actions.setSpacing(6)

        screen_btn = QPushButton("Capture Screen")
        screen_btn.setObjectName("screenBtn")
        screen_btn.clicked.connect(self._on_capture_screen)
        actions.addWidget(screen_btn)

        system_btn = QPushButton("System Info")
        system_btn.clicked.connect(lambda: self._quick_command("Show me system info (CPU, RAM, disk usage)"))
        actions.addWidget(system_btn)

        files_btn = QPushButton("List Files")
        files_btn.clicked.connect(lambda: self._quick_command("List the files in my home directory"))
        actions.addWidget(files_btn)

        layout.addLayout(actions)

        # ── Input area ─────────────────────────────────────────
        input_layout = QHBoxLayout()
        input_layout.setSpacing(8)

        self.input_field = QLineEdit()
        self.input_field.setPlaceholderText("Ask anything... (code, shell commands, screen analysis)")
        self.input_field.returnPressed.connect(self._on_send)
        input_layout.addWidget(self.input_field, stretch=1)

        send_btn = QPushButton("Send")
        send_btn.setObjectName("sendBtn")
        send_btn.clicked.connect(self._on_send)
        input_layout.addWidget(send_btn)

        layout.addLayout(input_layout)

        # ── Footer ─────────────────────────────────────────────
        footer = QLabel("MCP Grid v2.0 | Ctrl+Shift+V: Analyze Screen")
        footer.setStyleSheet(f"color: {COLORS['text_dim']}; font-size: 10px; padding: 2px 0;")
        footer.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(footer)

    def _setup_tray(self):
        """Set up system tray icon and menu."""
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return

        self.tray_icon = QSystemTrayIcon(QIcon(create_tray_icon()), self)

        tray_menu = QMenu()

        show_action = QAction("Show Assistant", self)
        show_action.triggered.connect(self.show)
        tray_menu.addAction(show_action)

        capture_action = QAction("Capture Screen", self)
        capture_action.triggered.connect(self._on_capture_screen)
        tray_menu.addAction(capture_action)

        tray_menu.addSeparator()

        quit_action = QAction("Quit", self)
        quit_action.triggered.connect(QApplication.quit)
        tray_menu.addAction(quit_action)

        self.tray_icon.setContextMenu(tray_menu)
        self.tray_icon.activated.connect(self._on_tray_activated)
        self.tray_icon.show()

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self.isVisible():
                self.hide()
            else:
                self.show()
                self.activateWindow()

    def _show_welcome(self):
        """Show welcome message."""
        welcome = (
            '<div style="color: #00ffd5; font-size: 14px; font-weight: bold; margin-bottom: 8px;">'
            'MCP Grid Assistant Initialized'
            '</div>'
            '<div style="color: #888899; font-size: 12px;">'
            'I can see your screen, generate code, run commands, and manage files.<br>'
            'Type a message or click a quick action button to get started.<br><br>'
            '<b>Examples:</b><br>'
            '&bull; "What\'s on my screen?"<br>'
            '&bull; "Write a Python script that sorts a CSV file"<br>'
            '&bull; "Show me running processes"<br>'
            '&bull; "Create a Flask REST API for a todo app"<br>'
            '</div>'
        )
        self.chat_display.setHtml(welcome)

    def _append_message(self, sender: str, text: str, color: str = None):
        """Append a message to the chat display."""
        if not color:
            color = COLORS['cyan'] if sender == "You" else COLORS['text']
        if sender == "Tool":
            color = COLORS['orange']
        elif sender == "Error":
            color = COLORS['red']

        # Escape HTML in text but preserve line breaks
        import html
        escaped = html.escape(text).replace("\n", "<br>")

        html_msg = (
            f'<div style="margin: 8px 0;">'
            f'<span style="color: {color}; font-weight: bold; font-size: 12px;">{sender}</span><br>'
            f'<span style="color: {COLORS["text"]}; font-size: 13px;">{escaped}</span>'
            f'</div>'
        )
        cursor = self.chat_display.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.chat_display.setTextCursor(cursor)
        self.chat_display.insertHtml(html_msg)
        self.chat_display.ensureCursorVisible()

    def _on_send(self):
        """Handle sending a message."""
        text = self.input_field.text().strip()
        if not text:
            return

        self.input_field.clear()
        self._append_message("You", text, COLORS['cyan'])
        self._set_status("Thinking...")

        # Run AI in background thread
        self.worker = AIWorker(self.engine, text)
        self.worker.response_ready.connect(self._on_response)
        self.worker.tool_result_ready.connect(self._on_tool_result)
        self.worker.finished.connect(lambda: self._set_status("Ready"))
        self.worker.start()

    def _on_response(self, response: str):
        """Handle AI response."""
        self._append_message("Assistant", response)

    def _on_tool_result(self, tool_name: str, result: str):
        """Handle tool execution result."""
        self._append_message("Tool", f"[{tool_name}]\n{result}")

    def _on_capture_screen(self):
        """Capture and analyze the screen."""
        self._set_status("Capturing screen...")
        self._append_message("You", "Analyze my screen", COLORS['cyan'])

        self.screen_worker = ScreenAnalyzeWorker(self.engine)
        self.screen_worker.result_ready.connect(lambda r: (
            self._append_message("Assistant", r),
            self._set_status("Ready"),
        ))
        self.screen_worker.start()

    def _quick_command(self, command: str):
        """Run a quick command."""
        self.input_field.setText(command)
        self._on_send()

    def _set_status(self, text: str):
        """Update status label."""
        self.status_label.setText(text)

    def closeEvent(self, event):
        """Minimize to tray instead of closing."""
        if hasattr(self, 'tray_icon') and self.tray_icon.isVisible():
            self.hide()
            event.ignore()
        else:
            event.accept()

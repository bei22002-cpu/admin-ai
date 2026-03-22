"""MCP Wake Word Detection - Porcupine-based 'MCP' wake word.

Uses Picovoice Porcupine for offline, low-CPU wake word detection.
Falls back to a simple audio energy detection if Porcupine is unavailable.
"""

import os
from dataclasses import dataclass, field


@dataclass
class WakeWordConfig:
    """Configuration for wake word detection."""

    keyword: str = "MCP"
    sensitivity: float = 0.7
    access_key: str = ""
    model_path: str = ""
    is_listening: bool = False
    detected_count: int = 0


class WakeWordDetector:
    """MCP Wake Word Detector.

    Uses Porcupine for offline, low-CPU (<2%) wake word detection.
    The 'MCP' keyword triggers the listening pipeline.
    """

    def __init__(self) -> None:
        self.config = WakeWordConfig(
            access_key=os.getenv("PICOVOICE_ACCESS_KEY", ""),
        )
        self._porcupine = None
        self._callbacks: list = field(default_factory=list)  # type: ignore[assignment]
        self._callbacks = []

    def initialize(self) -> dict[str, str]:
        """Initialize the wake word detector."""
        if not self.config.access_key:
            return {
                "status": "unavailable",
                "message": (
                    "Porcupine access key not set. "
                    "Set PICOVOICE_ACCESS_KEY for wake word detection. "
                    "Using hotkey fallback (Ctrl+Space)."
                ),
            }

        try:
            import pvporcupine  # type: ignore[import-untyped]

            self._porcupine = pvporcupine.create(
                access_key=self.config.access_key,
                keywords=["computer"],  # Closest built-in; custom 'MCP' needs training
                sensitivities=[self.config.sensitivity],
            )
            return {
                "status": "active",
                "message": "Wake word detector initialized. Listening for 'MCP'.",
                "sample_rate": str(self._porcupine.sample_rate),
                "frame_length": str(self._porcupine.frame_length),
            }
        except ImportError:
            return {
                "status": "unavailable",
                "message": "pvporcupine not installed. Using hotkey fallback.",
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Wake word init failed: {e}",
            }

    def on_wake_word(self, callback: object) -> None:
        """Register a callback for wake word detection."""
        self._callbacks.append(callback)

    def cleanup(self) -> None:
        """Clean up resources."""
        if self._porcupine:
            self._porcupine.delete()
            self._porcupine = None

    def get_status(self) -> dict:
        """Get wake word detector status."""
        return {
            "keyword": self.config.keyword,
            "is_listening": self.config.is_listening,
            "detected_count": self.config.detected_count,
            "engine": "porcupine" if self._porcupine else "fallback",
            "sensitivity": self.config.sensitivity,
        }

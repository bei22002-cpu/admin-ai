"""
Screen capture tool using mss (cross-platform).
"""

import base64
import io
import time
from typing import Optional


def capture_screen(monitor_index: int = 1) -> Optional[str]:
    """Capture the screen and return base64-encoded PNG."""
    try:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            monitors = sct.monitors
            if monitor_index >= len(monitors):
                monitor_index = 1
            screenshot = sct.grab(monitors[monitor_index])

            img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
            # Resize for API efficiency (max 1920px wide)
            if img.width > 1920:
                ratio = 1920 / img.width
                img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
    except Exception as e:
        return None


def capture_region(x: int, y: int, width: int, height: int) -> Optional[str]:
    """Capture a specific region of the screen."""
    try:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            region = {"left": x, "top": y, "width": width, "height": height}
            screenshot = sct.grab(region)

            img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
            buffer = io.BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
    except Exception as e:
        return None


def save_screenshot(path: str = None) -> str:
    """Save a screenshot to disk and return the path."""
    try:
        import mss
        from PIL import Image

        if not path:
            path = f"screenshot_{int(time.time())}.png"

        with mss.mss() as sct:
            screenshot = sct.grab(sct.monitors[1])
            img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
            img.save(path)
            return f"Screenshot saved to {path}"
    except Exception as e:
        return f"Screenshot failed: {str(e)}"

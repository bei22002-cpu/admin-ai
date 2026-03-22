"""MCP Scan Command - OCR + analyzes screen contents."""

import base64
import io
import os
import platform
import subprocess
import tempfile

from PIL import Image


async def handle_scan(args: str) -> dict:
    """Handle 'MCP scan' command.

    Takes a screenshot and performs OCR analysis.
    """
    system = platform.system()

    # Take screenshot
    screenshot_path = os.path.join(tempfile.gettempdir(), "mcp_scan.png")
    screenshot_taken = False

    try:
        if system == "Darwin":
            subprocess.run(
                ["screencapture", "-x", screenshot_path],
                capture_output=True,
                timeout=10,
            )
            screenshot_taken = True
        elif system == "Linux":
            # Try multiple screenshot tools
            for tool in ["gnome-screenshot", "scrot", "import"]:
                try:
                    if tool == "import":
                        subprocess.run(
                            ["import", "-window", "root", screenshot_path],
                            capture_output=True,
                            timeout=10,
                        )
                    else:
                        subprocess.run(
                            [tool, "-f", screenshot_path],
                            capture_output=True,
                            timeout=10,
                        )
                    if os.path.exists(screenshot_path):
                        screenshot_taken = True
                        break
                except FileNotFoundError:
                    continue
        elif system == "Windows":
            try:
                import pyautogui  # type: ignore[import-untyped]

                img = pyautogui.screenshot()
                img.save(screenshot_path)
                screenshot_taken = True
            except ImportError:
                pass
    except Exception as e:
        return {
            "message": f"Screen scan failed: {e}",
            "data": {"status": "error", "error": str(e)},
        }

    if not screenshot_taken:
        return {
            "message": "Screen scan unavailable. No screenshot tool found.",
            "data": {
                "status": "unavailable",
                "platform": system,
                "suggestion": "Install scrot (Linux) or ensure screen capture permissions (macOS).",
            },
        }

    # Perform OCR if pytesseract is available
    ocr_text = ""
    try:
        import pytesseract  # type: ignore[import-untyped]

        img = Image.open(screenshot_path)
        ocr_text = pytesseract.image_to_string(img)
    except Exception:
        ocr_text = "[OCR unavailable - install Tesseract for text extraction]"

    # Get image dimensions and thumbnail
    try:
        img = Image.open(screenshot_path)
        width, height = img.size

        # Create thumbnail for transfer
        img.thumbnail((400, 300))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        thumbnail_b64 = base64.b64encode(buffer.getvalue()).decode()
    except Exception:
        width, height = 0, 0
        thumbnail_b64 = ""

    # Cleanup
    try:
        os.remove(screenshot_path)
    except OSError:
        pass

    return {
        "message": f"Screen scan complete. Resolution: {width}x{height}. "
        f"{'Text detected.' if ocr_text.strip() else 'No text detected.'}",
        "data": {
            "status": "complete",
            "resolution": f"{width}x{height}",
            "ocr_text": ocr_text[:2000] if ocr_text else "",
            "thumbnail": thumbnail_b64[:100] + "..." if thumbnail_b64 else "",
            "has_text": bool(ocr_text.strip()),
        },
    }

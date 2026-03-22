"""MCP Analyze Screen Command - Describes + acts on visual data."""

import base64
import os
import platform
import subprocess
import tempfile

import httpx
from PIL import Image


async def handle_analyze(args: str) -> dict:
    """Handle 'MCP analyze screen' command.

    Captures screen and uses AI vision to describe and analyze contents.
    """
    system = platform.system()
    screenshot_path = os.path.join(tempfile.gettempdir(), "mcp_analyze.png")
    screenshot_taken = False

    # Capture screenshot
    try:
        if system == "Darwin":
            subprocess.run(
                ["screencapture", "-x", screenshot_path],
                capture_output=True,
                timeout=10,
            )
            screenshot_taken = os.path.exists(screenshot_path)
        elif system == "Linux":
            for tool in ["gnome-screenshot", "scrot"]:
                try:
                    subprocess.run(
                        [tool, "-f" if tool == "scrot" else "--file", screenshot_path],
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
            "message": f"Screen analysis failed: {e}",
            "data": {"status": "error", "error": str(e)},
        }

    if not screenshot_taken:
        return {
            "message": "Screen capture unavailable. Cannot perform visual analysis.",
            "data": {
                "status": "unavailable",
                "platform": system,
            },
        }

    # Read and encode screenshot
    try:
        img = Image.open(screenshot_path)
        width, height = img.size

        # Resize for API (max 1024px)
        max_dim = 1024
        if width > max_dim or height > max_dim:
            ratio = min(max_dim / width, max_dim / height)
            img = img.resize((int(width * ratio), int(height * ratio)))

        # Convert to base64
        import io

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        img_b64 = base64.b64encode(buffer.getvalue()).decode()
    except Exception as e:
        return {
            "message": f"Image processing failed: {e}",
            "data": {"status": "error"},
        }

    # Use OpenAI Vision API for analysis
    api_key = os.getenv("OPENAI_API_KEY", "")
    analysis = ""

    if api_key and api_key != "your-openai-api-key-here":
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are MCP, a TRON-themed AI. Analyze this screen "
                                    "capture with authority. Describe what you see, identify "
                                    "applications, text, and actionable elements. "
                                    "Use grid/TRON terminology."
                                ),
                            },
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": (
                                            f"Analyze this screen. "
                                            f"Additional context: {args}"
                                            if args
                                            else "Analyze this screen capture."
                                        ),
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {
                                            "url": f"data:image/png;base64,{img_b64}"
                                        },
                                    },
                                ],
                            },
                        ],
                        "max_tokens": 500,
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    analysis = data["choices"][0]["message"]["content"]
        except Exception as e:
            analysis = f"AI vision analysis failed: {e}"
    else:
        analysis = (
            "AI vision not configured. Set OPENAI_API_KEY for screen analysis. "
            f"Screen captured at {width}x{height}."
        )

    # Cleanup
    try:
        os.remove(screenshot_path)
    except OSError:
        pass

    return {
        "message": f"Screen analysis complete. Resolution: {width}x{height}.",
        "data": {
            "status": "complete",
            "resolution": f"{width}x{height}",
            "analysis": analysis,
            "ai_enabled": bool(api_key and api_key != "your-openai-api-key-here"),
        },
    }

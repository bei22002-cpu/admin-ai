"""MCP Grid Vision System - Screen analysis, OCR, and context memory.

Provides endpoints for:
- Screenshot analysis via GPT-4o Vision / Claude Vision
- OCR text extraction from images
- Context memory (remembers what the AI has seen)
- Continuous monitoring support
"""

import base64
import io
import os
import time
from collections import deque
from typing import Any

import httpx

# Vision context memory - stores recent analyses
_vision_memory: deque[dict[str, Any]] = deque(maxlen=50)

# Active monitoring state
_monitoring_state: dict[str, Any] = {
    "enabled": False,
    "interval": 10,  # seconds between captures
    "last_capture": 0,
    "total_captures": 0,
    "auto_actions": True,  # suggest actions based on what it sees
}


def _get_ai_client_config() -> tuple[str, str, str]:
    """Get the best available AI provider config for vision.

    Returns (provider, api_key, model).
    GPT-4o is preferred for vision, Claude as fallback.
    """
    openai_key = os.getenv("OPENAI_API_KEY", "")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")

    if openai_key and openai_key != "your-openai-api-key-here":
        return "openai", openai_key, "gpt-4o-mini"
    if anthropic_key and anthropic_key != "your-anthropic-api-key-here":
        return "anthropic", anthropic_key, "claude-3-5-sonnet-20241022"
    return "none", "", ""


async def _analyze_with_openai(
    api_key: str,
    model: str,
    image_b64: str,
    prompt: str,
    context: str = "",
) -> str:
    """Analyze image using OpenAI Vision API."""
    system_msg = (
        "You are MCP, a TRON-themed AI desktop assistant with full screen vision. "
        "You can see the user's screen and help them with anything they're doing. "
        "Be helpful, specific, and actionable. Reference exact UI elements, text, "
        "and positions you can see. If you see code, help debug it. If you see a "
        "document, help edit it. If you see a browser, help navigate. "
        "Always be precise about what you observe."
    )
    if context:
        system_msg += f"\n\nRecent context from previous observations:\n{context}"

    messages = [
        {"role": "system", "content": system_msg},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                },
            ],
        },
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 1000,
            },
        )
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"]
        return f"OpenAI API error: {response.status_code} - {response.text[:200]}"


async def _analyze_with_anthropic(
    api_key: str,
    model: str,
    image_b64: str,
    prompt: str,
    context: str = "",
) -> str:
    """Analyze image using Anthropic Claude Vision API."""
    system_msg = (
        "You are MCP, a TRON-themed AI desktop assistant with full screen vision. "
        "You can see the user's screen and help them with anything they're doing. "
        "Be helpful, specific, and actionable. Reference exact UI elements, text, "
        "and positions you can see."
    )
    if context:
        system_msg += f"\n\nRecent context from previous observations:\n{context}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 1000,
                "system": system_msg,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": image_b64,
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            },
        )
        if response.status_code == 200:
            data = response.json()
            return data["content"][0]["text"]
        return f"Anthropic API error: {response.status_code} - {response.text[:200]}"


async def _extract_text_with_ai(
    provider: str,
    api_key: str,
    model: str,
    image_b64: str,
) -> str:
    """Extract all visible text from an image using AI vision."""
    prompt = (
        "Extract ALL visible text from this screenshot. "
        "Preserve the layout and structure as much as possible. "
        "Include text from menus, buttons, labels, content areas, "
        "status bars, and any other visible text elements. "
        "Format it clearly with section headers where appropriate."
    )
    if provider == "openai":
        return await _analyze_with_openai(api_key, model, image_b64, prompt)
    if provider == "anthropic":
        return await _analyze_with_anthropic(api_key, model, image_b64, prompt)
    return "No AI provider configured for OCR."


def _get_recent_context(limit: int = 5) -> str:
    """Get recent vision context as a summary string."""
    if not _vision_memory:
        return ""
    recent = list(_vision_memory)[-limit:]
    parts = []
    for entry in recent:
        ts = time.strftime("%H:%M:%S", time.localtime(entry["timestamp"]))
        summary = entry.get("summary", "")[:200]
        parts.append(f"[{ts}] {summary}")
    return "\n".join(parts)


async def analyze_screenshot(
    image_b64: str,
    prompt: str = "",
    include_context: bool = True,
) -> dict[str, Any]:
    """Analyze a screenshot using the best available AI vision model.

    Args:
        image_b64: Base64-encoded PNG image data
        prompt: Optional prompt/question about the screenshot
        include_context: Whether to include recent vision context

    Returns:
        Dict with analysis results, detected elements, and suggestions
    """
    provider, api_key, model = _get_ai_client_config()

    if provider == "none":
        return {
            "status": "error",
            "message": "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.",
            "analysis": "",
            "provider": "none",
        }

    if not prompt:
        prompt = (
            "Analyze this screen capture. Describe:\n"
            "1. What application/window is currently active\n"
            "2. What the user appears to be doing\n"
            "3. Any notable content, errors, or issues visible\n"
            "4. Suggested next actions the user might want to take\n"
            "Be specific and reference exact text/elements you can see."
        )

    context = _get_recent_context() if include_context else ""

    try:
        if provider == "openai":
            analysis = await _analyze_with_openai(api_key, model, image_b64, prompt, context)
        else:
            analysis = await _analyze_with_anthropic(api_key, model, image_b64, prompt, context)
    except Exception as e:
        return {
            "status": "error",
            "message": f"Vision analysis failed: {str(e)[:200]}",
            "analysis": "",
            "provider": provider,
        }

    # Store in memory
    memory_entry = {
        "timestamp": time.time(),
        "summary": analysis[:300],
        "provider": provider,
        "model": model,
        "prompt": prompt[:100],
    }
    _vision_memory.append(memory_entry)
    _monitoring_state["total_captures"] += 1
    _monitoring_state["last_capture"] = time.time()

    return {
        "status": "success",
        "analysis": analysis,
        "provider": provider,
        "model": model,
        "context_entries": len(_vision_memory),
        "total_captures": _monitoring_state["total_captures"],
    }


async def extract_text(image_b64: str) -> dict[str, Any]:
    """Extract text from a screenshot using AI-powered OCR.

    Args:
        image_b64: Base64-encoded PNG image data

    Returns:
        Dict with extracted text and metadata
    """
    provider, api_key, model = _get_ai_client_config()

    if provider == "none":
        return {
            "status": "error",
            "message": "No AI provider configured for OCR.",
            "text": "",
        }

    try:
        text = await _extract_text_with_ai(provider, api_key, model, image_b64)
    except Exception as e:
        return {
            "status": "error",
            "message": f"OCR failed: {str(e)[:200]}",
            "text": "",
        }

    return {
        "status": "success",
        "text": text,
        "provider": provider,
        "model": model,
    }


def get_vision_context(limit: int = 20) -> dict[str, Any]:
    """Get the vision context memory.

    Returns recent observations the AI has made about the screen.
    """
    entries = list(_vision_memory)[-limit:]
    return {
        "status": "success",
        "entries": entries,
        "total": len(_vision_memory),
        "monitoring": {
            "enabled": _monitoring_state["enabled"],
            "interval": _monitoring_state["interval"],
            "total_captures": _monitoring_state["total_captures"],
            "last_capture": _monitoring_state["last_capture"],
        },
    }


def clear_vision_context() -> dict[str, str]:
    """Clear the vision context memory."""
    _vision_memory.clear()
    _monitoring_state["total_captures"] = 0
    _monitoring_state["last_capture"] = 0
    return {"status": "success", "message": "Vision context cleared."}


def set_monitoring(
    enabled: bool | None = None,
    interval: int | None = None,
    auto_actions: bool | None = None,
) -> dict[str, Any]:
    """Configure the continuous monitoring mode.

    Args:
        enabled: Enable/disable monitoring
        interval: Seconds between captures (5-300)
        auto_actions: Whether to suggest actions automatically
    """
    if enabled is not None:
        _monitoring_state["enabled"] = enabled
    if interval is not None:
        _monitoring_state["interval"] = max(5, min(300, interval))
    if auto_actions is not None:
        _monitoring_state["auto_actions"] = auto_actions

    return {
        "status": "success",
        "monitoring": _monitoring_state.copy(),
    }

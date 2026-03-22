"""MCP STT - Speech-to-Text using Whisper (offline-first)."""

import os
import tempfile


async def transcribe_audio(audio_data: bytes, model: str = "base") -> dict[str, str]:
    """Transcribe audio using OpenAI Whisper.

    Tries local Whisper first, falls back to OpenAI API.

    Args:
        audio_data: Raw audio bytes (WAV format).
        model: Whisper model size (tiny/base/small/medium/large).
    """
    # Save audio to temp file
    temp_path = os.path.join(tempfile.gettempdir(), "mcp_audio.wav")
    with open(temp_path, "wb") as f:
        f.write(audio_data)

    # Try local Whisper first (offline)
    try:
        import whisper  # type: ignore[import-untyped]

        whisper_model = whisper.load_model(model)
        result = whisper_model.transcribe(temp_path)
        text = result.get("text", "").strip()

        _cleanup_temp(temp_path)
        return {
            "status": "success",
            "engine": "whisper_local",
            "text": text,
            "model": model,
        }
    except ImportError:
        pass
    except Exception:
        pass

    # Fallback: OpenAI Whisper API
    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key and api_key != "your-openai-api-key-here":
        try:
            import httpx

            async with httpx.AsyncClient(timeout=30.0) as client:
                with open(temp_path, "rb") as audio_file:
                    response = await client.post(
                        "https://api.openai.com/v1/audio/transcriptions",
                        headers={"Authorization": f"Bearer {api_key}"},
                        files={"file": ("audio.wav", audio_file, "audio/wav")},
                        data={"model": "whisper-1"},
                    )
                    if response.status_code == 200:
                        data = response.json()
                        _cleanup_temp(temp_path)
                        return {
                            "status": "success",
                            "engine": "whisper_api",
                            "text": data.get("text", ""),
                            "model": "whisper-1",
                        }
        except Exception:
            pass

    _cleanup_temp(temp_path)
    return {
        "status": "unavailable",
        "engine": "none",
        "text": "",
        "message": "STT unavailable. Install openai-whisper or set OPENAI_API_KEY.",
    }


def _cleanup_temp(path: str) -> None:
    """Clean up temporary audio file."""
    try:
        os.remove(path)
    except OSError:
        pass

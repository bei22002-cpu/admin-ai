"""MCP TTS - TRON-style Text-to-Speech engine."""

import os

import httpx


async def speak_response(text: str) -> dict[str, str]:
    """Generate TRON-style speech from text.

    Tries ElevenLabs first, falls back to system TTS.
    """
    # Try ElevenLabs for deep robotic TRON voice
    elevenlabs_key = os.getenv("ELEVENLABS_API_KEY", "")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "")

    if elevenlabs_key and elevenlabs_key != "your-elevenlabs-key-here":
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                    headers={
                        "xi-api-key": elevenlabs_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "text": text,
                        "model_id": "eleven_monolingual_v1",
                        "voice_settings": {
                            "stability": 0.85,
                            "similarity_boost": 0.75,
                            "style": 0.5,
                            "use_speaker_boost": True,
                        },
                    },
                )
                if response.status_code == 200:
                    return {
                        "status": "success",
                        "engine": "elevenlabs",
                        "message": f"TRON voice synthesized: {text[:50]}...",
                    }
        except Exception:
            pass

    # Fallback: system TTS via pyttsx3
    try:
        import pyttsx3  # type: ignore[import-untyped]

        engine = pyttsx3.init()
        voices = engine.getProperty("voices")

        # Try to find a deep/male voice
        for voice in voices:
            if "male" in voice.name.lower() or "david" in voice.name.lower():
                engine.setProperty("voice", voice.id)
                break

        # Slow rate for robotic effect
        engine.setProperty("rate", 140)
        engine.setProperty("volume", 0.9)
        engine.say(text)
        engine.runAndWait()

        return {
            "status": "success",
            "engine": "pyttsx3",
            "message": f"System TTS: {text[:50]}...",
        }
    except Exception as e:
        return {
            "status": "fallback",
            "engine": "none",
            "message": f"TTS unavailable ({e}). Text output: {text}",
        }

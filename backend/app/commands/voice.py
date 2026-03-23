"""MCP Voice Command - Voice control configuration and status."""

import os
import json


# Voice config storage
VOICE_CONFIG_PATH = os.path.expanduser("~/mcp_voice_config.json")


def _load_voice_config() -> dict:
    """Load voice configuration."""
    defaults = {
        "enabled": False,
        "wake_word": "MCP",
        "stt_engine": "whisper",
        "tts_engine": "system",
        "tts_voice": "robotic",
        "language": "en-US",
        "sensitivity": 0.5,
        "continuous_listening": True,
        "confirmation_sound": True,
        "shortcuts": {
            "code": "MCP code",
            "search": "MCP search",
            "review": "MCP review",
            "shell": "MCP shell",
        },
    }

    if os.path.exists(VOICE_CONFIG_PATH):
        try:
            with open(VOICE_CONFIG_PATH) as f:
                saved = json.load(f)
                defaults.update(saved)
        except Exception:
            pass

    return defaults


def _save_voice_config(config: dict):
    """Save voice configuration."""
    with open(VOICE_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


async def handle_voice(args: str) -> dict:
    """Handle 'MCP voice [action]' command.

    Actions: status, enable, disable, config, test
    """
    config = _load_voice_config()

    if not args:
        return {
            "message": "Voice control system. Usage: MCP voice [action]",
            "data": {
                "status": "success",
                "voice_config": config,
                "actions": {
                    "status": "Show voice system status",
                    "enable": "Enable voice commands",
                    "disable": "Disable voice commands",
                    "config": "View/update voice configuration",
                    "test": "Test text-to-speech output",
                    "wake": "Set wake word",
                },
                "requirements": [
                    "PyAudio (pip install pyaudio) for microphone access",
                    "Whisper or system STT for speech recognition",
                    "pyttsx3 or system TTS for voice output",
                ],
            },
        }

    parts = args.strip().split(None, 1)
    action = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if action == "status":
        # Check if audio dependencies are available
        deps = {}
        try:
            import pyaudio
            deps["pyaudio"] = True
        except ImportError:
            deps["pyaudio"] = False

        try:
            import pyttsx3
            deps["pyttsx3"] = True
        except ImportError:
            deps["pyttsx3"] = False

        try:
            import whisper
            deps["whisper"] = True
        except ImportError:
            deps["whisper"] = False

        return {
            "message": f"Voice system: {'ENABLED' if config['enabled'] else 'DISABLED'}. Wake word: '{config['wake_word']}'",
            "data": {
                "status": "success",
                "enabled": config["enabled"],
                "wake_word": config["wake_word"],
                "stt_engine": config["stt_engine"],
                "tts_engine": config["tts_engine"],
                "dependencies": deps,
                "config": config,
            },
        }

    elif action == "enable":
        config["enabled"] = True
        _save_voice_config(config)
        return {
            "message": f"Voice commands ENABLED. Wake word: '{config['wake_word']}'. Say '{config['wake_word']}' followed by a command.",
            "data": {"status": "success", "enabled": True, "wake_word": config["wake_word"]},
        }

    elif action == "disable":
        config["enabled"] = False
        _save_voice_config(config)
        return {
            "message": "Voice commands DISABLED.",
            "data": {"status": "success", "enabled": False},
        }

    elif action == "wake":
        if not rest:
            return {"message": f"Current wake word: '{config['wake_word']}'. Usage: MCP voice wake [word]", "data": {"status": "success", "wake_word": config["wake_word"]}}

        config["wake_word"] = rest.strip()
        _save_voice_config(config)
        return {
            "message": f"Wake word updated to: '{rest.strip()}'",
            "data": {"status": "success", "wake_word": rest.strip()},
        }

    elif action == "config":
        if not rest:
            return {
                "message": "Voice configuration",
                "data": {"status": "success", "config": config},
            }

        # Parse key=value pairs
        for pair in rest.split():
            if "=" in pair:
                key, value = pair.split("=", 1)
                if key in config:
                    if isinstance(config[key], bool):
                        config[key] = value.lower() in ("true", "1", "yes")
                    elif isinstance(config[key], float):
                        config[key] = float(value)
                    else:
                        config[key] = value

        _save_voice_config(config)
        return {
            "message": "Voice configuration updated.",
            "data": {"status": "success", "config": config},
        }

    elif action == "test":
        text = rest or "Access granted. MCP Grid online. All systems operational."

        # Try pyttsx3 for TTS
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", 150)
            engine.say(text)
            engine.runAndWait()
            return {
                "message": f"TTS output: '{text}'",
                "data": {"status": "success", "text": text, "engine": "pyttsx3"},
            }
        except Exception:
            pass

        # Fallback: try system espeak
        try:
            import subprocess
            subprocess.run(["espeak", text], capture_output=True, timeout=10)
            return {
                "message": f"TTS output: '{text}'",
                "data": {"status": "success", "text": text, "engine": "espeak"},
            }
        except Exception:
            pass

        return {
            "message": f"TTS not available. Install pyttsx3 or espeak. Text: '{text}'",
            "data": {"status": "partial", "text": text, "engine": None},
        }

    return {
        "message": f"Unknown voice action: '{action}'. Use: status, enable, disable, config, test, wake",
        "data": {"status": "error"},
    }

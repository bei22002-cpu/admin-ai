"""
Clipboard tool - get and set clipboard contents.
"""


def get_clipboard() -> dict:
    """Get current clipboard contents."""
    try:
        import pyperclip
        text = pyperclip.paste()
        return {
            "status": "success",
            "text": text[:5000] if text else "",
            "length": len(text) if text else 0,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def set_clipboard(text: str) -> dict:
    """Set clipboard contents."""
    try:
        import pyperclip
        pyperclip.copy(text)
        return {
            "status": "success",
            "message": f"Copied {len(text)} chars to clipboard",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

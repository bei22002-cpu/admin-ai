"""MCP Code Command - Opens VSCode, generates code with AI."""

import os
import shutil
import subprocess

import httpx


async def handle_code(args: str) -> dict:
    """Handle 'MCP code [thing]' command.

    Opens VSCode and generates code based on the request using AI.
    """
    if not args:
        return {
            "message": "Code protocol requires a target. Usage: MCP code [description]",
            "data": {"status": "awaiting_input"},
        }

    # Check if VSCode is available
    vscode_path = shutil.which("code")
    has_vscode = vscode_path is not None

    # Try to open VSCode if available
    if has_vscode:
        try:
            subprocess.Popen(
                ["code", "--new-window"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            vscode_status = "VSCode launched."
        except Exception as e:
            vscode_status = f"VSCode launch failed: {e}"
    else:
        vscode_status = "VSCode not detected. Code will be generated inline."

    # Generate code using AI
    generated_code = ""
    api_key = os.getenv("OPENAI_API_KEY", "")
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
                                    "You are MCP, a TRON-themed AI coding assistant. "
                                    "Generate clean, production-ready code based on the user's request. "
                                    "Include comments. Keep responses concise but complete. "
                                    "Return ONLY the code, no markdown fences or explanations."
                                ),
                            },
                            {
                                "role": "user",
                                "content": f"Generate code for: {args}",
                            },
                        ],
                        "max_tokens": 1500,
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    generated_code = data["choices"][0]["message"]["content"]
                else:
                    generated_code = f"AI returned status {response.status_code}: {response.text}"
        except Exception as e:
            generated_code = f"AI code generation failed: {e}"
    else:
        generated_code = (
            "AI not configured. Set OPENAI_API_KEY for code generation. "
            f"Blueprint registered for: {args}"
        )

    # Save generated code to a file
    saved_path = ""
    if generated_code and not generated_code.startswith("AI "):
        # Strip markdown code fences if present
        code_to_save = generated_code
        if code_to_save.startswith("```"):
            lines = code_to_save.split("\n")
            # Remove first line (```python) and last line (```)
            lines = [l for l in lines if not l.strip().startswith("```")]
            code_to_save = "\n".join(lines)

        # Determine file extension from content
        slug = args.lower().replace(" ", "_")[:30]
        if "import" in code_to_save or "def " in code_to_save or "class " in code_to_save:
            ext = ".py"
        elif "function" in code_to_save or "const " in code_to_save:
            ext = ".js"
        elif "<html" in code_to_save.lower():
            ext = ".html"
        else:
            ext = ".py"

        output_dir = os.path.join(os.path.expanduser("~"), "mcp_generated")
        os.makedirs(output_dir, exist_ok=True)
        filename = f"mcp_{slug}{ext}"
        saved_path = os.path.join(output_dir, filename)

        try:
            with open(saved_path, "w") as f:
                f.write(code_to_save)

            # Open in VSCode if available
            if has_vscode:
                try:
                    subprocess.Popen(
                        ["code", saved_path],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                except Exception:
                    pass
        except Exception as e:
            saved_path = f"Save failed: {e}"

    return {
        "message": f"Code protocol initiated for: {args}. {vscode_status}",
        "data": {
            "request": args,
            "generated_code": generated_code,
            "saved_to": saved_path,
        },
    }

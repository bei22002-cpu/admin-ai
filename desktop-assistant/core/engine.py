"""
Core AI Engine - handles conversation, tool dispatch, and memory.
"""

import os
import json
import time
from typing import Optional
from collections import deque


class ConversationMemory:
    """Stores conversation history and screen context."""

    def __init__(self, max_messages: int = 50):
        self.messages: deque = deque(maxlen=max_messages)
        self.screen_context: list = []
        self.file_context: dict = {}

    def add_message(self, role: str, content: str):
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": time.time(),
        })

    def add_screen_observation(self, summary: str):
        self.screen_context.append({
            "summary": summary,
            "timestamp": time.time(),
        })
        if len(self.screen_context) > 20:
            self.screen_context = self.screen_context[-20:]

    def get_system_prompt(self) -> str:
        prompt = (
            "You are MCP Grid Assistant, an AI desktop assistant running locally on the user's computer. "
            "You can see their screen, generate code, run shell commands, manage files, and answer questions.\n\n"
            "Available tools (call by returning JSON with 'tool' and 'args' keys):\n"
            "- screenshot: Capture and analyze the current screen\n"
            "- code: Generate code files. Args: {description, language, filename}\n"
            "- shell: Run a shell command. Args: {command}\n"
            "- files: File operations. Args: {action: 'read'|'write'|'list'|'delete', path, content?}\n"
            "- search: Search the web. Args: {query}\n"
            "- system: Get system info. Args: {type: 'cpu'|'memory'|'disk'|'processes'|'all'}\n"
            "- clipboard: Clipboard operations. Args: {action: 'get'|'set', text?}\n\n"
            "When you want to use a tool, respond with ONLY a JSON block like:\n"
            '```tool\n{"tool": "shell", "args": {"command": "ls -la"}}\n```\n\n'
            "After the tool runs, you'll get the result and can respond to the user.\n"
            "Be concise, helpful, and proactive. You're running on their actual computer."
        )

        if self.screen_context:
            recent = self.screen_context[-3:]
            prompt += "\n\nRecent screen observations:\n"
            for obs in recent:
                prompt += f"- {obs['summary']}\n"

        return prompt

    def get_messages_for_api(self) -> list:
        msgs = [{"role": "system", "content": self.get_system_prompt()}]
        for msg in self.messages:
            msgs.append({"role": msg["role"], "content": msg["content"]})
        return msgs


class AIEngine:
    """Manages AI provider calls (OpenAI / Anthropic)."""

    def __init__(self):
        self.memory = ConversationMemory()
        self.provider = self._detect_provider()
        self._openai_client = None
        self._anthropic_client = None

    def _detect_provider(self) -> str:
        if os.environ.get("OPENAI_API_KEY"):
            return "openai"
        if os.environ.get("ANTHROPIC_API_KEY"):
            return "anthropic"
        return "none"

    def _get_openai(self):
        if not self._openai_client:
            import openai
            self._openai_client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        return self._openai_client

    def _get_anthropic(self):
        if not self._anthropic_client:
            import anthropic
            self._anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        return self._anthropic_client

    def chat(self, user_message: str) -> str:
        """Send a message and get a response."""
        self.memory.add_message("user", user_message)

        try:
            if self.provider == "openai":
                response = self._chat_openai()
            elif self.provider == "anthropic":
                response = self._chat_anthropic()
            else:
                response = "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file."

            self.memory.add_message("assistant", response)
            return response
        except Exception as e:
            error_msg = f"AI Error: {str(e)}"
            self.memory.add_message("assistant", error_msg)
            return error_msg

    def _chat_openai(self) -> str:
        client = self._get_openai()
        messages = self.memory.get_messages_for_api()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=4096,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""

    def _chat_anthropic(self) -> str:
        client = self._get_anthropic()
        messages = self.memory.get_messages_for_api()
        system_msg = messages[0]["content"]
        chat_msgs = messages[1:]

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=4096,
            system=system_msg,
            messages=chat_msgs,
        )
        return response.content[0].text

    def analyze_image(self, image_b64: str, prompt: str = "Describe what you see on this screen.") -> str:
        """Analyze a base64-encoded image using vision AI."""
        try:
            if self.provider == "openai":
                return self._vision_openai(image_b64, prompt)
            elif self.provider == "anthropic":
                return self._vision_anthropic(image_b64, prompt)
            else:
                return "No AI provider configured for vision."
        except Exception as e:
            return f"Vision error: {str(e)}"

    def _vision_openai(self, image_b64: str, prompt: str) -> str:
        client = self._get_openai()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                ],
            }],
            max_tokens=1024,
        )
        return response.choices[0].message.content or ""

    def _vision_anthropic(self, image_b64: str, prompt: str) -> str:
        client = self._get_anthropic()
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return response.content[0].text

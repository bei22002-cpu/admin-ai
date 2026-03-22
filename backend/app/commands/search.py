"""MCP Search Command - Grid scans web, delivers intelligence."""

import os

import httpx


def _get_ai_provider() -> str:
    """Get the configured AI provider from environment."""
    return os.getenv("AI_PROVIDER", "openai").lower().strip()


async def _ai_search(query: str) -> str | None:
    """Call the configured AI provider for search intelligence."""
    provider = _get_ai_provider()
    system_msg = (
        "You are MCP, a TRON-themed AI assistant. "
        "Provide concise, authoritative intelligence briefings. "
        "Use technical/grid terminology."
    )
    user_msg = f"Search and report on: {query}"

    if provider == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key or api_key == "your-anthropic-api-key-here":
            return None
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-3-haiku-20240307",
                    "system": system_msg,
                    "messages": [{"role": "user", "content": user_msg}],
                    "max_tokens": 500,
                },
            )
            if response.status_code == 200:
                data = response.json()
                blocks = data.get("content", [])
                parts = [b["text"] for b in blocks if b.get("type") == "text"]
                return "\n".join(parts) if parts else None
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key or api_key == "your-openai-api-key-here":
            return None
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
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": 500,
                },
            )
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"]
    return None


async def handle_search(args: str) -> dict:
    """Handle 'MCP search [query]' command.

    Performs web search and returns results.
    Uses AI to summarize if available.
    """
    if not args:
        return {
            "message": "Search protocol requires a query. Usage: MCP search [query]",
            "data": {"status": "awaiting_input"},
        }

    results = []

    # Try AI-powered search
    try:
        ai_result = await _ai_search(args)
        if ai_result:
            results.append({"source": "MCP Intelligence", "content": ai_result})
    except Exception as e:
        results.append({"source": "error", "content": f"AI search failed: {e}"})

    # Fallback: DuckDuckGo instant answers
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": args, "format": "json", "no_html": 1},
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("AbstractText"):
                    results.append({
                        "source": "DuckDuckGo",
                        "content": data["AbstractText"],
                        "url": data.get("AbstractURL", ""),
                    })
                for topic in data.get("RelatedTopics", [])[:5]:
                    if isinstance(topic, dict) and topic.get("Text"):
                        results.append({
                            "source": "Related",
                            "content": topic["Text"],
                            "url": topic.get("FirstURL", ""),
                        })
    except Exception:
        pass

    if not results:
        results.append({
            "source": "MCP",
            "content": f"Grid scan initiated for '{args}'. "
            "No immediate results. Expanding search parameters.",
        })

    return {
        "message": f"Grid scan complete for: {args}. {len(results)} sectors analyzed.",
        "data": {
            "query": args,
            "results": results,
            "result_count": len(results),
        },
    }

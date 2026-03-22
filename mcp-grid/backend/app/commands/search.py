"""MCP Search Command - Grid scans web, delivers intelligence."""

import os

import httpx


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

    # Try using OpenAI for intelligent search
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
                                    "You are MCP, a TRON-themed AI assistant. "
                                    "Provide concise, authoritative intelligence briefings. "
                                    "Use technical/grid terminology."
                                ),
                            },
                            {
                                "role": "user",
                                "content": f"Search and report on: {args}",
                            },
                        ],
                        "max_tokens": 500,
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    ai_result = data["choices"][0]["message"]["content"]
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

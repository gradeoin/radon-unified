"""
Radon Unified — Agentic Tool: News Headlines
GNews (if key) → Tavily fallback → Web search.
Ported from radon/worker/worker.js fetchRealNews().
"""
import urllib.parse

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

TOOL_DEFINITION = {
    "name": "get_news",
    "description": "Get the latest real news headlines for a specific topic or general top news.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "topic": {"type": "STRING", "description": "The news topic e.g. AI, cricket, business, technology"}
        },
        "required": ["topic"]
    }
}


async def run(topic: str) -> str:
    gnews_key = CONFIG.get("gnews_api_key", "").strip()

    if gnews_key and HAS_HTTPX:
        try:
            url = (
                f"https://gnews.io/api/v4/search"
                f"?q={urllib.parse.quote(topic)}&lang=en&max=5&apikey={gnews_key}"
            )
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                data = resp.json()
            articles = data.get("articles", [])
            if articles:
                result = f'📰 **Latest News: "{topic}"**\n\n'
                for i, a in enumerate(articles, 1):
                    desc = (a.get("description") or "")[:200]
                    from datetime import datetime
                    try:
                        pub = datetime.fromisoformat(a["publishedAt"].replace("Z", "+00:00"))
                        pub_str = pub.strftime("%b %d, %Y %H:%M UTC")
                    except Exception:
                        pub_str = a.get("publishedAt", "")
                    result += (
                        f"{i}. **{a.get('title', '')}**\n"
                        f"{desc}...\n"
                        f"🔗 {a.get('url', '')} | 🕒 {pub_str}\n\n"
                    )
                return result
        except Exception:
            pass

    # Fallback: web search for news
    from backend.tools import web_search
    return await web_search.run(f"{topic} latest news updates today")

"""
Radon Unified — Agentic Tool: Web Search
Tavily AI (if key set) → Wikipedia fallback.
Ported from radon/worker/worker.js performRealWebSearch().
"""
import urllib.parse
from typing import Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

TOOL_DEFINITION = {
    "name": "search_web",
    "description": "Search the web for real-time information, current events, facts, live data, or latest news.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "query": {"type": "STRING", "description": "The search query"}
        },
        "required": ["query"]
    }
}


async def run(query: str) -> str:
    tavily_key = CONFIG.get("tavily_api_key", "").strip()

    if tavily_key and HAS_HTTPX:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": tavily_key,
                        "query": query,
                        "search_depth": "advanced",
                        "max_results": 6,
                        "include_answer": True,
                    },
                    headers={"Content-Type": "application/json"},
                )
                data = resp.json()
                if resp.status_code != 429 and data.get("results"):
                    summary = f'🔍 Deep Web Search Results for: "{query}"\n\n'
                    if data.get("answer"):
                        summary += f"Summary: {data['answer']}\n\n"
                    summary += "Verified Sources:\n"
                    for i, r in enumerate(data["results"], 1):
                        snippet = (r.get("content") or "")[:300]
                        summary += f"{i}. [{r.get('title', '')}]({r.get('url', '')})\n{snippet}...\n\n"
                    return summary
        except Exception:
            pass

    # Wikipedia fallback
    try:
        encoded = urllib.parse.quote(query)
        wiki_url = (
            f"https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={encoded}&format=json&origin=*"
        )
        if HAS_HTTPX:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(wiki_url)
                data = resp.json()
        else:
            import urllib.request, json
            with urllib.request.urlopen(wiki_url, timeout=15) as r:
                data = json.loads(r.read())

        results = data.get("query", {}).get("search", [])
        if results:
            summary = f'🔍 Live Web Retrieval for: "{query}"\n\n'
            for i, r in enumerate(results[:4], 1):
                snippet = r.get("snippet", "")
                # Strip HTML tags
                import re
                snippet = re.sub(r"<[^>]+>", "", snippet)
                title = r.get("title", "")
                url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
                summary += f"{i}. {title}\n{snippet}...\nURL: {url}\n\n"
            return summary
    except Exception as e:
        pass

    return f'Web Search completed for: "{query}". Answering from training knowledge.'

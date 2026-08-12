"""
Radon Unified — Gemini Web Provider
Extracted and async-adapted from gemini-web2api/gemini_web2api.py.

Provides free access to Gemini via the reverse-engineered StreamGenerate protocol.
No API key required.
"""
import json
import re
import time
import uuid
import hashlib
import os
import sys
from typing import AsyncIterator, Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

_GW_CFG = CONFIG.get("gemini_web", {})

# Model → (mode_category, think_level)
# mode: 1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE
MODELS = {
    "gemini-3.6-flash":              {"mode": 1, "think": 4, "desc": "Latest all-around (free)"},
    "gemini-3.5-flash":              {"mode": 1, "think": 4, "desc": "Alias → gemini-3.6-flash"},
    "gemini-2.0-flash":              {"mode": 1, "think": 4, "desc": "Alias → gemini-3.6-flash"},
    "gemini-1.5-flash":              {"mode": 1, "think": 4, "desc": "Alias → gemini-3.6-flash"},
    "gemini-3.5-flash-thinking":     {"mode": 2, "think": 0, "desc": "Extended thinking, ~20k chars"},
    "gemini-3.5-flash-thinking-lite":{"mode": 5, "think": 0, "desc": "Adaptive thinking depth"},
    "gemini-3.1-pro":                {"mode": 3, "think": 4, "desc": "Pro (cookie required for real routing)"},
    "gemini-1.5-pro":                {"mode": 3, "think": 4, "desc": "Alias → gemini-3.1-pro"},
    "gemini-auto":                   {"mode": 4, "think": 4, "desc": "Auto model selection"},
    "gemini-flash-lite":             {"mode": 6, "think": 4, "desc": "Lightweight, fastest"},
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_cookie() -> tuple[str, Optional[str]]:
    cookie_file = _GW_CFG.get("cookie_file")
    if not cookie_file or not os.path.exists(cookie_file):
        return "", None
    try:
        with open(cookie_file, "r") as f:
            content = f.read().strip()
        if content.startswith("{"):
            data = json.loads(content)
            cookie_str = data.get("cookie", "")
            sapisid = data.get("sapisid", "")
        else:
            cookie_str = content
            pairs = dict(p.split("=", 1) for p in cookie_str.split("; ") if "=" in p)
            sapisid = pairs.get("SAPISID", "")
        return cookie_str, sapisid or None
    except Exception:
        return "", None


def _sapisidhash(sapisid: str) -> str:
    ts = int(time.time())
    h = hashlib.sha1(f"{ts} {sapisid} https://gemini.google.com".encode()).hexdigest()
    return f"SAPISIDHASH {ts}_{h}"


def _account_prefix() -> str:
    auth_user = _GW_CFG.get("auth_user")
    if auth_user is None or auth_user == "":
        return ""
    return f"/u/{auth_user}"


def _build_payload(prompt: str, model_id: int, think_mode: int) -> dict:
    """Build the Gemini StreamGenerate inner/outer payload."""
    inner = [None] * 80
    inner[0] = [prompt, 0, None, None, None, None, 0]
    inner[1] = ["en"]
    inner[2] = ["", "", "", None, None, None, None, None, None, ""]
    inner[6] = [0]
    inner[7] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[think_mode]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    inner[41] = [2]   # non-temporary chat
    inner[53] = 0
    inner[59] = str(uuid.uuid4())
    inner[61] = []
    inner[68] = 1
    inner[79] = model_id
    return [None, json.dumps(inner)]


def _build_url(prefix: str) -> str:
    gemini_bl = _GW_CFG.get("gemini_bl", "boq_assistant-bard-web-server_20260716.08_p0")
    reqid = int(time.time()) % 1_000_000
    return (
        f"https://gemini.google.com{prefix}/_/BardChatUi/data/"
        "assistant.lamda.BardFrontendService/StreamGenerate"
        f"?bl={gemini_bl}&hl=en&_reqid={reqid}&rt=c"
    )


def _build_headers(prefix: str) -> dict:
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://gemini.google.com",
        "Referer": f"https://gemini.google.com{prefix}/app",
        "X-Same-Domain": "1",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
    }
    auth_user = _GW_CFG.get("auth_user")
    if auth_user is not None:
        headers["X-Goog-AuthUser"] = str(auth_user)
    cookie_str, sapisid = _load_cookie()
    if cookie_str:
        headers["Cookie"] = cookie_str
    if sapisid:
        headers["Authorization"] = _sapisidhash(sapisid)
    return headers


def _parse_prompt(messages: list) -> str:
    """Convert OpenAI-style messages list → single prompt string."""
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            parts.append(f"[System Instructions]: {content}")
        elif role == "assistant":
            parts.append(f"Assistant: {content}")
        else:
            parts.append(f"User: {content}")
    return "\n\n".join(parts)


def _extract_text(raw: str) -> str:
    """Extract best text from a non-streaming Gemini response."""
    best = ""
    for line in raw.splitlines():
        if '"wrb.fr"' not in line or len(line) < 200:
            continue
        try:
            arr = json.loads(line)
            inner_str = arr[0][2]
            if not inner_str:
                continue
            inner2 = json.loads(inner_str)
            if isinstance(inner2, list) and len(inner2) > 4 and inner2[4]:
                for part in inner2[4]:
                    if isinstance(part, list) and len(part) > 1 and part[1]:
                        for t in part[1]:
                            if isinstance(t, str) and len(t) > len(best):
                                best = t
        except Exception:
            pass
    # Clean markdown artifacts
    best = re.sub(r"\*\*(.*?)\*\*", r"\1", best)
    return best.strip()


def _get_model_params(model_name: str) -> tuple[int, int]:
    # Support @think=N suffix
    think_override = None
    base = model_name
    if "@think=" in model_name:
        base, suffix = model_name.rsplit("@think=", 1)
        try:
            think_override = int(suffix)
        except ValueError:
            pass
    info = MODELS.get(base, MODELS["gemini-3.6-flash"])
    mode = info["mode"]
    think = think_override if think_override is not None else info["think"]
    return mode, think


# ── Public API ───────────────────────────────────────────────────────────────

async def complete(messages: list, model: str = "gemini-3.6-flash") -> str:
    """Non-streaming completion. Returns full text."""
    if not HAS_HTTPX:
        raise RuntimeError("httpx is required: pip install httpx")

    mode, think = _get_model_params(model)
    prompt = _parse_prompt(messages)
    outer = _build_payload(prompt, mode, think)
    prefix = _account_prefix()
    url = _build_url(prefix)
    headers = _build_headers(prefix)

    import urllib.parse
    xsrf = _GW_CFG.get("xsrf_token")
    params: dict = {"f.req": json.dumps(outer)}
    if xsrf:
        params["at"] = xsrf
    body = urllib.parse.urlencode(params)

    proxy = _GW_CFG.get("proxy")
    timeout = _GW_CFG.get("request_timeout_sec", 180)
    retries = _GW_CFG.get("retry_attempts", 3)
    delay = _GW_CFG.get("retry_delay_sec", 2)

    last_err: Exception = RuntimeError("No attempts made")
    for attempt in range(retries):
        try:
            transport = httpx.AsyncHTTPTransport(proxy=proxy) if proxy else None
            async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
                resp = await client.post(url, content=body.encode(), headers=headers)
                resp.raise_for_status()
                return _extract_text(resp.text) or "[No response from Gemini]"
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                import asyncio
                await asyncio.sleep(delay)
    raise last_err


async def stream(messages: list, model: str = "gemini-3.6-flash") -> AsyncIterator[str]:
    """Streaming completion. Yields text deltas."""
    if not HAS_HTTPX:
        # Fallback: non-streaming
        text = await complete(messages, model)
        yield text
        return

    mode, think = _get_model_params(model)
    prompt = _parse_prompt(messages)
    outer = _build_payload(prompt, mode, think)
    prefix = _account_prefix()
    url = _build_url(prefix)
    headers = _build_headers(prefix)

    import urllib.parse
    xsrf = _GW_CFG.get("xsrf_token")
    params: dict = {"f.req": json.dumps(outer)}
    if xsrf:
        params["at"] = xsrf
    body = urllib.parse.urlencode(params)

    proxy = _GW_CFG.get("proxy")
    timeout = _GW_CFG.get("request_timeout_sec", 180)

    prev_text = ""
    transport = httpx.AsyncHTTPTransport(proxy=proxy) if proxy else None
    async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
        async with client.stream("POST", url, content=body.encode(), headers=headers) as resp:
            resp.raise_for_status()
            buf = ""
            async for chunk in resp.aiter_text():
                buf += chunk
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    if '"wrb.fr"' not in line or len(line) < 200:
                        continue
                    try:
                        arr = json.loads(line)
                        inner_str = arr[0][2]
                        if not inner_str:
                            continue
                        inner2 = json.loads(inner_str)
                        if isinstance(inner2, list) and len(inner2) > 4 and inner2[4]:
                            for part in inner2[4]:
                                if (isinstance(part, list) and len(part) > 1
                                        and part[1] and isinstance(part[1], list)):
                                    for t in part[1]:
                                        if isinstance(t, str) and len(t) > len(prev_text):
                                            delta = t[len(prev_text):]
                                            if delta:
                                                yield delta
                                            prev_text = t
                    except Exception:
                        pass


def list_models() -> list[dict]:
    return [
        {
            "id": mid,
            "provider": "gemini-web",
            "description": info["desc"],
            "requires_setup": False,
        }
        for mid, info in MODELS.items()
    ]

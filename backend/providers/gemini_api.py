"""
Radon Unified — Direct Gemini REST API Provider
Uses official Gemini generateContent / streamGenerateContent endpoints.
Requires GEMINI_API_KEY(s) in config.json.
"""
import json
import asyncio
import random
from typing import AsyncIterator, Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

MODELS = {
    "gemini-2.0-flash":      {"desc": "Gemini 2.0 Flash (API)"},
    "gemini-2.0-flash-lite": {"desc": "Gemini 2.0 Flash Lite (API, fastest)"},
    "gemini-1.5-pro":        {"desc": "Gemini 1.5 Pro (API)"},
    "gemini-1.5-flash":      {"desc": "Gemini 1.5 Flash (API)"},
}

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT = 60


def _get_keys() -> list[str]:
    keys = CONFIG.get("gemini_api_keys", [])
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(",") if k.strip()]
    else:
        keys = [k.strip() for k in keys if k.strip()]
    shuffled = list(keys)
    random.shuffle(shuffled)
    return shuffled


def _messages_to_contents(messages: list) -> tuple[dict, list]:
    """Convert OpenAI-style messages → (system_instruction, contents)."""
    system_parts = []
    contents = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            system_parts.append({"text": content})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": content}]})
        else:
            contents.append({"role": "user", "parts": [{"text": content}]})

    system_instruction = {"parts": system_parts} if system_parts else None
    return system_instruction, contents


async def complete(
    messages: list,
    model: str = "gemini-2.0-flash",
    tools_payload: Optional[list] = None,
    tool_config: Optional[dict] = None,
) -> dict:
    """Non-streaming. Returns full Gemini API response dict."""
    keys = _get_keys()
    if not keys:
        raise RuntimeError("No Gemini API keys configured in config.json → gemini_api_keys")

    sys_inst, contents = _messages_to_contents(messages)
    body: dict = {"contents": contents}
    if sys_inst:
        body["systemInstruction"] = sys_inst
    if tools_payload:
        body["tools"] = tools_payload
    if tool_config:
        body["toolConfig"] = tool_config

    last_err: Exception = RuntimeError("No attempts")
    for key in keys:
        url = f"{_BASE}/{model}:generateContent?key={key}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    url,
                    json=body,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code == 429:
                    await asyncio.sleep(3)
                    continue
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            last_err = e
    raise last_err


async def stream(
    messages: list,
    model: str = "gemini-2.0-flash",
    tools_payload: Optional[list] = None,
    tool_config: Optional[dict] = None,
) -> AsyncIterator[str | dict]:
    """Streaming via SSE. Yields text chunks (str) or function_call (dict)."""
    keys = _get_keys()
    if not keys:
        raise RuntimeError("No Gemini API keys configured in config.json → gemini_api_keys")

    sys_inst, contents = _messages_to_contents(messages)
    body: dict = {"contents": contents}
    if sys_inst:
        body["systemInstruction"] = sys_inst
    if tools_payload:
        body["tools"] = tools_payload
    if tool_config:
        body["toolConfig"] = tool_config

    for key in keys:
        url = f"{_BASE}/{model}:streamGenerateContent?alt=sse&key={key}"
        try:
            async with httpx.AsyncClient(timeout=180) as client:
                async with client.stream(
                    "POST", url,
                    json=body,
                    headers={"Content-Type": "application/json"},
                ) as resp:
                    if not resp.is_success:
                        continue
                    buf = ""
                    async for chunk in resp.aiter_text():
                        buf += chunk
                        while "\n" in buf:
                            line, buf = buf.split("\n", 1)
                            if not line.startswith("data: "):
                                continue
                            json_str = line[6:].strip()
                            if not json_str or json_str == "[DONE]":
                                continue
                            try:
                                data = json.loads(json_str)
                                if data.get("error"):
                                    raise RuntimeError(data["error"].get("message", "API error"))
                                part = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0]
                                if part.get("functionCall"):
                                    yield {"function_call": part["functionCall"]}
                                    return
                                token = part.get("text", "")
                                if token:
                                    yield token
                            except (json.JSONDecodeError, IndexError):
                                pass
                return  # success
        except Exception:
            continue
    raise RuntimeError("All Gemini API keys exhausted or unavailable")


def list_models() -> list[dict]:
    return [
        {
            "id": mid,
            "provider": "gemini-api",
            "description": info["desc"],
            "requires_setup": True,
            "setup_hint": "Add your Gemini API key to config.json → gemini_api_keys",
        }
        for mid, info in MODELS.items()
    ]

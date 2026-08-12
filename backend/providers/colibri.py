"""
Radon Unified — Colibri Local Model Provider
Wraps colibri's OpenAI-compatible HTTP server (openai_server.py).

Colibri serves models like GLM-5.2, Inkling, DeepSeek V4 Flash, Kimi K3, OLMoE
via a local OpenAI-compatible endpoint. This module auto-detects whether colibri
is installed and can optionally start the server on demand.
"""
import asyncio
import os
import subprocess
import sys
import time
from typing import AsyncIterator, Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

_CFG = CONFIG.get("colibri", {})

COLIBRI_MODELS = {
    "glm-5.2":          {"desc": "GLM-5.2 744B MoE (372 GB disk, 16 GB RAM)", "family": "glm"},
    "inkling":          {"desc": "Inkling 975B MoE (469 GB disk, 25 GB RAM)", "family": "inkling"},
    "kimi-k3":          {"desc": "Kimi K3 2.8T MoE (1.6 TB disk, 32 GB RAM)", "family": "kimi_k3"},
    "deepseek-v4-flash":{"desc": "DeepSeek V4 Flash 284B (167 GB disk, 16 GB RAM)", "family": "deepseek-v4"},
    "olmoe":            {"desc": "OLMoE 7B (4 GB disk, 8 GB RAM)", "family": "olmoe"},
}

_server_proc: Optional[subprocess.Popen] = None
_server_ready = False


def _colibri_server_url() -> str:
    port = _CFG.get("server_port", 8082)
    return f"http://localhost:{port}"


def is_configured() -> bool:
    """Returns True if colibri is enabled and binary/model paths are set."""
    if not _CFG.get("enabled", False):
        return False
    binary = _CFG.get("binary_path", "")
    model = _CFG.get("model_path", "")
    return bool(binary and model and os.path.exists(binary) and os.path.exists(model))


async def _wait_for_server(url: str, timeout: int = 60) -> bool:
    """Poll colibri's /v1/models until it responds or timeout."""
    deadline = time.time() + timeout
    async with httpx.AsyncClient(timeout=5) as client:
        while time.time() < deadline:
            try:
                resp = await client.get(f"{url}/v1/models")
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(2)
    return False


async def ensure_server_running() -> bool:
    """Start colibri server if auto_start is enabled and not already running."""
    global _server_proc, _server_ready
    if _server_ready:
        return True
    if not is_configured():
        return False

    url = _colibri_server_url()

    # Check if already running externally
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{url}/v1/models")
            if resp.status_code == 200:
                _server_ready = True
                return True
    except Exception:
        pass

    if not _CFG.get("auto_start", True):
        return False

    # Find openai_server.py relative to the binary
    binary = _CFG.get("binary_path", "")
    binary_dir = os.path.dirname(binary)
    server_script = os.path.join(binary_dir, "openai_server.py")
    if not os.path.exists(server_script):
        # Try the colibri repo c/ directory
        server_script = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "colibri", "c", "openai_server.py"
        )

    if not os.path.exists(server_script):
        print("[colibri] Could not find openai_server.py. Start colibri manually.", file=sys.stderr)
        return False

    model_path = _CFG.get("model_path", "")
    port = _CFG.get("server_port", 8082)
    cmd = [
        sys.executable, server_script,
        "--model", model_path,
        "--port", str(port),
    ]

    print(f"[colibri] Starting server: {' '.join(cmd)}", file=sys.stderr)
    try:
        _server_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except Exception as e:
        print(f"[colibri] Failed to start server: {e}", file=sys.stderr)
        return False

    ready = await _wait_for_server(url, timeout=120)
    if ready:
        _server_ready = True
        print("[colibri] Server ready.", file=sys.stderr)
    else:
        print("[colibri] Server did not become ready in time.", file=sys.stderr)
    return ready


async def complete(messages: list, model: str = "glm-5.2") -> str:
    """Non-streaming completion via colibri's OpenAI-compatible API."""
    if not HAS_HTTPX:
        raise RuntimeError("httpx required: pip install httpx")

    ok = await ensure_server_running()
    if not ok:
        raise RuntimeError(
            "Colibri is not running. Configure colibri in config.json and ensure "
            "the binary and model_path are set."
        )

    url = _colibri_server_url()
    # Map Radon model names → colibri model IDs
    model_id = COLIBRI_MODELS.get(model, {}).get("family", model)

    openai_messages = []
    for m in messages:
        role = m.get("role", "user")
        if role == "model":
            role = "assistant"
        openai_messages.append({"role": role, "content": m.get("content", "")})

    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{url}/v1/chat/completions",
            json={
                "model": model_id,
                "messages": openai_messages,
                "stream": False,
            },
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def stream(messages: list, model: str = "glm-5.2") -> AsyncIterator[str]:
    """Streaming via colibri's OpenAI-compatible SSE endpoint."""
    if not HAS_HTTPX:
        text = await complete(messages, model)
        yield text
        return

    ok = await ensure_server_running()
    if not ok:
        yield "[Colibri not running] Configure colibri in config.json"
        return

    url = _colibri_server_url()
    model_id = COLIBRI_MODELS.get(model, {}).get("family", model)

    openai_messages = []
    for m in messages:
        role = m.get("role", "user")
        if role == "model":
            role = "assistant"
        openai_messages.append({"role": role, "content": m.get("content", "")})

    import json
    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream(
            "POST",
            f"{url}/v1/chat/completions",
            json={
                "model": model_id,
                "messages": openai_messages,
                "stream": True,
            },
            headers={"Content-Type": "application/json"},
        ) as resp:
            resp.raise_for_status()
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
                        delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except Exception:
                        pass


def list_models() -> list[dict]:
    enabled = _CFG.get("enabled", False)
    configured = is_configured()
    return [
        {
            "id": mid,
            "provider": "colibri",
            "description": info["desc"],
            "requires_setup": not configured,
            "setup_hint": (
                "Set colibri.enabled=true, colibri.binary_path, and colibri.model_path in config.json"
                if not configured else None
            ),
        }
        for mid, info in COLIBRI_MODELS.items()
    ]


def shutdown():
    global _server_proc, _server_ready
    if _server_proc:
        _server_proc.terminate()
        _server_proc = None
    _server_ready = False

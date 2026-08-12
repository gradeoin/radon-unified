"""
Radon Unified — FastAPI Backend Server
Serves the web UI and provides the /chat, /chat/stream, /health, and /models endpoints.

Run with:
    uvicorn backend.server:app --host 0.0.0.0 --port 8080 --reload
"""
import asyncio
import json
import os
import sys
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.config import CONFIG
from backend.providers import get_all_models, get_streaming_provider
from backend.agentic_loop import run_agentic_loop, _sanitize_roles, _sliding_window, SYSTEM_PROMPT

# ── App Setup ────────────────────────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address, default_limits=[CONFIG.get("rate_limit", "30/minute")])

app = FastAPI(title="Radon AI", version="4.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FRONTEND = os.path.join(_ROOT, "frontend")

# Serve static assets (CSS, JS, images, etc.)
if os.path.isdir(_FRONTEND):
    app.mount("/static", StaticFiles(directory=_FRONTEND), name="static")


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def serve_index():
    index = os.path.join(_FRONTEND, "index.html")
    if os.path.exists(index):
        return FileResponse(index, media_type="text/html")
    return HTMLResponse("<h1>Radon AI — Frontend not found</h1><p>Run the server from the radon-unified/ directory.</p>")


@app.get("/health")
async def health():
    from backend.providers import gemini_web, gemini_api, colibri
    return {
        "status": "healthy",
        "version": "4.0.0 (Unified)",
        "providers": {
            "gemini-web": CONFIG.get("gemini_web", {}).get("enabled", True),
            "gemini-api": bool(CONFIG.get("gemini_api_keys")),
            "colibri": colibri.is_configured(),
        },
        "tools": ["search_web", "get_weather", "get_news", "execute_python", "generate_image"],
    }


@app.get("/models")
async def list_models():
    return {"models": get_all_models()}


@app.post("/chat")
@limiter.limit(CONFIG.get("rate_limit", "30/minute"))
async def chat(request: Request):
    """Non-streaming chat endpoint."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    message = body.get("message", "").strip()
    if not message:
        return JSONResponse({"error": "message is required"}, status_code=400)

    model = body.get("model", "gemini-3.6-flash")
    user_memory = body.get("userMemory", "")
    custom_prompt = body.get("customSystemPrompt", "")
    incoming_history = body.get("history", [])

    if incoming_history:
        history = incoming_history
    else:
        history = [{"role": "user", "parts": [{"text": message}]}]

    # Collect full streamed response
    full_text = ""
    tool_used = None
    try:
        async for event in run_agentic_loop(history, user_memory, custom_prompt):
            if event == "[DONE]":
                break
            try:
                data = json.loads(event)
                if "token" in data:
                    full_text += data["token"]
                elif "tool" in data:
                    tool_used = data["tool"]
                elif "error" in data:
                    return JSONResponse({"reply": data["error"], "error": True})
            except Exception:
                pass
    except Exception as e:
        return JSONResponse({"reply": f"Backend error: {e}", "error": True})

    return JSONResponse({
        "reply": full_text or "[No response]",
        "tool_used": tool_used,
        "model": model,
    })


@app.post("/chat/stream")
@limiter.limit(CONFIG.get("rate_limit", "30/minute"))
async def chat_stream(request: Request):
    """SSE streaming chat endpoint — same protocol as radon worker /chat/stream."""
    try:
        body = await request.json()
    except Exception:
        async def err_gen():
            yield f"data: {json.dumps({'error': 'Invalid JSON'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    message = body.get("message", "").strip()
    model = body.get("model", "gemini-3.6-flash")
    user_memory = body.get("userMemory", "")
    custom_prompt = body.get("customSystemPrompt", "")
    incoming_history = body.get("history", [])

    if incoming_history:
        history = incoming_history
    else:
        history = [{"role": "user", "parts": [{"text": message}]}]

    async def event_generator():
        try:
            async for event in run_agentic_loop(history, user_memory, custom_prompt):
                if event == "[DONE]":
                    yield "data: [DONE]\n\n"
                    break
                # event is already a JSON string like {"token": "..."}
                yield f"data: {event}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# Serve frontend static files directly (fallback for any non-API paths)
@app.get("/{full_path:path}")
async def serve_frontend_files(full_path: str):
    target = os.path.join(_FRONTEND, full_path)
    if os.path.isfile(target):
        return FileResponse(target)
    # SPA fallback
    index = os.path.join(_FRONTEND, "index.html")
    if os.path.exists(index):
        return FileResponse(index, media_type="text/html")
    return JSONResponse({"error": "Not found"}, status_code=404)


# ── Startup / Shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup():
    from backend.providers import colibri as colibri_provider
    if CONFIG.get("colibri", {}).get("enabled") and CONFIG.get("colibri", {}).get("auto_start"):
        asyncio.create_task(colibri_provider.ensure_server_running())
    print(f"[Radon] Server running at http://localhost:{CONFIG.get('port', 8080)}")
    print(f"[Radon] Gemini Web provider: {'enabled' if CONFIG.get('gemini_web', {}).get('enabled') else 'disabled'}")
    print(f"[Radon] Gemini API keys: {len(CONFIG.get('gemini_api_keys', []))}")
    print(f"[Radon] Colibri local models: {'configured' if CONFIG.get('colibri', {}).get('enabled') else 'not configured'}")


@app.on_event("shutdown")
async def on_shutdown():
    from backend.providers import colibri as colibri_provider
    colibri_provider.shutdown()

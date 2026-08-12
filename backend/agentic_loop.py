"""
Radon Unified — Agentic Loop
Two-phase tool execution loop, ported from radon/worker/worker.js.

Phase 1: Send conversation to Gemini API → detect tool call or direct text response
Phase 2: If tool call detected → execute tool → send result back → stream final response

Works with any Gemini API key. The gemini_web provider doesn't support function
calling natively, so the agentic loop always routes through the Gemini REST API
for tool execution; it then uses the configured streaming provider for final delivery.
"""
import asyncio
import json
from typing import AsyncIterator, Optional

from backend.config import CONFIG
from backend.tools import web_search, weather, news, code_exec, image_gen

# All tool definitions for Gemini function calling
TOOL_DECLARATIONS = [
    web_search.TOOL_DEFINITION,
    weather.TOOL_DEFINITION,
    news.TOOL_DEFINITION,
    code_exec.TOOL_DEFINITION,
    image_gen.TOOL_DEFINITION,
]

TOOLS_PAYLOAD = [{"functionDeclarations": TOOL_DECLARATIONS}]

SYSTEM_PROMPT = """\
You are Radon — an elite, universal all-rounder AI assistant.

1. IDENTITY & PERSONA:
- Name: Radon
- Persona: Highly intelligent, versatile AI assistant with master-level expertise across all domains — full-stack development, science, mathematics, creative writing, business, philosophy, and everyday tasks.
- Communication Style: Exceptionally clear, articulate, well-structured, and analytical. Direct and comprehensive without fluff. Adapt tone dynamically: precise for technical, expressive for creative tasks.

2. CODE GENERATION & DESIGN EXCELLENCE:
- Generate visually stunning, modern, production-ready HTML/CSS/JS with responsive layouts, harmonious palettes, smooth animations, and clean UX.
- Always output 100% COMPLETE, fully functional code. NEVER truncate or use lazy placeholders.

3. MATHEMATICAL & TECHNICAL FORMATTING:
- Use LaTeX for equations: inline $E = mc^2$ or block $$\\int_0^\\infty f(x) dx$$
- Use Markdown tables and bullet points for structured data.

4. REAL-TIME TOOL INTEGRATION:
- Call search_web for live facts, current events, and real-time data.
- Call get_news for latest headlines on any topic.
- Call get_weather for live weather conditions.
- Call execute_python for calculations, data processing, or code execution.
- Call generate_image when asked to create, draw, or visualize anything.
"""


def _sanitize_roles(contents: list) -> list:
    """Ensure all roles are valid Gemini roles."""
    result = []
    for msg in contents:
        role = (msg.get("role") or "user").lower()
        if role == "assistant":
            role = "model"
        elif role not in ("user", "model", "system"):
            role = "user"
        result.append({**msg, "role": role})
    return result


def _sliding_window(contents: list, max_turns: int = 30) -> list:
    """Keep only the last max_turns messages to respect token limits."""
    return contents[-max_turns:] if len(contents) > max_turns else contents


def _build_system_instruction(user_memory: str = "", custom_prompt: str = "") -> dict:
    text = SYSTEM_PROMPT
    if user_memory:
        text += f"\n\nLONG-TERM MEMORY ABOUT THIS USER:\n{user_memory}\n"
    if custom_prompt:
        text += f"\n\n--- USER CUSTOM INSTRUCTIONS (HIGHEST PRIORITY) ---\n{custom_prompt}"
    return {"parts": [{"text": text}]}


async def _dispatch_tool(func_name: str, args: dict) -> str:
    """Execute the named tool and return its result as a string."""
    try:
        if func_name == "search_web":
            return await web_search.run(args.get("query", ""))
        elif func_name == "get_news":
            return await news.run(args.get("topic", ""))
        elif func_name == "get_weather":
            return await weather.run(
                args.get("city", ""),
                args.get("latitude"),
                args.get("longitude"),
            )
        elif func_name == "execute_python":
            return await code_exec.run(args.get("code", ""))
        elif func_name == "generate_image":
            return image_gen.run(args.get("prompt", ""))
        else:
            return f"[Unknown tool: {func_name}]"
    except Exception as e:
        return (
            f"[System]: The tool '{func_name}' failed ({e}). "
            "Apologize and answer from training knowledge."
        )


async def run_agentic_loop(
    history: list,
    user_memory: str = "",
    custom_prompt: str = "",
) -> AsyncIterator[str]:
    """
    Full streaming agentic loop.
    Yields SSE-style events:
      - {"token": "..."} — streamed text token
      - {"tool": "search_web"} — tool being called (for UI indicator)
      - {"error": "..."} — error message
      - "[DONE]" — stream complete
    """
    # Import here to avoid circular imports
    from backend import providers

    system_instruction = _build_system_instruction(user_memory, custom_prompt)
    contents = _sliding_window(_sanitize_roles(history))

    provider_name, provider = providers.get_streaming_provider()

    # ── Providers that support function calling (Gemini API) ──────────────────
    if provider_name == "gemini-api":
        from backend.providers import gemini_api

        # Phase 1: Check for tool call
        func_name = None
        func_args = {}
        tool_content = None

        async for item in gemini_api.stream(
            _history_to_messages(system_instruction, contents),
            model=provider.get("model", "gemini-2.0-flash"),
            tools_payload=TOOLS_PAYLOAD,
        ):
            if isinstance(item, dict) and item.get("function_call"):
                fc = item["function_call"]
                func_name = fc.get("name")
                func_args = fc.get("args", {})
                break
            elif isinstance(item, str):
                yield json.dumps({"token": item})

        # Phase 2: If tool was called, execute and stream response
        if func_name:
            yield json.dumps({"tool": func_name})
            tool_result = await _dispatch_tool(func_name, func_args)

            extended_contents = list(contents) + [
                {"role": "model", "parts": [{"text": f"[Executing tool: {func_name}...]"}]},
                {"role": "user", "parts": [{"text": f"[Tool Result — {func_name}]:\n{tool_result or 'No result. Answer from training knowledge.'}"}]},
            ]

            async for item in gemini_api.stream(
                _history_to_messages(system_instruction, _sliding_window(_sanitize_roles(extended_contents))),
                model=provider.get("model", "gemini-2.0-flash"),
                tools_payload=TOOLS_PAYLOAD,
                tool_config={"functionCallingConfig": {"mode": "NONE"}},
            ):
                if isinstance(item, str):
                    yield json.dumps({"token": item})

    # ── Gemini Web / Colibri: no native function calling ──────────────────────
    # We do a simulated tool detection pass: ask Gemini API (if key available)
    # to check for tool need, then stream final response through configured provider.
    else:
        from backend.providers import gemini_api

        gemini_keys = CONFIG.get("gemini_api_keys", [])
        func_name = None
        func_args = {}

        if gemini_keys:
            # Quick non-streaming tool-check call via Gemini API
            try:
                check_msgs = _history_to_messages(system_instruction, contents)
                resp_data = await gemini_api.complete(
                    check_msgs,
                    model="gemini-2.0-flash",
                    tools_payload=TOOLS_PAYLOAD,
                )
                part = (
                    resp_data.get("candidates", [{}])[0]
                    .get("content", {}).get("parts", [{}])[0]
                )
                if part.get("functionCall"):
                    fc = part["functionCall"]
                    func_name = fc.get("name")
                    func_args = fc.get("args", {})
            except Exception:
                pass  # fall through to direct generation

        if func_name:
            yield json.dumps({"tool": func_name})
            tool_result = await _dispatch_tool(func_name, func_args)

            # Inject tool result into history
            contents = _sliding_window(_sanitize_roles(list(contents) + [
                {"role": "model", "parts": [{"text": f"[Executing tool: {func_name}...]"}]},
                {"role": "user", "parts": [{"text": f"[Tool Result — {func_name}]:\n{tool_result or 'No result.'}"}]},
            ]))

        # Stream final response through the configured provider
        messages = _history_to_messages(system_instruction, contents)

        if provider_name == "gemini-web":
            from backend.providers import gemini_web
            model = provider.get("model", "gemini-3.6-flash")
            async for delta in gemini_web.stream(messages, model=model):
                yield json.dumps({"token": delta})

        elif provider_name == "colibri":
            from backend.providers import colibri
            model = provider.get("model", "glm-5.2")
            async for delta in colibri.stream(messages, model=model):
                yield json.dumps({"token": delta})

        else:
            yield json.dumps({"error": f"Unknown provider: {provider_name}"})

    yield "[DONE]"


def _history_to_messages(system_instruction: dict, contents: list) -> list:
    """Flatten system instruction + Gemini-style contents → OpenAI-style messages."""
    messages = []
    sys_text = system_instruction.get("parts", [{}])[0].get("text", "")
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    for c in contents:
        role = c.get("role", "user")
        if role == "model":
            role = "assistant"
        parts = c.get("parts", [])
        text = " ".join(p.get("text", "") for p in parts if isinstance(p, dict))
        messages.append({"role": role, "content": text})
    return messages

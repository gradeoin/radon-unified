"""
Radon Unified — Agentic Tool: Python Code Execution
Piston API sandbox with auto self-healing via Gemini.
Ported from radon/worker/worker.js executePythonCode().
"""
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from backend.config import CONFIG

TOOL_DEFINITION = {
    "name": "execute_python",
    "description": "Execute Python code in a cloud sandbox and return the output. Useful for calculations, data processing, and algorithms.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "code": {"type": "STRING", "description": "The Python code to execute"}
        },
        "required": ["code"]
    }
}

_PISTON_URL = "https://emkc.org/api/v2/piston/execute"


async def run(code: str, attempt: int = 1, max_attempts: int = 3) -> str:
    """Execute Python code. Auto-heals broken code up to max_attempts times."""
    if not HAS_HTTPX:
        return "Python execution unavailable: httpx not installed (pip install httpx)"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _PISTON_URL,
                json={
                    "language": "python",
                    "version": "3.10.0",
                    "files": [{"name": "main.py", "content": code}],
                },
                headers={"Content-Type": "application/json"},
            )
            data = resp.json()

        run_data = data.get("run", {})
        output = run_data.get("output", "")
        stderr = run_data.get("stderr", "")

        has_error = any(
            marker in (stderr + output)
            for marker in ("Error", "Traceback", "SyntaxError", "NameError", "TypeError")
        )

        if has_error and attempt < max_attempts:
            # Try to auto-heal via Gemini API
            gemini_keys = CONFIG.get("gemini_api_keys", [])
            if gemini_keys:
                fix_key = gemini_keys[0]
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        fix_resp = await client.post(
                            f"https://generativelanguage.googleapis.com/v1beta/models/"
                            f"gemini-2.0-flash:generateContent?key={fix_key}",
                            json={
                                "contents": [{
                                    "role": "user",
                                    "parts": [{"text": (
                                        f"This Python code failed. Fix it and return ONLY "
                                        f"the corrected Python code, no explanation:\n\n"
                                        f"Code:\n```python\n{code}\n```\n\n"
                                        f"Error:\n{stderr or output}"
                                    )}]
                                }]
                            },
                            headers={"Content-Type": "application/json"},
                        )
                    fix_data = fix_resp.json()
                    fixed_code = (
                        fix_data.get("candidates", [{}])[0]
                        .get("content", {}).get("parts", [{}])[0].get("text", code)
                    )
                    # Strip markdown code fences
                    import re
                    fixed_code = re.sub(r"^```python\n?", "", fixed_code, flags=re.IGNORECASE)
                    fixed_code = re.sub(r"^```\n?", "", fixed_code)
                    fixed_code = re.sub(r"```$", "", fixed_code).strip()

                    retry_result = await run(fixed_code, attempt + 1, max_attempts)
                    return f"⚙️ Auto-fixed on attempt {attempt + 1}:\n\n{retry_result}"
                except Exception:
                    pass

        if has_error:
            suffix = f"s" if attempt > 1 else ""
            return f"❌ Error (after {attempt} attempt{suffix}):\n{stderr or output}"

        return output.strip() or "✅ Code ran successfully (no output)."

    except Exception as e:
        return f"Execution failed: {e}"

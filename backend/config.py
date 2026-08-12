"""
Radon Unified — Shared Configuration Loader
Reads config.json from the project root.
"""
import json
import os
import sys

# Resolve config.json path relative to the project root (one level up from backend/)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONFIG_PATH = os.path.join(_ROOT, "config.json")

_DEFAULTS = {
    "port": 8080,
    "gemini_api_keys": [],
    "tavily_api_key": "",
    "gnews_api_key": "",
    "openrouter_api_key": "",
    "gemini_web": {
        "enabled": True,
        "cookie_file": None,
        "auth_user": None,
        "xsrf_token": None,
        "gemini_bl": "boq_assistant-bard-web-server_20260716.08_p0",
        "proxy": None,
        "retry_attempts": 3,
        "retry_delay_sec": 2,
        "request_timeout_sec": 180,
    },
    "colibri": {
        "enabled": False,
        "binary_path": "",
        "model_path": "",
        "server_port": 8082,
        "auto_start": True,
    },
    "rate_limit": "30/minute",
    "log_requests": True,
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base."""
    result = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def load() -> dict:
    cfg = dict(_DEFAULTS)
    if os.path.exists(_CONFIG_PATH):
        try:
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                user_cfg = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
            cfg = _deep_merge(cfg, user_cfg)
        except Exception as e:
            print(f"[config] Warning: could not load config.json — {e}", file=sys.stderr)
    return cfg


CONFIG = load()

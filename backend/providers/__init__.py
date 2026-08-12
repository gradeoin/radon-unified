"""
Radon Unified — Provider Registry
Routes model selection to the correct backend provider.
"""
from backend.config import CONFIG
from backend.providers import gemini_web, gemini_api, colibri


def get_all_models() -> list[dict]:
    """Return all models from all providers."""
    models = []
    models.extend(gemini_web.list_models())
    models.extend(gemini_api.list_models())
    models.extend(colibri.list_models())
    return models


def get_streaming_provider(model_id: str = "") -> tuple[str, dict]:
    """
    Given a model ID, return (provider_name, provider_config).
    Falls back intelligently if preferred provider isn't available.
    """
    # Colibri models
    if model_id in colibri.COLIBRI_MODELS:
        return "colibri", {"model": model_id}

    # Gemini Web models
    base_model = model_id.split("@think=")[0] if "@think=" in model_id else model_id
    if base_model in gemini_web.MODELS or not model_id:
        effective = model_id or "gemini-3.6-flash"
        if CONFIG.get("gemini_web", {}).get("enabled", True):
            return "gemini-web", {"model": effective}

    # Gemini API models (or fallback from web)
    gemini_keys = CONFIG.get("gemini_api_keys", [])
    if gemini_keys:
        api_model = model_id if model_id in gemini_api.MODELS else "gemini-2.0-flash"
        return "gemini-api", {"model": api_model}

    # Last resort: gemini-web even if not ideal
    return "gemini-web", {"model": model_id or "gemini-3.6-flash"}

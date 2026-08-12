"""
Radon Unified — Agentic Tool: AI Image Generation
Uses Pollinations.AI FLUX model (free, no key required).
Ported from radon/worker/worker.js generateAiImage().
"""
import random
import urllib.parse

TOOL_DEFINITION = {
    "name": "generate_image",
    "description": "Generate a high-quality AI image from a detailed text description using FLUX.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "prompt": {"type": "STRING", "description": "Detailed description of the image to generate"}
        },
        "required": ["prompt"]
    }
}


def run(prompt: str) -> str:
    """Returns a markdown image embed using Pollinations FLUX (synchronous — just builds a URL)."""
    enhanced = (
        f"{prompt}, masterpiece, 8k resolution, photorealistic, "
        "cinematic lighting, sharp focus, high quality"
    )
    encoded = urllib.parse.quote(enhanced)
    seed = random.randint(100000, 999999)
    url = (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?width=1024&height=1024&model=flux&nologo=true&enhance=true&seed={seed}"
    )
    return f"🎨 Image generated successfully using **FLUX** engine!\n\n![{prompt}]({url})"

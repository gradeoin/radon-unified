# Radon AI — Unified Local Agent

A fully self-hosted, unified AI agent that combines:
- **`radon`** — Beautiful glassmorphism chat frontend + agentic tool loop
- **`gemini-web2api`** — Free Gemini access via web reverse-engineering (no API key)  
- **`colibri`** — Local MoE frontier model inference (GLM-5.2, DeepSeek, Inkling, etc.)

## Quick Start

### Windows
```
Double-click: start.bat
```

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
```

Then open: **http://localhost:8080**

---

## Features

| Feature | Status |
|---|---|
| Gemini Web (free, no key) | ✅ Works out of the box |
| 5 agentic tools (search, weather, news, code, images) | ✅ Works out of the box |
| Gemini API (with key) | Optional — add key to config.json |
| Colibri local models (GLM-5.2, DeepSeek V4, etc.) | Optional — requires binary + model |
| AES-256 encrypted chat history | ✅ Built-in |
| Streaming SSE responses | ✅ Built-in |
| Model selector in UI | ✅ Built-in |

---

## Configuration

Edit `config.json` to customize behavior:

```json
{
  "port": 8080,
  "gemini_api_keys": ["AIzaSy..."],  // optional, from aistudio.google.com
  "tavily_api_key": "",              // optional, from tavily.com (better web search)
  "gnews_api_key": "",               // optional, from gnews.io (news tool)
  "gemini_web": {
    "enabled": true
  },
  "colibri": {
    "enabled": false,
    "binary_path": "C:/path/to/colibri.exe",
    "model_path": "C:/path/to/glm-5.2.gguf",
    "server_port": 8082
  }
}
```

---

## AI Providers

### 1. Gemini Web (Default — Free, No Key)
Uses the reverse-engineered Gemini web interface. No API key needed.
Supports: `gemini-3.6-flash`, `gemini-3.5-flash-thinking`, `gemini-flash-lite`, `gemini-auto`

### 2. Gemini API (Optional)
Add your key from [AI Studio](https://aistudio.google.com) to `config.json → gemini_api_keys`.
Enables: `gemini-2.0-flash`, `gemini-2.0-flash-lite`, and better tool calling.

### 3. Colibri Local Models (Optional)
Runs massive open-source frontier models entirely on your machine.

**Setup:**
1. Build colibri from `../colibri/` (`make` or `cmake`)
2. Download a model (e.g., GLM-5.2 from Hugging Face)
3. Set `colibri.enabled = true`, `binary_path`, and `model_path` in `config.json`
4. Restart Radon — local models appear enabled in the model selector

**Available local models:**
| Model | Size | RAM |
|---|---|---|
| GLM-5.2 744B MoE | 372 GB | 16 GB |
| Inkling 975B MoE | 469 GB | 25 GB |
| DeepSeek V4 Flash 284B | 167 GB | 16 GB |
| OLMoE 7B | 4 GB | 8 GB |

---

## Agentic Tools

All tools work out of the box (no keys required for basic use):

| Tool | Description | Key Required |
|---|---|---|
| `search_web` | Tavily deep search → Wikipedia fallback | Optional (Tavily) |
| `get_weather` | Live weather via Open-Meteo + geocoding | None |
| `get_news` | Latest headlines via GNews | Optional (GNews) |
| `execute_python` | Run Python in Piston cloud sandbox | None |
| `generate_image` | FLUX image via Pollinations | None |

---

## Project Structure

```
radon-unified/
├── backend/
│   ├── server.py          ← FastAPI server (main entry point)
│   ├── config.py          ← Config loader
│   ├── agentic_loop.py    ← 2-phase tool execution loop
│   ├── providers/
│   │   ├── gemini_web.py  ← Free Gemini provider
│   │   ├── gemini_api.py  ← Gemini REST API provider
│   │   └── colibri.py     ← Local model provider
│   └── tools/
│       ├── web_search.py
│       ├── weather.py
│       ├── news.py
│       ├── code_exec.py
│       └── image_gen.py
├── frontend/              ← Radon UI (glassmorphism chat)
│   ├── index.html
│   ├── app.js             ← Adapted for local backend
│   └── style.css
├── config.json            ← User configuration
├── requirements.txt
├── start.bat              ← Windows launcher
└── start.sh               ← Linux/macOS launcher
```

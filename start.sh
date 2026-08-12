#!/bin/bash
echo ""
echo " ================================"
echo "  Radon AI — Unified Local Agent"
echo " ================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 not found. Install Python 3.10+"
    exit 1
fi

# Install deps if missing
python3 -c "import fastapi" 2>/dev/null || {
    echo "[Radon] Installing dependencies..."
    pip3 install -r requirements.txt || { echo "[ERROR] pip install failed"; exit 1; }
}

echo "[Radon] Starting server at http://localhost:8080 ..."
echo "[Radon] Press Ctrl+C to stop."
echo ""

# Open browser (cross-platform)
(sleep 2 && (xdg-open http://localhost:8080 2>/dev/null || open http://localhost:8080 2>/dev/null)) &

# Run server
python3 -m uvicorn backend.server:app --host 0.0.0.0 --port 8080 --reload

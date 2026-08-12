@echo off
title Radon AI — Unified Server
color 0A

echo.
echo  ================================
echo   Radon AI — Unified Local Agent
echo  ================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

:: Install dependencies if needed
echo [Radon] Checking Python dependencies...
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo [Radon] Installing dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Start the server
echo [Radon] Starting server on http://localhost:8080 ...
echo [Radon] Press Ctrl+C to stop.
echo.

:: Open browser after 2 seconds
start /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Run the server
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8080 --reload

pause

@echo off
title NeuroLens Launcher
setlocal
cd /d "%~dp0"

echo ===================================================
echo               LAUNCHING NEUROLENS (dev)
echo ===================================================

if not exist backend\.venv\Scripts\python.exe (
  echo [setup] Creating Python virtual environment and installing dependencies...
  python -m venv backend\.venv || goto :fail
  backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt || goto :fail
)
if not exist frontend\node_modules (
  echo [setup] Installing frontend dependencies...
  pushd frontend && call npm.cmd ci && popd
)
if not exist .env echo [note] No .env found. Copy .env.example to .env to add LLM keys and SSO. Defaults are used for now.

echo [1/2] Starting FastAPI backend on port 8000...
start "NeuroLens Backend" cmd /k "cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"

echo [2/2] Starting Vite frontend on port 5173...
start "NeuroLens Frontend" cmd /k "cd frontend && npm.cmd run dev"

echo.
echo Web UI:      http://localhost:5173
echo API docs:    http://localhost:8000/docs
echo (The frontend proxies /api to the backend; keep both windows open.)
pause > nul
exit /b 0

:fail
echo Setup failed. See the messages above.
pause
exit /b 1

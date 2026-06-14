@echo off
title NeuroLens Launcher
echo ===================================================
echo               LAUNCHING NEUROLENS
echo ===================================================
echo.
echo [1/2] Starting FastAPI Backend on port 8000...
start "NeuroLens Backend" cmd /k "cd backend && python -u app.py"

echo [2/2] Starting Vite Frontend on port 5173...
start "NeuroLens Frontend" cmd /k "cd frontend && npm.cmd run dev"

echo.
echo ===================================================
echo NeuroLens launched successfully!
echo Web UI:     http://localhost:5173
echo Backend API: http://127.0.0.1:8000
echo ===================================================
echo.
echo Keep this window open to monitor system launch.
echo Press any key to exit this launcher (servers will keep running in their separate windows).
pause > nul

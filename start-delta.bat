@echo off
title Delta Intelligence Platform
cd /d "%~dp0"

echo.
echo  ========================================
echo   Delta Intelligence Platform - Launcher
echo  ========================================
echo.

:: ── Step 0: Kill stale processes and wait for port 8000 ────────
echo [0/3] Cleaning up stale processes...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":8000.*LISTENING"') do (
    echo        Killing PID %%p on port 8000
    taskkill /f /pid %%p >nul 2>&1
)
taskkill /f /im cloudflared.exe >nul 2>&1
:: Wait until port 8000 is truly free (handles TIME_WAIT after hard kill)
set /a _tries=0
:wait_port
netstat -aon | findstr ":8000.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set /a _tries+=1
    if %_tries% GEQ 30 (
        echo [ERROR] Port 8000 still in use after 30s.
        pause
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
    goto wait_port
)
echo [0/3] Port 8000 free. Cleanup complete.
echo.

:: ── Step 1: Build frontend ──────────────────────────────────────
echo [1/3] Building frontend...
cd frontend
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)
cd ..
echo [1/3] Frontend build complete.
echo.

:: ── Step 2: Start cloudflared tunnel in background ──────────────
echo [2/3] Starting Cloudflare Tunnel...
start /b "" "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run delta
echo [2/3] Cloudflare Tunnel started (delta-intelligence.app)
echo.

:: ── Step 3: Start uvicorn (foreground, logs visible) ────────────
echo [3/3] Starting backend server on port 8000...
echo.
echo  ============================================
echo   LIVE at https://delta-intelligence.app
echo   Local:  http://localhost:8000
echo   Press Ctrl+C to stop
echo  ============================================
echo.
cd backend
venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

:: ── Cleanup on exit ─────────────────────────────────────────────
echo.
echo Shutting down Cloudflare Tunnel...
taskkill /f /im cloudflared.exe >nul 2>&1
echo Done.
pause

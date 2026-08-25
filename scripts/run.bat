@echo off
echo Starting Delta Intelligence Platform...
echo.

REM Start backend
echo Starting backend API on port 8000...
start "Delta Backend" cmd /c "cd /d %~dp0..\backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

REM Wait for backend to start
timeout /t 3 /nobreak > nul

REM Start frontend
echo Starting frontend on port 5173...
start "Delta Frontend" cmd /c "cd /d %~dp0..\frontend && npm run dev"

REM Wait for frontend to start
timeout /t 3 /nobreak > nul

echo.
echo ============================================================
echo  Delta Intelligence Platform is running
echo  Open: http://localhost:5173
echo ============================================================
echo  Press any key to stop both servers...
pause > nul

REM Kill the servers
taskkill /fi "windowtitle eq Delta Backend*" /f > nul 2>&1
taskkill /fi "windowtitle eq Delta Frontend*" /f > nul 2>&1
echo Servers stopped.

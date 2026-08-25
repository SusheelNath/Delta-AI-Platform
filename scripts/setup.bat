@echo off
echo ============================================================
echo  Delta Intelligence Platform - Setup
echo ============================================================
echo.

REM Step 1: Install Python dependencies
echo [1/4] Installing Python dependencies...
cd /d "%~dp0..\backend"
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Python dependency installation failed
    pause
    exit /b 1
)
echo.

REM Step 2: Run data ingestion
echo [2/4] Ingesting hospital data...
python scripts/ingest_data.py
if errorlevel 1 (
    echo ERROR: Data ingestion failed
    pause
    exit /b 1
)
echo.

REM Step 3: Install Node dependencies
echo [3/4] Installing frontend dependencies...
cd /d "%~dp0..\frontend"
npm install
if errorlevel 1 (
    echo ERROR: Frontend dependency installation failed
    pause
    exit /b 1
)
echo.

REM Step 4: Convert IFC (optional, takes time)
echo [4/4] IFC to XKT conversion...
echo NOTE: This converts the 678MB IFC file to XKT format.
echo       This may take 10-30 minutes and requires ~8GB RAM.
echo.
set /p CONVERT="Run conversion now? (y/n): "
if /i "%CONVERT%"=="y" (
    cd /d "%~dp0.."
    npm install @xeokit/xeokit-convert
    node scripts/convert_ifc.mjs
) else (
    echo Skipping IFC conversion. You can run it later:
    echo   node scripts/convert_ifc.mjs
)
echo.

echo ============================================================
echo  Setup complete!
echo  To start the platform:
echo    1. Start backend:  cd backend ^&^& python -m uvicorn app.main:app --port 8000
echo    2. Start frontend: cd frontend ^&^& npm run dev
echo    3. Open: http://localhost:5173
echo ============================================================
pause

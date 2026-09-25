import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import floors, spaces, chat, exclusions, export, polygons, metrics, furnishings, voice, learnings

# Frontend dist directory (built by Vite)
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

app = FastAPI(
    title="Delta Intelligence Platform",
    description="API for CHIREC Delta Hospital spatial intelligence",
    version="0.1.0",
)

_cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:5174,https://delta-intelligence.app",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(floors.router, prefix="/api")
app.include_router(spaces.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(exclusions.router, prefix="/api")
app.include_router(export.router)
app.include_router(polygons.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(furnishings.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(learnings.router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()
    # Auto-seed furnishing types catalog on startup
    from app.database import SessionLocal
    from app.services.furnishings import seed_furnishing_types
    from app.services.intelligence_cache import build_cache
    db = SessionLocal()
    try:
        seed_furnishing_types(db)
        build_cache(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "platform": "Delta Intelligence Platform"}


# ── Serve frontend static build ─────────────────────────────────
if FRONTEND_DIST.is_dir():
    # Serve JS/CSS/assets and models at their exact paths
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static-assets")
    app.mount("/models", StaticFiles(directory=FRONTEND_DIST / "models"), name="static-models")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Serve static files or fall back to index.html for SPA routing."""
        file = FRONTEND_DIST / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import floors, spaces, chat, exclusions, export, polygons

app = FastAPI(
    title="Delta Intelligence Platform",
    description="API for CHIREC Delta Hospital spatial intelligence",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
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


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok", "platform": "Delta Intelligence Platform"}

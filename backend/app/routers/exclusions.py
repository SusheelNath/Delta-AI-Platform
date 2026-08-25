"""Endpoint to save/load IFC object exclusion lists for XKT baking."""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
EXCLUSIONS_FILE = PROJECT_ROOT / "scripts" / "excluded_objects.json"
FRONTEND_EXCLUSIONS = PROJECT_ROOT / "frontend" / "public" / "models" / "exclusions.json"


class ExclusionList(BaseModel):
    object_ids: list[str]


@router.get("/exclusions")
def get_exclusions():
    if not EXCLUSIONS_FILE.exists():
        return {"object_ids": [], "count": 0}
    try:
        data = json.loads(EXCLUSIONS_FILE.read_text())
        return {"object_ids": data, "count": len(data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exclusions")
def save_exclusions(body: ExclusionList):
    try:
        content = json.dumps(body.object_ids, indent=2)
        EXCLUSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        EXCLUSIONS_FILE.write_text(content)
        # Also update the frontend static file so it takes effect on next reload
        FRONTEND_EXCLUSIONS.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_EXCLUSIONS.write_text(content)
        return {"saved": len(body.object_ids), "path": str(FRONTEND_EXCLUSIONS)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

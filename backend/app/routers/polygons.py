import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.database import get_db
from app.models import Space
from app.schemas import PolygonSaveRequest, SpacePolygonResponse

router = APIRouter(tags=["polygons"])

POLYGONS_FILE = DATA_DIR / "polygons.json"
BACKUP_FILE = Path.home() / "Documents" / "delta-polygons-backup" / "polygons.json"


def _read_all() -> list[dict]:
    """Read all polygons from the JSON file."""
    if not POLYGONS_FILE.exists():
        return []
    with open(POLYGONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_all(polygons: list[dict]):
    """Write all polygons to both the project file and the external backup."""
    for target in (POLYGONS_FILE, BACKUP_FILE):
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(polygons, f, indent=2)
        tmp.replace(target)


@router.put("/spaces/{ifc_guid}/polygon", response_model=SpacePolygonResponse)
def upsert_polygon(
    ifc_guid: str,
    body: PolygonSaveRequest,
    db: Session = Depends(get_db),
):
    space = db.query(Space).filter(Space.ifc_guid == ifc_guid).first()
    if not space:
        raise HTTPException(status_code=404, detail=f"Space with GUID {ifc_guid} not found")

    if len(body.vertices) < 3:
        raise HTTPException(status_code=422, detail="Polygon must have at least 3 vertices")

    now = datetime.utcnow().isoformat()
    polygons = _read_all()

    # Upsert: replace existing or append
    entry = {
        "ifc_guid": ifc_guid,
        "floor_id": body.floor_id,
        "vertices": body.vertices,
        "space_name": space.space_name,
        "primary_function": space.primary_function,
        "area_m2": body.computed_area_m2,
        "perimeter_cm": body.computed_perimeter_cm,
        "created_at": now,
    }

    found = False
    for i, p in enumerate(polygons):
        if p["ifc_guid"] == ifc_guid:
            entry["created_at"] = p.get("created_at", now)  # keep original timestamp
            polygons[i] = entry
            found = True
            break
    if not found:
        polygons.append(entry)

    _write_all(polygons)

    return SpacePolygonResponse(**entry)


@router.get("/floors/{floor_id}/polygons", response_model=list[SpacePolygonResponse])
def list_floor_polygons(floor_id: str, db: Session = Depends(get_db)):
    polygons = _read_all()
    # Look up latest space data from DB for each polygon on this floor
    results = []
    for p in polygons:
        if p["floor_id"].upper() != floor_id.upper():
            continue
        space = db.query(Space).filter(Space.ifc_guid == p["ifc_guid"]).first()
        # Prefer polygon-computed area (reflects drawn geometry), fall back to IFC area
        area = p.get("area_m2") if p.get("area_m2") is not None else (space.area_m2 if space else None)
        results.append(SpacePolygonResponse(
            ifc_guid=p["ifc_guid"],
            floor_id=p["floor_id"],
            vertices=p["vertices"],
            space_name=space.space_name if space else p.get("space_name"),
            primary_function=space.primary_function if space else p.get("primary_function"),
            area_m2=area,
            created_at=p.get("created_at"),
        ))
    return results


@router.delete("/spaces/{ifc_guid}/polygon")
def delete_polygon(ifc_guid: str):
    polygons = _read_all()
    before = len(polygons)
    polygons = [p for p in polygons if p["ifc_guid"] != ifc_guid]
    if len(polygons) == before:
        raise HTTPException(status_code=404, detail=f"No polygon for GUID {ifc_guid}")
    _write_all(polygons)
    return {"deleted": True}

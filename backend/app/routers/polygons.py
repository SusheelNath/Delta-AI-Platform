import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.database import get_db
from app.models import SpaceMetrics
from app.schemas import PolygonSaveRequest, PolygonSyncItem, SpacePolygonResponse
from app.services.occupancy import compute_occupancy

router = APIRouter(tags=["polygons"])

POLYGONS_FILE = DATA_DIR / "polygons.json"
BACKUP_FILE = Path.home() / "Documents" / "delta-polygons-backup" / "polygons.json"


def _read_all() -> list[dict]:
    """Read all polygons from the JSON file.
    Strips trailing commas and handles extra data appended after the array."""
    if not POLYGONS_FILE.exists():
        return []
    with open(POLYGONS_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    if not content.strip():
        return []
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Strip trailing commas before ] or } (common JSON corruption)
        cleaned = re.sub(r',\s*([}\]])', r'\1', content)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            decoder = json.JSONDecoder()
            result, _ = decoder.raw_decode(cleaned.lstrip())
            return result if isinstance(result, list) else []


def _write_all(polygons: list[dict]):
    """Write all polygons to both the project file and the external backup."""
    for target in (POLYGONS_FILE, BACKUP_FILE):
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(polygons, f, indent=2)
        tmp.replace(target)


def _upsert_metrics(db: Session, ifc_guid: str, floor_id: str,
                    area_m2: float | None, perimeter_m: float | None,
                    primary_function: str | None,
                    space_name: str | None = None) -> SpaceMetrics:
    """Compute occupancy and upsert into space_metrics table.

    If the space has furnishings, recompute from furnishings (source of truth).
    Otherwise fall back to the density model."""
    from app.models import SpaceFurnishing, FurnishingType
    from app.services.furnishings import compute_furnishing_occupancy

    now = datetime.utcnow().isoformat()

    # Check if this space has furnishings
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == ifc_guid
    ).all()

    metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == ifc_guid).first()
    if not metrics:
        metrics = SpaceMetrics(ifc_guid=ifc_guid, floor_id=floor_id)
        db.add(metrics)

    # Always update geometry fields
    metrics.floor_id = floor_id
    metrics.area_m2 = area_m2
    metrics.perimeter_m = perimeter_m
    metrics.computed_at = now

    if furnishings:
        # Furnishings are source of truth — recompute from them
        ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
        occ = compute_furnishing_occupancy(furnishings, ft_map, area_m2 or 0)
        density_occ = compute_occupancy(primary_function, area_m2, space_name)
        metrics.normal_occupancy = occ["normal_occupancy"]
        metrics.max_occupancy = occ["max_occupancy"]
        metrics.absolute_occupancy = occ["absolute_occupancy"]
        metrics.used_area_m2 = occ["used_area_m2"]
        metrics.free_area_m2 = occ["free_area_m2"]
        metrics.occupancy_class = density_occ["occupancy_class"]
        metrics.occupiable = occ["normal_occupancy"] > 0
        metrics.furnishing_source = "furnishings"
    else:
        # Density model fallback
        occ = compute_occupancy(primary_function, area_m2, space_name)
        metrics.normal_occupancy = occ["normal_occupancy"]
        metrics.max_occupancy = occ["max_occupancy"]
        metrics.absolute_occupancy = 0
        metrics.occupancy_class = occ["occupancy_class"]
        metrics.occupiable = occ["occupiable"]
        metrics.used_area_m2 = None
        metrics.free_area_m2 = None
        metrics.furnishing_source = "density_model"

    db.commit()
    db.refresh(metrics)
    return metrics


@router.put("/spaces/{ifc_guid}/polygon", response_model=SpacePolygonResponse)
def upsert_polygon(
    ifc_guid: str,
    body: PolygonSaveRequest,
    db: Session = Depends(get_db),
):
    if len(body.vertices) < 3:
        raise HTTPException(status_code=422, detail="Polygon must have at least 3 vertices")

    now = datetime.utcnow().isoformat()
    polygons = _read_all()

    # Convert perimeter: frontend sends cm, we store cm in JSON but m in metrics
    perimeter_cm = body.computed_perimeter_cm
    perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None
    area_m2 = body.computed_area_m2

    # ── Polygon geometry freeze ──
    # Existing polygon geometry (vertices, area, perimeter) is immutable.
    # Name and function CAN be updated by the user via the editor.
    existing = next((p for p in polygons if p["ifc_guid"] == ifc_guid), None)
    if existing:
        # Geometry stays frozen
        area_m2 = existing.get("area_m2")
        perimeter_cm = existing.get("perimeter_cm")
        perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None

        # Allow name/function edits from the UI
        dirty = False
        space_name = existing.get("space_name")
        primary_function = existing.get("primary_function")
        if body.space_name and body.space_name != space_name:
            existing["space_name"] = body.space_name
            space_name = body.space_name
            dirty = True
        if body.primary_function and body.primary_function != primary_function:
            existing["primary_function"] = body.primary_function
            primary_function = body.primary_function
            dirty = True
        if dirty:
            _write_all(polygons)

        metrics = _upsert_metrics(db, ifc_guid, existing["floor_id"], area_m2, perimeter_m, primary_function, space_name)
        return SpacePolygonResponse(
            ifc_guid=ifc_guid,
            floor_id=existing["floor_id"],
            vertices=existing["vertices"],
            space_name=space_name,
            primary_function=primary_function,
            area_m2=area_m2,
            perimeter_m=perimeter_m,
            normal_occupancy=metrics.normal_occupancy,
            max_occupancy=metrics.max_occupancy,
            occupancy_class=metrics.occupancy_class,
            occupiable=metrics.occupiable,
            created_at=existing.get("created_at"),
        )

    # New polygon — accept all fields and persist
    space_name = body.space_name
    primary_function = body.primary_function
    entry = {
        "ifc_guid": ifc_guid,
        "floor_id": body.floor_id,
        "vertices": body.vertices,
        "space_name": space_name,
        "primary_function": primary_function,
        "area_m2": area_m2,
        "perimeter_cm": perimeter_cm,
        "created_at": now,
    }
    polygons.append(entry)
    _write_all(polygons)

    # Compute and store metrics
    metrics = _upsert_metrics(db, ifc_guid, body.floor_id, area_m2, perimeter_m, primary_function, space_name)

    return SpacePolygonResponse(
        ifc_guid=ifc_guid,
        floor_id=body.floor_id,
        vertices=body.vertices,
        space_name=space_name,
        primary_function=primary_function,
        area_m2=area_m2,
        perimeter_m=perimeter_m,
        normal_occupancy=metrics.normal_occupancy,
        max_occupancy=metrics.max_occupancy,
        occupancy_class=metrics.occupancy_class,
        occupiable=metrics.occupiable,
        created_at=entry["created_at"],
    )


@router.post("/polygons/commit-edits")
def commit_edits(body: list[dict], db: Session = Depends(get_db)):
    """Bulk commit: push localStorage name/function edits to polygons.json.

    Accepts list of {ifc_guid, space_name, primary_function}.
    Only updates name/function for polygons that already exist.
    Geometry (vertices, area, perimeter) is never touched.
    """
    polygons = _read_all()
    poly_map = {p["ifc_guid"]: p for p in polygons}

    updated = 0
    for item in body:
        guid = item.get("ifc_guid")
        if not guid or guid not in poly_map:
            continue
        p = poly_map[guid]
        dirty = False
        new_name = item.get("space_name")
        new_fn = item.get("primary_function")
        if new_name and new_name != p.get("space_name"):
            p["space_name"] = new_name
            dirty = True
        if new_fn and new_fn != p.get("primary_function"):
            p["primary_function"] = new_fn
            dirty = True
        if dirty:
            updated += 1

    if updated > 0:
        _write_all(polygons)

    return {"updated": updated, "total": len(polygons)}


@router.post("/polygons/sync")
def sync_polygons(body: list[PolygonSyncItem], db: Session = Depends(get_db)):
    """Bulk sync: push localStorage polygons the server doesn't have.

    ── Polygon metadata hard lock ──
    Existing polygons are NEVER modified by this endpoint.
    Only new polygons (by ifc_guid) are appended.
    """
    polygons = _read_all()
    existing_guids = {p["ifc_guid"] for p in polygons}
    now = datetime.utcnow().isoformat()
    added = 0
    for item in body:
        if item.ifc_guid in existing_guids:
            continue
        if len(item.vertices) < 3:
            continue
        perimeter_cm = item.perimeter_cm
        perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None
        polygons.append({
            "ifc_guid": item.ifc_guid,
            "floor_id": item.floor_id,
            "vertices": item.vertices,
            "space_name": item.space_name,
            "primary_function": item.primary_function,
            "area_m2": item.area_m2,
            "perimeter_cm": perimeter_cm,
            "created_at": now,
        })
        existing_guids.add(item.ifc_guid)
        added += 1

        # Compute metrics for new polygon
        _upsert_metrics(db, item.ifc_guid, item.floor_id, item.area_m2, perimeter_m, item.primary_function, item.space_name)

    if added > 0:
        _write_all(polygons)
    return {"synced": added, "total": len(polygons)}


@router.put("/floors/{floor_id}/polygons")
def save_floor_polygons(floor_id: str, body: list[PolygonSyncItem], db: Session = Depends(get_db)):
    """Append-only floor save.

    ── Polygon permanent freeze ──
    Existing polygons are completely immutable — ALL fields (vertices, name,
    function, area, perimeter) are preserved from the server copy unchanged.
    Only genuinely new polygons (GUID not yet on server) are appended.
    """
    polygons = _read_all()
    now = datetime.utcnow().isoformat()

    existing_guids = {p["ifc_guid"] for p in polygons}

    added = 0
    for item in body:
        if item.ifc_guid in existing_guids:
            continue  # frozen — skip entirely
        if len(item.vertices) < 3:
            continue
        perimeter_cm = item.perimeter_cm
        perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None
        polygons.append({
            "ifc_guid": item.ifc_guid,
            "floor_id": floor_id,
            "vertices": item.vertices,
            "space_name": item.space_name,
            "primary_function": item.primary_function,
            "area_m2": item.area_m2,
            "perimeter_cm": perimeter_cm,
            "created_at": now,
        })
        existing_guids.add(item.ifc_guid)
        _upsert_metrics(db, item.ifc_guid, floor_id, item.area_m2, perimeter_m, item.primary_function, item.space_name)
        added += 1

    if added > 0:
        _write_all(polygons)
    return {"added": added, "total": len(polygons)}


@router.get("/floors/{floor_id}/polygons", response_model=list[SpacePolygonResponse])
def list_floor_polygons(floor_id: str, db: Session = Depends(get_db)):
    polygons = _read_all()
    results = []
    for p in polygons:
        if p["floor_id"].upper() != floor_id.upper():
            continue
        perimeter_cm = p.get("perimeter_cm")
        perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None

        # Get metrics if available
        metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == p["ifc_guid"]).first()

        results.append(SpacePolygonResponse(
            ifc_guid=p["ifc_guid"],
            floor_id=p["floor_id"],
            vertices=p["vertices"],
            space_name=p.get("space_name"),
            primary_function=p.get("primary_function"),
            area_m2=p.get("area_m2"),
            perimeter_m=perimeter_m,
            normal_occupancy=metrics.normal_occupancy if metrics else 0,
            max_occupancy=metrics.max_occupancy if metrics else 0,
            absolute_occupancy=metrics.absolute_occupancy if metrics else 0,
            occupancy_class=metrics.occupancy_class if metrics else None,
            occupiable=metrics.occupiable if metrics else False,
            used_area_m2=metrics.used_area_m2 if metrics else None,
            free_area_m2=metrics.free_area_m2 if metrics else None,
            furnishing_source=metrics.furnishing_source if metrics else None,
            created_at=p.get("created_at"),
        ))
    return results


@router.delete("/spaces/{ifc_guid}/polygon")
def delete_polygon(ifc_guid: str, db: Session = Depends(get_db)):
    """Polygon deletion is permanently disabled."""
    raise HTTPException(
        status_code=403,
        detail="Polygon deletion is permanently disabled. "
               "Polygons cannot be removed through any API endpoint.",
    )


@router.post("/polygons/full-save")
def full_save(body: list[PolygonSyncItem], db: Session = Depends(get_db)):
    """Full save: overwrite polygons for each floor present in the payload,
    write to JSON + backup, upsert metrics, and push data/ to GitHub."""
    now = datetime.utcnow().isoformat()
    polygons = _read_all()

    # Group incoming by floor
    incoming_floors = {}
    for item in body:
        incoming_floors.setdefault(item.floor_id, []).append(item)

    # For each floor in the payload, replace all polygons for that floor
    for floor_id, items in incoming_floors.items():
        # Remove existing polygons for this floor
        polygons = [p for p in polygons if p["floor_id"] != floor_id]
        # Add incoming
        for item in items:
            if len(item.vertices) < 3:
                continue
            perimeter_cm = item.perimeter_cm
            perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None
            polygons.append({
                "ifc_guid": item.ifc_guid,
                "floor_id": floor_id,
                "vertices": item.vertices,
                "space_name": item.space_name,
                "primary_function": item.primary_function,
                "area_m2": item.area_m2,
                "perimeter_cm": perimeter_cm,
                "created_at": now,
            })
            _upsert_metrics(db, item.ifc_guid, floor_id, item.area_m2, perimeter_m,
                            item.primary_function, item.space_name)

    _write_all(polygons)

    # Git add + commit + push data/polygons.json
    repo_root = DATA_DIR.parent
    git_ok = False
    git_msg = ""
    try:
        subprocess.run(["git", "add", "data/polygons.json"], cwd=str(repo_root),
                       capture_output=True, timeout=10)
        floors_str = ", ".join(sorted(incoming_floors.keys()))
        commit_msg = f"Save polygons [{floors_str}] — {now[:19]}"
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=str(repo_root), capture_output=True, text=True, timeout=15,
        )
        push = subprocess.run(
            ["git", "push"],
            cwd=str(repo_root), capture_output=True, text=True, timeout=30,
        )
        git_ok = push.returncode == 0
        git_msg = push.stdout.strip() or push.stderr.strip()
    except Exception as e:
        git_msg = str(e)

    return {
        "saved": sum(len(v) for v in incoming_floors.values()),
        "floors": list(incoming_floors.keys()),
        "total": len(polygons),
        "git_pushed": git_ok,
        "git_message": git_msg,
    }

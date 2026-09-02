"""CRUD endpoints for furnishing types and space furnishings."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FurnishingType, SpaceFurnishing, SpaceMetrics
from app.schemas import (
    FurnishingTypeResponse,
    SpaceFurnishingCreate,
    SpaceFurnishingUpdate,
    SpaceFurnishingResponse,
)
from app.services.furnishings import (
    seed_furnishing_types,
    seed_space_furnishings,
    compute_furnishing_occupancy,
)
from app.services.occupancy import compute_occupancy
from app.routers.polygons import _read_all

router = APIRouter(tags=["furnishings"])


# ══════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════

def _enrich_furnishing(f: SpaceFurnishing, ft: FurnishingType | None) -> dict:
    """Merge furnishing row with its type info for the response."""
    d = {
        "id": f.id,
        "ifc_guid": f.ifc_guid,
        "floor_id": f.floor_id,
        "item_type": f.item_type,
        "quantity": f.quantity,
        "item_label": f.item_label,
        "notes": f.notes,
        "created_at": f.created_at,
    }
    if ft:
        d["category"] = ft.category
        d["label"] = ft.label
        d["footprint_m2"] = ft.footprint_m2
        d["normal_occ"] = ft.normal_occ
        d["max_occ"] = ft.max_occ
    return d


def _recompute_space_metrics(db: Session, ifc_guid: str, floor_id: str):
    """Recompute and upsert space_metrics for a single polygon after furnishing changes."""
    # Get furnishings for this space
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == ifc_guid
    ).all()

    # Get furnishing types lookup
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}

    # Get polygon data for area + function
    polygons = _read_all()
    poly = next((p for p in polygons if p.get("ifc_guid") == ifc_guid), None)
    area_m2 = poly.get("area_m2", 0) if poly else 0
    primary_function = poly.get("primary_function", "") if poly else ""
    space_name = poly.get("space_name", "") if poly else ""

    now = datetime.utcnow().isoformat()

    metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == ifc_guid).first()
    if not metrics:
        metrics = SpaceMetrics(ifc_guid=ifc_guid, floor_id=floor_id)
        db.add(metrics)

    if furnishings:
        # Furnishings are source of truth
        occ = compute_furnishing_occupancy(furnishings, ft_map, area_m2 or 0)
        metrics.normal_occupancy = occ["normal_occupancy"]
        metrics.max_occupancy = occ["max_occupancy"]
        metrics.absolute_occupancy = occ["absolute_occupancy"]
        metrics.used_area_m2 = occ["used_area_m2"]
        metrics.free_area_m2 = occ["free_area_m2"]
        metrics.furnishing_source = "furnishings"

        # Determine occupancy class from the dominant furnishing category
        cat_counts = {}
        for f in furnishings:
            ft = ft_map.get(f.item_type)
            if ft and ft.normal_occ > 0:
                cat_counts[ft.category] = cat_counts.get(ft.category, 0) + f.quantity
        if cat_counts:
            dominant = max(cat_counts, key=cat_counts.get)
            class_map = {
                "bed": "clinical", "seating": "waiting", "furniture": "office",
                "equipment": "clinical", "fixture": "sanitary",
            }
            metrics.occupancy_class = class_map.get(dominant, "general")
        else:
            # All furnishings are zero-occ (storage/equipment only)
            density_occ = compute_occupancy(primary_function, area_m2, space_name)
            metrics.occupancy_class = density_occ["occupancy_class"]

        metrics.occupiable = metrics.normal_occupancy > 0
    else:
        # Fall back to density model
        density_occ = compute_occupancy(primary_function, area_m2, space_name)
        metrics.normal_occupancy = density_occ["normal_occupancy"]
        metrics.max_occupancy = density_occ["max_occupancy"]
        metrics.occupancy_class = density_occ["occupancy_class"]
        metrics.occupiable = density_occ["occupiable"]
        metrics.used_area_m2 = None
        metrics.free_area_m2 = None
        metrics.absolute_occupancy = 0
        metrics.furnishing_source = "density_model"

    metrics.area_m2 = area_m2
    metrics.floor_id = floor_id
    metrics.computed_at = now
    db.commit()


# ══════════════════════════════════════════════════════════════════════
# Furnishing types (catalog)
# ══════════════════════════════════════════════════════════════════════

@router.get("/furnishing-types", response_model=list[FurnishingTypeResponse])
def list_furnishing_types(db: Session = Depends(get_db)):
    """Return the full furnishing types catalog."""
    return db.query(FurnishingType).order_by(FurnishingType.category, FurnishingType.item_type).all()


@router.post("/furnishing-types/seed")
def seed_types(db: Session = Depends(get_db)):
    """Seed the furnishing_types table from the built-in catalog."""
    added = seed_furnishing_types(db)
    total = db.query(FurnishingType).count()
    return {"added": added, "total": total}


# ══════════════════════════════════════════════════════════════════════
# Space furnishings (per-polygon inventory)
# ══════════════════════════════════════════════════════════════════════

@router.get("/furnishings/{ifc_guid}", response_model=list[SpaceFurnishingResponse])
def get_space_furnishings(ifc_guid: str, db: Session = Depends(get_db)):
    """Get all furnishings for a polygon."""
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == ifc_guid
    ).all()
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    return [_enrich_furnishing(f, ft_map.get(f.item_type)) for f in furnishings]


@router.get("/furnishings/floor/{floor_id}", response_model=list[SpaceFurnishingResponse])
def get_floor_furnishings(floor_id: str, db: Session = Depends(get_db)):
    """Get all furnishings on a floor."""
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.floor_id == floor_id
    ).all()
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    return [_enrich_furnishing(f, ft_map.get(f.item_type)) for f in furnishings]


@router.post("/furnishings", response_model=SpaceFurnishingResponse)
def add_furnishing(req: SpaceFurnishingCreate, db: Session = Depends(get_db)):
    """Add a furnishing to a polygon."""
    # Validate item_type
    ft = db.query(FurnishingType).filter(FurnishingType.item_type == req.item_type).first()
    if not ft:
        raise HTTPException(status_code=400, detail=f"Unknown item_type: {req.item_type}")

    furnishing = SpaceFurnishing(
        ifc_guid=req.ifc_guid,
        floor_id=req.floor_id,
        item_type=req.item_type,
        quantity=req.quantity,
        item_label=req.item_label,
        notes=req.notes,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(furnishing)
    db.commit()
    db.refresh(furnishing)

    # Recompute metrics for this space
    _recompute_space_metrics(db, req.ifc_guid, req.floor_id)

    return _enrich_furnishing(furnishing, ft)


@router.put("/furnishings/{furnishing_id}", response_model=SpaceFurnishingResponse)
def update_furnishing(
    furnishing_id: int,
    req: SpaceFurnishingUpdate,
    db: Session = Depends(get_db),
):
    """Update a furnishing's quantity, label, or notes."""
    furnishing = db.query(SpaceFurnishing).filter(SpaceFurnishing.id == furnishing_id).first()
    if not furnishing:
        raise HTTPException(status_code=404, detail="Furnishing not found")

    if req.quantity is not None:
        furnishing.quantity = req.quantity
    if req.item_label is not None:
        furnishing.item_label = req.item_label
    if req.notes is not None:
        furnishing.notes = req.notes

    db.commit()
    db.refresh(furnishing)

    # Recompute metrics
    _recompute_space_metrics(db, furnishing.ifc_guid, furnishing.floor_id)

    ft = db.query(FurnishingType).filter(FurnishingType.item_type == furnishing.item_type).first()
    return _enrich_furnishing(furnishing, ft)


@router.delete("/furnishings/{furnishing_id}")
def delete_furnishing(furnishing_id: int, db: Session = Depends(get_db)):
    """Delete a furnishing and recompute space metrics."""
    furnishing = db.query(SpaceFurnishing).filter(SpaceFurnishing.id == furnishing_id).first()
    if not furnishing:
        raise HTTPException(status_code=404, detail="Furnishing not found")

    ifc_guid = furnishing.ifc_guid
    floor_id = furnishing.floor_id

    db.delete(furnishing)
    db.commit()

    # Recompute metrics (may fall back to density model if no furnishings remain)
    _recompute_space_metrics(db, ifc_guid, floor_id)

    return {"deleted": True, "id": furnishing_id}


# ══════════════════════════════════════════════════════════════════════
# Bulk seeding
# ══════════════════════════════════════════════════════════════════════

@router.post("/furnishings/seed")
def seed_all_furnishings(clear: bool = False, db: Session = Depends(get_db)):
    """Rule-based auto-populate: seed furnishings for all polygons based on
    their primary_function. Also recomputes all metrics.

    Query params:
        clear: if true, wipe all existing space_furnishings first (re-seed from scratch)
    """
    # Ensure types are seeded first
    seed_furnishing_types(db)

    if clear:
        deleted = db.query(SpaceFurnishing).delete()
        db.commit()
    else:
        deleted = 0

    # Build polygon list — polygons.json is the single source of truth
    polygons = _read_all()

    result = seed_space_furnishings(db, polygons)

    # Recompute metrics for all spaces
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    now = datetime.utcnow().isoformat()
    recomputed = 0

    for p in polygons:
        ifc_guid = p.get("ifc_guid")
        if not ifc_guid:
            continue

        floor_id = p.get("floor_id", "")
        area_m2 = p.get("area_m2") or 0
        primary_function = p.get("primary_function", "")
        space_name = p.get("space_name", "")

        furnishings = db.query(SpaceFurnishing).filter(
            SpaceFurnishing.ifc_guid == ifc_guid
        ).all()

        metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == ifc_guid).first()
        if not metrics:
            metrics = SpaceMetrics(ifc_guid=ifc_guid, floor_id=floor_id)
            db.add(metrics)

        density_occ = compute_occupancy(primary_function, area_m2, space_name)

        if furnishings:
            occ = compute_furnishing_occupancy(furnishings, ft_map, area_m2)
            metrics.normal_occupancy = occ["normal_occupancy"]
            metrics.max_occupancy = occ["max_occupancy"]
            metrics.absolute_occupancy = occ["absolute_occupancy"]
            metrics.used_area_m2 = occ["used_area_m2"]
            metrics.free_area_m2 = occ["free_area_m2"]
            metrics.furnishing_source = "furnishings"
            metrics.occupiable = occ["normal_occupancy"] > 0
            metrics.occupancy_class = density_occ["occupancy_class"]
        else:
            metrics.normal_occupancy = density_occ["normal_occupancy"]
            metrics.max_occupancy = density_occ["max_occupancy"]
            metrics.absolute_occupancy = 0
            metrics.occupancy_class = density_occ["occupancy_class"]
            metrics.occupiable = density_occ["occupiable"]
            metrics.used_area_m2 = None
            metrics.free_area_m2 = None
            metrics.furnishing_source = "density_model"

        metrics.area_m2 = area_m2
        metrics.floor_id = floor_id
        metrics.computed_at = now
        recomputed += 1

    db.commit()

    if clear:
        result["cleared_existing"] = deleted
    result["metrics_recomputed"] = recomputed
    return result

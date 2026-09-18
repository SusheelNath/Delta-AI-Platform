"""CRUD endpoints for furnishing types and space furnishings."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FurnishingType, SpaceFurnishing, SpaceMetrics
from app.services.intelligence_cache import rebuild_cache
from app.schemas import (
    FurnishingTypeResponse,
    SpaceFurnishingCreate,
    SpaceFurnishingUpdate,
    SpaceFurnishingResponse,
    FurnishingPreviewRequest,
    FurnishingPreviewResponse,
    BulkFurnishingRequest,
)
from app.services.furnishings import MAX_FURNISHING_PCT
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
# Preview & Bulk operations (must be before parameterized routes)
# ══════════════════════════════════════════════════════════════════════

@router.post("/furnishings/preview", response_model=FurnishingPreviewResponse)
def preview_furnishings(req: FurnishingPreviewRequest, db: Session = Depends(get_db)):
    """Compute metrics for a proposed furnishing list WITHOUT committing.

    Used by the live validation bar in the FurnishingEditor and by the AI
    action resolver to check feasibility before executing changes.
    """
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}

    # Validate all item types
    for item in req.furnishings:
        if item.item_type not in ft_map:
            raise HTTPException(status_code=400, detail=f"Unknown item_type: {item.item_type}")

    # Get polygon area
    polygons = _read_all()
    poly = next((p for p in polygons if p.get("ifc_guid") == req.ifc_guid), None)
    area_m2 = poly.get("area_m2", 0) if poly else 0

    # Build mock SpaceFurnishing objects for the occupancy calculator
    class _MockFurnishing:
        def __init__(self, item_type, quantity):
            self.item_type = item_type
            self.quantity = quantity

    mock_list = [_MockFurnishing(f.item_type, f.quantity) for f in req.furnishings if f.quantity > 0]

    occ = compute_furnishing_occupancy(mock_list, ft_map, area_m2)

    max_allowed = area_m2 * MAX_FURNISHING_PCT
    over = occ["used_area_m2"] > max_allowed
    used_pct = (occ["used_area_m2"] / area_m2 * 100) if area_m2 > 0 else 0

    message = None
    if over:
        excess = occ["used_area_m2"] - max_allowed
        message = (
            f"Exceeds {int(MAX_FURNISHING_PCT * 100)}% area limit by {excess:.1f} m². "
            f"Reduce furnishings by {excess:.1f} m² for fire and safety compliance."
        )

    return FurnishingPreviewResponse(
        area_m2=round(area_m2, 2),
        used_area_m2=occ["used_area_m2"],
        free_area_m2=occ["free_area_m2"],
        used_pct=round(used_pct, 1),
        normal_occupancy=occ["normal_occupancy"],
        max_occupancy=occ["max_occupancy"],
        absolute_occupancy=occ["absolute_occupancy"],
        over_capacity=over,
        max_allowed_m2=round(max_allowed, 2),
        message=message,
    )


@router.post("/furnishings/bulk")
def bulk_modify_furnishings(req: BulkFurnishingRequest, db: Session = Depends(get_db)):
    """Apply a batch of furnishing add/update/remove operations atomically.

    Each change: { action: "add"|"update"|"remove", item_type, quantity, furnishing_id }
    Returns the refreshed furnishing list + updated metrics.
    """
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    now = datetime.utcnow().isoformat()

    added = 0
    updated = 0
    removed = 0

    for change in req.changes:
        if change.action == "add":
            if not change.item_type or change.item_type not in ft_map:
                raise HTTPException(status_code=400, detail=f"Unknown item_type: {change.item_type}")
            qty = change.quantity or 1
            if qty <= 0:
                continue
            # Merge with existing row if same item_type already exists
            existing = db.query(SpaceFurnishing).filter(
                SpaceFurnishing.ifc_guid == req.ifc_guid,
                SpaceFurnishing.item_type == change.item_type,
            ).first()
            if existing:
                existing.quantity += qty
                updated += 1
            else:
                db.add(SpaceFurnishing(
                    ifc_guid=req.ifc_guid,
                    floor_id=req.floor_id,
                    item_type=change.item_type,
                    quantity=qty,
                    created_at=now,
                ))
                added += 1

        elif change.action == "update":
            if not change.furnishing_id:
                continue
            f = db.query(SpaceFurnishing).filter(SpaceFurnishing.id == change.furnishing_id).first()
            if f:
                if change.quantity is not None and change.quantity <= 0:
                    db.delete(f)
                    removed += 1
                elif change.quantity is not None:
                    f.quantity = change.quantity
                    updated += 1

        elif change.action == "remove":
            if change.furnishing_id:
                f = db.query(SpaceFurnishing).filter(SpaceFurnishing.id == change.furnishing_id).first()
                if f:
                    db.delete(f)
                    removed += 1
            elif change.item_type:
                rows = db.query(SpaceFurnishing).filter(
                    SpaceFurnishing.ifc_guid == req.ifc_guid,
                    SpaceFurnishing.item_type == change.item_type,
                ).all()
                if change.quantity is not None and change.quantity > 0:
                    # Partial removal: reduce quantity across matching rows
                    to_remove = change.quantity
                    for f in rows:
                        if to_remove <= 0:
                            break
                        if f.quantity <= to_remove:
                            to_remove -= f.quantity
                            db.delete(f)
                            removed += 1
                        else:
                            f.quantity -= to_remove
                            to_remove = 0
                            updated += 1
                else:
                    # No quantity specified: remove all of this item type
                    for f in rows:
                        db.delete(f)
                        removed += 1

        elif change.action == "remove_all":
            deleted_count = db.query(SpaceFurnishing).filter(
                SpaceFurnishing.ifc_guid == req.ifc_guid,
            ).delete()
            removed += deleted_count

    db.commit()

    # Recompute metrics + rebuild cache
    _recompute_space_metrics(db, req.ifc_guid, req.floor_id)
    rebuild_cache(db)

    # Return refreshed furnishing list + metrics
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == req.ifc_guid
    ).all()
    metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == req.ifc_guid).first()

    return {
        "added": added,
        "updated": updated,
        "removed": removed,
        "furnishings": [_enrich_furnishing(f, ft_map.get(f.item_type)) for f in furnishings],
        "metrics": {
            "area_m2": metrics.area_m2 if metrics else 0,
            "used_area_m2": metrics.used_area_m2 if metrics else None,
            "free_area_m2": metrics.free_area_m2 if metrics else None,
            "normal_occupancy": metrics.normal_occupancy if metrics else 0,
            "max_occupancy": metrics.max_occupancy if metrics else 0,
            "absolute_occupancy": metrics.absolute_occupancy if metrics else 0,
            "furnishing_source": metrics.furnishing_source if metrics else None,
        } if metrics else None,
    }


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
    rebuild_cache(db)

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
    rebuild_cache(db)

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
    rebuild_cache(db)

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

    # Build polygon list - polygons.json is the single source of truth
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
    rebuild_cache(db)

    if clear:
        result["cleared_existing"] = deleted
    result["metrics_recomputed"] = recomputed
    return result

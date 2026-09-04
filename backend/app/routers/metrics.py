"""Batch metrics computation for space_metrics table."""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SpaceMetrics, SpaceFurnishing, FurnishingType
from app.schemas import SpaceMetricsResponse
from app.services.occupancy import compute_occupancy
from app.services.furnishings import compute_furnishing_occupancy
from app.routers.polygons import _read_all

router = APIRouter(tags=["metrics"])


@router.post("/metrics/recompute", response_model=dict)
def recompute_all_metrics(db: Session = Depends(get_db)):
    """Iterate all polygons, compute occupancy from furnishings (if present)
    or density model (fallback), and upsert into space_metrics table.

    Returns summary stats by floor and occupancy class."""
    polygons = _read_all()
    now = datetime.utcnow().isoformat()

    # Pre-load furnishing data
    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    all_furnishings = db.query(SpaceFurnishing).all()
    furnishings_by_guid = {}
    for f in all_furnishings:
        furnishings_by_guid.setdefault(f.ifc_guid, []).append(f)

    processed = 0
    by_floor = {}
    by_class = {}

    for p in polygons:
        ifc_guid = p.get("ifc_guid")
        if not ifc_guid:
            continue

        floor_id = p.get("floor_id", "")
        area_m2 = p.get("area_m2") or 0
        perimeter_cm = p.get("perimeter_cm")
        perimeter_m = round(perimeter_cm / 100, 2) if perimeter_cm is not None else None
        primary_function = p.get("primary_function")
        space_name = p.get("space_name")

        space_furnishings = furnishings_by_guid.get(ifc_guid, [])

        if space_furnishings:
            occ = compute_furnishing_occupancy(space_furnishings, ft_map, area_m2)
            source = "furnishings"
            # Determine class from density model for consistency
            density_occ = compute_occupancy(primary_function, area_m2, space_name)
            occ_class = density_occ["occupancy_class"]

            # These space types have furnishings that are equipment/fixtures
            # (panels, countertops, autoclaves, shelving) and don't reflect
            # actual foot traffic.  Use density model values instead.
            if occ_class in ("elevator", "commercial", "changing",
                             "sterilization", "morgue", "emergency",
                             "radiotherapy", "assembly", "sanitary",
                             "ambulance", "storage"):
                occ["normal_occupancy"] = density_occ["normal_occupancy"]
                occ["max_occupancy"] = density_occ["max_occupancy"]
                occ["absolute_occupancy"] = density_occ["max_occupancy"]
            elif occ_class == "facilities":
                occ["normal_occupancy"] = max(occ["normal_occupancy"],
                                              density_occ["normal_occupancy"])
                occ["max_occupancy"] = max(occ["max_occupancy"],
                                           density_occ["max_occupancy"])
            elif occ_class == "zero":
                occ["normal_occupancy"] = 0
                occ["max_occupancy"] = 0
                occ["absolute_occupancy"] = 0

            occupiable = occ["normal_occupancy"] > 0
        else:
            density_occ = compute_occupancy(primary_function, area_m2, space_name)
            occ = {
                "normal_occupancy": density_occ["normal_occupancy"],
                "max_occupancy": density_occ["max_occupancy"],
                "absolute_occupancy": 0,
                "used_area_m2": None,
                "free_area_m2": None,
            }
            occ_class = density_occ["occupancy_class"]
            occupiable = density_occ["occupiable"]
            source = "density_model"

        # Upsert
        metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == ifc_guid).first()
        if metrics:
            metrics.floor_id = floor_id
            metrics.area_m2 = area_m2
            metrics.perimeter_m = perimeter_m
            metrics.normal_occupancy = occ["normal_occupancy"]
            metrics.max_occupancy = occ["max_occupancy"]
            metrics.absolute_occupancy = occ["absolute_occupancy"]
            metrics.occupancy_class = occ_class
            metrics.occupiable = occupiable
            metrics.used_area_m2 = occ["used_area_m2"]
            metrics.free_area_m2 = occ["free_area_m2"]
            metrics.furnishing_source = source
            metrics.computed_at = now
        else:
            metrics = SpaceMetrics(
                ifc_guid=ifc_guid,
                floor_id=floor_id,
                area_m2=area_m2,
                perimeter_m=perimeter_m,
                normal_occupancy=occ["normal_occupancy"],
                max_occupancy=occ["max_occupancy"],
                absolute_occupancy=occ["absolute_occupancy"],
                occupancy_class=occ_class,
                occupiable=occupiable,
                used_area_m2=occ["used_area_m2"],
                free_area_m2=occ["free_area_m2"],
                furnishing_source=source,
                computed_at=now,
            )
            db.add(metrics)

        processed += 1

        # Stats
        if floor_id not in by_floor:
            by_floor[floor_id] = {
                "spaces": 0, "total_area_m2": 0,
                "normal_occupancy": 0, "max_occupancy": 0,
                "absolute_occupancy": 0, "furnished": 0,
            }
        by_floor[floor_id]["spaces"] += 1
        by_floor[floor_id]["total_area_m2"] += area_m2 or 0
        by_floor[floor_id]["normal_occupancy"] += occ["normal_occupancy"]
        by_floor[floor_id]["max_occupancy"] += occ["max_occupancy"]
        by_floor[floor_id]["absolute_occupancy"] += occ["absolute_occupancy"]
        if source == "furnishings":
            by_floor[floor_id]["furnished"] += 1

        cls = occ_class
        if cls not in by_class:
            by_class[cls] = {"count": 0, "normal_occupancy": 0, "max_occupancy": 0}
        by_class[cls]["count"] += 1
        by_class[cls]["normal_occupancy"] += occ["normal_occupancy"]
        by_class[cls]["max_occupancy"] += occ["max_occupancy"]

    db.commit()

    # Round floor areas
    for f in by_floor.values():
        f["total_area_m2"] = round(f["total_area_m2"], 1)

    total_normal = sum(f["normal_occupancy"] for f in by_floor.values())
    total_max = sum(f["max_occupancy"] for f in by_floor.values())
    total_absolute = sum(f["absolute_occupancy"] for f in by_floor.values())

    return {
        "processed": processed,
        "total_normal_occupancy": total_normal,
        "total_max_occupancy": total_max,
        "total_absolute_occupancy": total_absolute,
        "by_floor": by_floor,
        "by_class": by_class,
    }


@router.get("/metrics", response_model=list[SpaceMetricsResponse])
def list_all_metrics(db: Session = Depends(get_db)):
    """Return all space metrics."""
    return db.query(SpaceMetrics).all()


@router.get("/metrics/floor/{floor_id}", response_model=list[SpaceMetricsResponse])
def list_floor_metrics(floor_id: str, db: Session = Depends(get_db)):
    """Return space metrics for a specific floor."""
    return db.query(SpaceMetrics).filter(SpaceMetrics.floor_id == floor_id).all()


@router.get("/metrics/summary")
def metrics_summary(db: Session = Depends(get_db)):
    """Return aggregate occupancy summary by floor."""
    all_metrics = db.query(SpaceMetrics).all()
    by_floor = {}
    for m in all_metrics:
        if m.floor_id not in by_floor:
            by_floor[m.floor_id] = {
                "spaces": 0,
                "occupiable_spaces": 0,
                "furnished_spaces": 0,
                "total_area_m2": 0,
                "total_used_area_m2": 0,
                "total_normal_occupancy": 0,
                "total_max_occupancy": 0,
                "total_absolute_occupancy": 0,
            }
        f = by_floor[m.floor_id]
        f["spaces"] += 1
        if m.occupiable:
            f["occupiable_spaces"] += 1
        if m.furnishing_source == "furnishings":
            f["furnished_spaces"] += 1
        f["total_area_m2"] += m.area_m2 or 0
        f["total_used_area_m2"] += m.used_area_m2 or 0
        f["total_normal_occupancy"] += m.normal_occupancy
        f["total_max_occupancy"] += m.max_occupancy
        f["total_absolute_occupancy"] += m.absolute_occupancy or 0

    for f in by_floor.values():
        f["total_area_m2"] = round(f["total_area_m2"], 1)
        f["total_used_area_m2"] = round(f["total_used_area_m2"], 1)

    return {
        "total_spaces": len(all_metrics),
        "total_normal_occupancy": sum(f["total_normal_occupancy"] for f in by_floor.values()),
        "total_max_occupancy": sum(f["total_max_occupancy"] for f in by_floor.values()),
        "total_absolute_occupancy": sum(f["total_absolute_occupancy"] for f in by_floor.values()),
        "by_floor": by_floor,
    }

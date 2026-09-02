"""
Unified Polygon Intelligence: computes full space metadata from polygon data alone.

Combines:
  - Function Classifier (primary_function → metadata properties)
  - Geometry Engine (vertices → spatial relationships)
  - Furnishing/Metrics data (from space_metrics + space_furnishings tables)

Single entry point: compute_space_intelligence(polygon, floor_polygons, db)
Returns a flat dict with all fields that SpaceDetail / the AI layer needs.
"""

import json
import re
from collections import defaultdict
from pathlib import Path
from functools import lru_cache

from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.models import SpaceMetrics, SpaceFurnishing, FurnishingType
from app.services.classifier import classify_function
from app.services.geometry import (
    compute_floor_spatial,
    compute_space_spatial,
    centroid,
)

POLYGONS_FILE = DATA_DIR / "polygons.json"

FLOOR_NAMES = {
    "H003": "Basement 3", "H002": "Basement 2", "H001": "Basement 1",
    "H000": "Ground Floor", "H010": "Floor 1", "H020": "Floor 2",
    "H030": "Floor 3", "H040": "Floor 4", "H050": "Floor 5",
}


# ══════════════════════════════════════════════════════════════════════
# Polygon I/O
# ══════════════════════════════════════════════════════════════════════

def read_all_polygons() -> list[dict]:
    """Read all polygons from the JSON file."""
    if not POLYGONS_FILE.exists():
        return []
    with open(POLYGONS_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    if not content.strip():
        return []
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        cleaned = re.sub(r',\s*([}\]])', r'\1', content)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            decoder = json.JSONDecoder()
            result, _ = decoder.raw_decode(cleaned.lstrip())
            return result if isinstance(result, list) else []


def write_all_polygons(polygons: list[dict]):
    """Write all polygons to the JSON file (and backup)."""
    BACKUP_FILE = Path.home() / "Documents" / "delta-polygons-backup" / "polygons.json"
    for target in (POLYGONS_FILE, BACKUP_FILE):
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(polygons, f, indent=2)
        tmp.replace(target)


def get_floor_polygons(floor_id: str, polygons: list[dict] | None = None) -> list[dict]:
    """Get all polygons for a floor."""
    if polygons is None:
        polygons = read_all_polygons()
    return [p for p in polygons if p.get("floor_id", "").upper() == floor_id.upper()]


# ══════════════════════════════════════════════════════════════════════
# Furnishing helpers
# ══════════════════════════════════════════════════════════════════════

def _get_facilities_from_furnishings(ifc_guid: str, db: Session) -> str | None:
    """Derive facilities list from furnishing inventory."""
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == ifc_guid
    ).all()
    if not furnishings:
        return None

    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    labels = []
    for f in furnishings:
        ft = ft_map.get(f.item_type)
        if ft:
            labels.append(ft.label)
    return ", ".join(sorted(set(labels))) if labels else None


def _get_patient_capacity(ifc_guid: str, db: Session) -> int:
    """Count bed-type furnishings as patient capacity."""
    furnishings = db.query(SpaceFurnishing).filter(
        SpaceFurnishing.ifc_guid == ifc_guid
    ).all()

    ft_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}
    beds = 0
    for f in furnishings:
        ft = ft_map.get(f.item_type)
        if ft and ft.category == "bed" and ft.normal_occ > 0:
            beds += f.quantity * ft.normal_occ
    return beds


# ══════════════════════════════════════════════════════════════════════
# Main intelligence computation
# ══════════════════════════════════════════════════════════════════════

def compute_space_intelligence(
    polygon: dict,
    floor_polygons: list[dict],
    db: Session,
    floor_spatial: dict | None = None,
) -> dict:
    """Compute full metadata for a single polygon.

    Args:
        polygon: the target polygon dict from polygons.json
        floor_polygons: all polygons on the same floor
        db: database session (for metrics/furnishings lookup)
        floor_spatial: pre-computed floor spatial data (optional, computed if None)

    Returns a flat dict with all fields needed by SpaceDetail, the AI layer, etc.
    """
    ifc_guid = polygon.get("ifc_guid", "")
    floor_id = polygon.get("floor_id", "")
    primary_function = polygon.get("primary_function") or ""
    area_m2 = polygon.get("area_m2")
    perimeter_cm = polygon.get("perimeter_cm")
    space_name = polygon.get("space_name") or ""

    # ── Layer 1: Function classifier (tries primary_function, falls back to space_name) ──
    metadata = classify_function(primary_function, space_name)

    # ── Layer 2: Geometry engine ──
    if floor_spatial is None:
        floor_spatial = compute_floor_spatial(floor_polygons)

    polygon_map = {p["ifc_guid"]: p for p in floor_polygons if p.get("ifc_guid")}
    spatial = compute_space_spatial(ifc_guid, floor_spatial, polygon_map)

    # ── Layer 3: Metrics and furnishings (from DB, derived from polygon data) ──
    metrics = db.query(SpaceMetrics).filter(SpaceMetrics.ifc_guid == ifc_guid).first()

    facilities = _get_facilities_from_furnishings(ifc_guid, db)
    patient_capacity = _get_patient_capacity(ifc_guid, db)

    # ── Assemble the full intelligence dict ──
    result = {
        # Identity (from polygon)
        "ifc_guid": ifc_guid,
        "id": ifc_guid,  # use guid as ID in polygon-first world
        "floor_id": floor_id,
        "floor_name": FLOOR_NAMES.get(floor_id, floor_id),
        "space_name": space_name,
        "primary_function": primary_function,

        # Physical (from polygon)
        "area_m2": area_m2,
        "perimeter_cm": perimeter_cm,

        # Classified metadata (from function classifier)
        "functional_zone": metadata["functional_zone"],
        "space_class": metadata["space_class"],
        "accessible": metadata["accessible"],
        "bookable": metadata["bookable"],
        "access_level": metadata["access_level"],
        "privacy_level": metadata["privacy_level"],
        "noise_sensitivity": metadata["noise_sensitivity"],
        "visitor_access": metadata["visitor_access"],
        "flexibility": metadata["flexibility"],
        "convertible_functions": metadata["convertible_functions"],
        "secondary_functions": metadata["secondary_functions"],

        # Occupancy (from metrics — derived from furnishings/density model)
        "normal_occupancy": metrics.normal_occupancy if metrics else 0,
        "max_occupancy": metrics.max_occupancy if metrics else 0,
        "absolute_occupancy": metrics.absolute_occupancy if metrics else 0,
        "occupancy_class": metrics.occupancy_class if metrics else None,
        "occupiable": metrics.occupiable if metrics else False,
        "used_area_m2": metrics.used_area_m2 if metrics else None,
        "free_area_m2": metrics.free_area_m2 if metrics else None,
        "furnishing_source": metrics.furnishing_source if metrics else None,
        "patient_capacity": patient_capacity if patient_capacity > 0 else None,

        # Spatial (from geometry engine)
        "nearest_lift": spatial["nearest_lift"],
        "lift_distance_m": spatial["lift_distance_m"],
        "nearest_stair": spatial["nearest_stair"],
        "stair_distance_m": spatial["stair_distance_m"],
        "step_free_access": spatial["step_free_access"],
        "adjacent_spaces": spatial["adjacent_spaces"],

        # Facilities (from furnishing inventory)
        "facilities_available": facilities,

        # Data status (computed)
        "data_status": "complete" if (primary_function and area_m2) else "partial",
    }

    return result


def compute_floor_intelligence(
    floor_id: str,
    db: Session,
    polygons: list[dict] | None = None,
) -> list[dict]:
    """Compute intelligence for all polygons on a floor.

    Returns a list of intelligence dicts, one per polygon.
    """
    if polygons is None:
        polygons = read_all_polygons()

    floor_polygons = get_floor_polygons(floor_id, polygons)
    if not floor_polygons:
        return []

    # Pre-compute floor spatial data once (shared across all spaces)
    floor_spatial = compute_floor_spatial(floor_polygons)

    results = []
    for poly in floor_polygons:
        intel = compute_space_intelligence(poly, floor_polygons, db, floor_spatial)
        results.append(intel)

    return results


def search_polygons(
    polygons: list[dict] | None = None,
    q: str | None = None,
    floor_id: str | None = None,
    primary_function: str | None = None,
    min_area: float | None = None,
    max_area: float | None = None,
    limit: int = 100,
) -> list[dict]:
    """Search polygons by text, floor, function, area — no DB needed.

    Returns matching polygon dicts (raw, not intelligence-enriched).
    """
    if polygons is None:
        polygons = read_all_polygons()

    results = []
    for p in polygons:
        if floor_id and p.get("floor_id", "").upper() != floor_id.upper():
            continue

        if primary_function:
            pf = (p.get("primary_function") or "").lower()
            if primary_function.lower() not in pf:
                continue

        area = p.get("area_m2") or 0
        if min_area is not None and area < min_area:
            continue
        if max_area is not None and area > max_area:
            continue

        if q:
            q_lower = q.lower()
            name = (p.get("space_name") or "").lower()
            func = (p.get("primary_function") or "").lower()
            guid = (p.get("ifc_guid") or "").lower()
            if not (q_lower in name or q_lower in func or q_lower in guid):
                continue

        results.append(p)
        if len(results) >= limit:
            break

    return results

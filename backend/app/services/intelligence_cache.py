"""
Pre-computed intelligence cache for Delta AI.

Builds the full space intelligence index on startup (~2s) so every chat
request can search, score, and resolve spaces from in-memory dicts (~5ms)
instead of recomputing 14,500 DB queries per request.

Invalidated by calling rebuild_cache(db) after polygon / furnishing / metric
mutations — these are rare admin actions, so a full rebuild is fine.
"""

import logging
from collections import defaultdict

from sqlalchemy.orm import Session

from app.models import SpaceMetrics, SpaceFurnishing, FurnishingType
from app.services.polygon_intelligence import (
    read_all_polygons,
    FLOOR_NAMES,
)
from app.services.classifier import classify_function
from app.services.geometry import compute_floor_spatial, compute_space_spatial

log = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════
# Module-level cache state
# ══════════════════════════════════════════════════════════════════════

_polygons: list[dict] = []
_polygon_map: dict[str, dict] = {}
_floor_groups: dict[str, list[dict]] = {}

_furnishing_type_map: dict = {}       # {item_type: FurnishingType row}
_metrics_map: dict = {}               # {ifc_guid: SpaceMetrics row}
_furnishings_map: dict = {}           # {ifc_guid: [SpaceFurnishing rows]}

_floor_spatials: dict[str, dict] = {}
_intelligence: dict[str, dict] = {}
_search_blobs: dict[str, str] = {}
_floor_summaries: str = ""
_ready: bool = False


# ══════════════════════════════════════════════════════════════════════
# Cache builder
# ══════════════════════════════════════════════════════════════════════

def build_cache(db: Session) -> None:
    """Build the full intelligence cache from disk + DB. ~2s for 2,900 spaces."""
    global _polygons, _polygon_map, _floor_groups
    global _furnishing_type_map, _metrics_map, _furnishings_map
    global _floor_spatials, _intelligence, _search_blobs
    global _floor_summaries, _ready

    _ready = False
    log.info("Building intelligence cache...")

    # ── Step 1: Polygons from disk (single read) ──
    _polygons = read_all_polygons()
    _polygon_map = {p["ifc_guid"]: p for p in _polygons if p.get("ifc_guid")}

    _floor_groups = defaultdict(list)
    for p in _polygons:
        _floor_groups[p.get("floor_id", "")].append(p)

    # ── Step 2: Batch DB loads (3 queries total) ──
    _furnishing_type_map = {ft.item_type: ft for ft in db.query(FurnishingType).all()}

    _metrics_map = {m.ifc_guid: m for m in db.query(SpaceMetrics).all()}

    _furnishings_map = defaultdict(list)
    for f in db.query(SpaceFurnishing).all():
        _furnishings_map[f.ifc_guid].append(f)

    # ── Step 3: Floor spatial (geometry engine) ──
    _floor_spatials = {}
    for fid, fps in _floor_groups.items():
        _floor_spatials[fid] = compute_floor_spatial(fps)

    # ── Step 4: Space intelligence ──
    _intelligence = {}
    _search_blobs = {}

    for p in _polygons:
        ifc_guid = p.get("ifc_guid", "")
        if not ifc_guid:
            continue

        fid = p.get("floor_id", "")
        floor_polys = _floor_groups.get(fid, [])
        floor_spatial = _floor_spatials.get(fid)

        intel = _compute_intelligence_from_cache(p, floor_polys, floor_spatial, ifc_guid)
        _intelligence[ifc_guid] = intel
        _search_blobs[ifc_guid] = _build_search_blob(intel)

    # ── Step 5: Floor summaries ──
    _floor_summaries = _build_floor_summaries_from_cache()

    _ready = True
    log.info(
        "Intelligence cache ready: %d spaces, %d floors, %d furnishing types",
        len(_intelligence), len(_floor_groups), len(_furnishing_type_map),
    )


def rebuild_cache(db: Session) -> None:
    """Full cache rebuild. Called after polygon/furnishing/metric changes."""
    build_cache(db)


# ══════════════════════════════════════════════════════════════════════
# Internal computation (replaces per-polygon DB queries)
# ══════════════════════════════════════════════════════════════════════

def _compute_intelligence_from_cache(
    polygon: dict,
    floor_polygons: list[dict],
    floor_spatial: dict,
    ifc_guid: str,
) -> dict:
    """Produce an intelligence dict identical to compute_space_intelligence(),
    using cached lookup dicts instead of DB queries."""

    primary_function = polygon.get("primary_function") or ""
    space_name = polygon.get("space_name") or ""
    floor_id = polygon.get("floor_id", "")
    area_m2 = polygon.get("area_m2")
    perimeter_cm = polygon.get("perimeter_cm")

    # Layer 1: classifier (pure function, no DB)
    metadata = classify_function(primary_function, space_name)

    # Layer 2: geometry (uses pre-computed floor_spatial)
    polygon_map = {p["ifc_guid"]: p for p in floor_polygons if p.get("ifc_guid")}
    spatial = compute_space_spatial(ifc_guid, floor_spatial, polygon_map)

    # Layer 3: metrics from cache
    metrics = _metrics_map.get(ifc_guid)

    # Layer 3b: facilities from cache
    facilities = _get_facilities_cached(ifc_guid)

    # Layer 3c: patient capacity from cache
    patient_capacity = _get_patient_capacity_cached(ifc_guid)

    # Assemble — IDENTICAL structure to compute_space_intelligence()
    return {
        # Identity (from polygon)
        "ifc_guid": ifc_guid,
        "id": ifc_guid,
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

        # Occupancy (from metrics)
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


def _get_facilities_cached(ifc_guid: str) -> str | None:
    """Same logic as _get_facilities_from_furnishings but reads from cached dicts."""
    furnishings = _furnishings_map.get(ifc_guid)
    if not furnishings:
        return None

    counts = defaultdict(int)
    for f in furnishings:
        ft = _furnishing_type_map.get(f.item_type)
        if ft:
            counts[ft.label] += f.quantity
    if not counts:
        return None

    parts = []
    for label in sorted(counts):
        qty = counts[label]
        parts.append(f"{qty}x {label}" if qty > 1 else label)
    return ", ".join(parts)


def _get_patient_capacity_cached(ifc_guid: str) -> int:
    """Same logic as _get_patient_capacity but reads from cached dicts."""
    furnishings = _furnishings_map.get(ifc_guid)
    if not furnishings:
        return 0

    beds = 0
    for f in furnishings:
        ft = _furnishing_type_map.get(f.item_type)
        if ft and ft.category == "bed" and ft.normal_occ > 0:
            beds += f.quantity * ft.normal_occ
    return beds


# ══════════════════════════════════════════════════════════════════════
# Search blob + floor summaries builders
# ══════════════════════════════════════════════════════════════════════

def _build_search_blob(intel: dict) -> str:
    """Build the exact same searchable text blob that _auto_search uses."""
    parts = [
        intel.get("space_name") or "",
        intel.get("primary_function") or "",
        intel.get("functional_zone") or "",
        intel.get("space_class") or "",
        intel.get("secondary_functions") or "",
        intel.get("access_level") or "",
        intel.get("privacy_level") or "",
        intel.get("visitor_access") or "",
        intel.get("noise_sensitivity") or "",
        intel.get("flexibility") or "",
        intel.get("convertible_functions") or "",
        intel.get("occupancy_class") or "",
        intel.get("facilities_available") or "",
        intel.get("nearest_lift") or "",
        intel.get("nearest_stair") or "",
        intel.get("adjacent_spaces") or "",
        "bookable" if intel.get("bookable") == "Yes" else "",
        "accessible" if intel.get("accessible") and intel["accessible"] != "No" else "",
        "occupiable" if intel.get("occupiable") else "",
    ]
    return " ".join(parts).lower()


def _build_floor_summaries_from_cache() -> str:
    """Same logic as _build_floor_summaries in chat.py, reads from cached polygons."""
    if not _polygons:
        return ""

    floors = defaultdict(lambda: {"count": 0, "area": 0.0, "funcs": defaultdict(lambda: {"n": 0, "a": 0.0})})

    for p in _polygons:
        fid = p.get("floor_id", "?")
        area = p.get("area_m2") or 0
        fn = p.get("primary_function") or "Unknown"
        floors[fid]["count"] += 1
        floors[fid]["area"] += area
        floors[fid]["funcs"][fn]["n"] += 1
        floors[fid]["funcs"][fn]["a"] += area

    total_spaces = sum(f["count"] for f in floors.values())
    total_area = sum(f["area"] for f in floors.values())

    lines = [f"\n[Hospital spatial summary \u2014 {total_spaces} mapped spaces, {total_area:.0f} m\u00b2 across {len(floors)} floors]"]
    for fid in sorted(floors.keys()):
        fd = floors[fid]
        fname = FLOOR_NAMES.get(fid, fid)
        lines.append(f"\n{fname} ({fid}): {fd['count']} spaces, {fd['area']:.0f} m\u00b2")
        ranked = sorted(fd["funcs"].items(), key=lambda x: -x[1]["a"])[:6]
        for fn, data in ranked:
            pct = (data["a"] / fd["area"] * 100) if fd["area"] > 0 else 0
            lines.append(f"  {fn}: {data['n']} spaces, {data['a']:.0f} m\u00b2 ({pct:.0f}%)")

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════
# Public query API
# ══════════════════════════════════════════════════════════════════════

def get_cached_intelligence(ifc_guid: str) -> dict | None:
    """Look up a single space's intelligence dict. O(1)."""
    return _intelligence.get(ifc_guid)


def get_all_intelligence() -> dict[str, dict]:
    """Return the full intelligence dict."""
    return _intelligence


def get_search_blobs() -> dict[str, str]:
    """Return the full search blob dict."""
    return _search_blobs


def get_floor_summaries() -> str:
    """Return the pre-built floor summaries string."""
    return _floor_summaries


def get_floor_group_summary(floor_id: str) -> list[dict]:
    """Return function group breakdown for a floor.

    Each entry: {function, count, total_area, max_occupancy}.
    Sorted by count descending. Used by Tier 1 action context.
    """
    groups: dict[str, dict] = {}
    for guid, intel in _intelligence.items():
        if intel.get("floor_id") != floor_id:
            continue
        fn = intel.get("primary_function") or "Unassigned"
        if fn not in groups:
            groups[fn] = {"function": fn, "count": 0, "total_area": 0.0, "max_occupancy": 0}
        g = groups[fn]
        g["count"] += 1
        g["total_area"] += intel.get("area_m2") or 0
        g["max_occupancy"] += intel.get("max_occupancy") or 0
    result = sorted(groups.values(), key=lambda x: -x["count"])
    return result


def get_cached_polygons() -> list[dict]:
    """Return the cached polygon list."""
    return _polygons


def get_floor_spatial(floor_id: str) -> dict | None:
    """Return pre-computed floor spatial data."""
    return _floor_spatials.get(floor_id)


def _bigram_similarity(a: str, b: str) -> float:
    """Sørensen–Dice coefficient on character bigrams. Used for typo tolerance."""
    if len(a) < 2 or len(b) < 2:
        return 1.0 if a == b else 0.0
    a_bi = {a[i:i+2] for i in range(len(a) - 1)}
    b_bi = {b[i:i+2] for i in range(len(b) - 1)}
    overlap = len(a_bi & b_bi)
    return 2.0 * overlap / (len(a_bi) + len(b_bi))


_FUZZY_THRESHOLD = 0.5


def get_rooms_by_function(floor_id: str, function_name: str) -> list[dict]:
    """Return intelligence dicts for rooms matching a function on a floor.

    Three-pass matching: exact → substring → fuzzy (typo-tolerant).
    Returns rooms sorted by space_name for stable ordering (matches
    the frontend RoomDirectory sort).
    """
    fn_lower = function_name.lower()

    # Collect all rooms on this floor, grouped by primary_function
    pf_groups: dict[str, list[dict]] = defaultdict(list)
    for guid, intel in _intelligence.items():
        if intel.get("floor_id") != floor_id:
            continue
        pf = (intel.get("primary_function") or "").lower()
        pf_groups[pf].append(intel)

    if not pf_groups:
        return []

    def _sort(lst: list[dict]) -> list[dict]:
        lst.sort(key=lambda d: (d.get("space_name") or "", d.get("ifc_guid") or ""))
        return lst

    # Pass 1: exact match on primary_function
    if fn_lower in pf_groups:
        return _sort(list(pf_groups[fn_lower]))

    # Pass 2: substring match
    substring: list[dict] = []
    for pf, rooms in pf_groups.items():
        if fn_lower in pf or pf in fn_lower:
            substring.extend(rooms)
    if substring:
        return _sort(substring)

    # Pass 3: fuzzy match (typo tolerance via bigram similarity)
    best_score = 0.0
    best_pf = None
    for pf in pf_groups:
        score = _bigram_similarity(fn_lower, pf)
        if score > best_score:
            best_score = score
            best_pf = pf

    if best_score >= _FUZZY_THRESHOLD and best_pf is not None:
        return _sort(list(pf_groups[best_pf]))

    return []


def is_ready() -> bool:
    """Check if cache has been built."""
    return _ready

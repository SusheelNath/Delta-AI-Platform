"""
Geometry Engine: computes spatial relationships between polygons.

All computations derive from polygon vertices and primary_function.
No DB lookups — pure geometry.

Provides:
- centroid(vertices) — centre point of a polygon
- bbox(vertices) — axis-aligned bounding box
- bbox_gap(b1, b2) — distance between two bounding boxes
- compute_floor_spatial(polygons) — all spatial relationships for a floor
- compute_space_spatial(polygon, floor_data) — spatial data for one space
"""

import math
from collections import defaultdict

# Infrastructure keywords for identifying lifts, stairs, corridors
LIFT_KEYWORDS = ["elevator", "lift"]
STAIR_KEYWORDS = ["staircase", "stairway", "stair"]
CORRIDOR_KEYWORDS = ["corridor", "circulation", "hallway", "lobby", "transition"]

ADJACENCY_THRESHOLD = 2.0  # max bbox gap in percentage units (matching frontend routing.js)


# ══════════════════════════════════════════════════════════════════════
# Core geometry functions
# ══════════════════════════════════════════════════════════════════════

def centroid(vertices: list[list[float]]) -> tuple[float, float]:
    """Compute the centroid of a polygon from its vertices."""
    if not vertices:
        return (0.0, 0.0)
    cx = sum(v[0] for v in vertices) / len(vertices)
    cy = sum(v[1] for v in vertices) / len(vertices)
    return (cx, cy)


def bbox(vertices: list[list[float]]) -> dict:
    """Compute axis-aligned bounding box of a polygon."""
    if not vertices:
        return {"minX": 0, "minY": 0, "maxX": 0, "maxY": 0}
    xs = [v[0] for v in vertices]
    ys = [v[1] for v in vertices]
    return {
        "minX": min(xs), "minY": min(ys),
        "maxX": max(xs), "maxY": max(ys),
    }


def bbox_gap(b1: dict, b2: dict) -> float:
    """Compute the gap between two bounding boxes. Returns 0 if they overlap."""
    gap_x = max(0, b1["minX"] - b2["maxX"], b2["minX"] - b1["maxX"])
    gap_y = max(0, b1["minY"] - b2["maxY"], b2["minY"] - b1["maxY"])
    return math.sqrt(gap_x * gap_x + gap_y * gap_y)


def euclidean_distance(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Euclidean distance between two points."""
    dx = p1[0] - p2[0]
    dy = p1[1] - p2[1]
    return math.sqrt(dx * dx + dy * dy)


def polygon_area_pct(vertices: list[list[float]]) -> float:
    """Compute polygon area in percentage-coordinate space (Shoelace formula)."""
    n = len(vertices)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += vertices[i][0] * vertices[j][1]
        area -= vertices[j][0] * vertices[i][1]
    return abs(area) / 2


def compute_scale_factor(polygons: list[dict]) -> float:
    """Derive metres-per-percentage-unit from polygons with known area_m2.

    Uses median scale factor across all qualifying polygons for robustness.
    """
    factors = []
    for p in polygons:
        area_m2 = p.get("area_m2") or 0
        verts = p.get("vertices") or []
        if area_m2 > 0 and len(verts) >= 3:
            area_pct = polygon_area_pct(verts)
            if area_pct > 0:
                factors.append(math.sqrt(area_m2 / area_pct))
    if not factors:
        return 1.0
    factors.sort()
    mid = len(factors) // 2
    return factors[mid] if len(factors) % 2 else (factors[mid - 1] + factors[mid]) / 2


def _matches_keywords(fn: str, keywords: list[str]) -> bool:
    """Check if a function string contains any of the keywords."""
    fn_lower = fn.lower()
    return any(kw in fn_lower for kw in keywords)


# ══════════════════════════════════════════════════════════════════════
# Floor-level spatial computation
# ══════════════════════════════════════════════════════════════════════

def compute_floor_spatial(polygons: list[dict]) -> dict:
    """Pre-compute spatial data for an entire floor of polygons.

    Returns a dict with:
        centroids: {ifc_guid: (cx, cy)}
        bboxes: {ifc_guid: bbox_dict}
        adjacency: {ifc_guid: [neighbor_guids]}
        lifts: [{ifc_guid, centroid, space_name, primary_function}]
        stairs: [{ifc_guid, centroid, space_name, primary_function}]
        corridors: [{ifc_guid, centroid}]
        scale_factor: float (metres per percentage unit)
        has_lift: bool
        has_stair: bool
    """
    valid = [p for p in polygons
             if p.get("ifc_guid") and p.get("vertices") and len(p["vertices"]) >= 3]

    centroids = {}
    bboxes = {}
    lifts = []
    stairs = []
    corridors = []

    for p in valid:
        guid = p["ifc_guid"]
        verts = p["vertices"]
        centroids[guid] = centroid(verts)
        bboxes[guid] = bbox(verts)

        fn = p.get("primary_function") or ""
        name = p.get("space_name") or ""
        if _matches_keywords(fn, LIFT_KEYWORDS):
            lifts.append({
                "ifc_guid": guid,
                "centroid": centroids[guid],
                "space_name": name,
                "primary_function": fn,
            })
        elif _matches_keywords(fn, STAIR_KEYWORDS):
            stairs.append({
                "ifc_guid": guid,
                "centroid": centroids[guid],
                "space_name": name,
                "primary_function": fn,
            })
        if _matches_keywords(fn, CORRIDOR_KEYWORDS):
            corridors.append({
                "ifc_guid": guid,
                "centroid": centroids[guid],
            })

    # Build adjacency
    adjacency = defaultdict(list)
    guid_list = [p["ifc_guid"] for p in valid]
    bbox_list = [bboxes[g] for g in guid_list]

    for i in range(len(guid_list)):
        for j in range(i + 1, len(guid_list)):
            gap = bbox_gap(bbox_list[i], bbox_list[j])
            if gap <= ADJACENCY_THRESHOLD:
                adjacency[guid_list[i]].append(guid_list[j])
                adjacency[guid_list[j]].append(guid_list[i])

    scale_factor = compute_scale_factor(valid)

    return {
        "centroids": centroids,
        "bboxes": bboxes,
        "adjacency": dict(adjacency),
        "lifts": lifts,
        "stairs": stairs,
        "corridors": corridors,
        "scale_factor": scale_factor,
        "has_lift": len(lifts) > 0,
        "has_stair": len(stairs) > 0,
    }


# ══════════════════════════════════════════════════════════════════════
# Per-space spatial computation
# ══════════════════════════════════════════════════════════════════════

def compute_space_spatial(ifc_guid: str, floor_data: dict,
                          polygon_map: dict | None = None) -> dict:
    """Compute spatial relationships for a single space on a floor.

    Args:
        ifc_guid: the target polygon's guid
        floor_data: result from compute_floor_spatial()
        polygon_map: optional {ifc_guid: polygon_dict} for neighbour name lookup

    Returns dict with:
        nearest_lift: str | None (name of nearest lift polygon)
        lift_distance_m: float | None
        nearest_stair: str | None
        stair_distance_m: float | None
        step_free_access: str ("Yes" / "No")
        adjacent_spaces: str (comma-separated names of adjacent polygons)
    """
    space_centroid = floor_data["centroids"].get(ifc_guid)
    if not space_centroid:
        return {
            "nearest_lift": None,
            "lift_distance_m": None,
            "nearest_stair": None,
            "stair_distance_m": None,
            "step_free_access": "Unknown",
            "adjacent_spaces": None,
        }

    scale = floor_data["scale_factor"]

    # Nearest lift
    nearest_lift_name = None
    nearest_lift_dist = None
    for lift in floor_data["lifts"]:
        dist_pct = euclidean_distance(space_centroid, lift["centroid"])
        dist_m = round(dist_pct * scale, 1)
        if nearest_lift_dist is None or dist_m < nearest_lift_dist:
            nearest_lift_dist = dist_m
            nearest_lift_name = lift["space_name"] or "Lift"

    # Nearest stair
    nearest_stair_name = None
    nearest_stair_dist = None
    for stair in floor_data["stairs"]:
        dist_pct = euclidean_distance(space_centroid, stair["centroid"])
        dist_m = round(dist_pct * scale, 1)
        if nearest_stair_dist is None or dist_m < nearest_stair_dist:
            nearest_stair_dist = dist_m
            nearest_stair_name = stair["space_name"] or "Staircase"

    # Step-free access
    step_free = "Yes" if floor_data["has_lift"] else "No"

    # Adjacent spaces
    neighbor_guids = floor_data["adjacency"].get(ifc_guid, [])
    neighbor_names = []
    if polygon_map:
        for ng in neighbor_guids[:8]:  # cap at 8 neighbours
            poly = polygon_map.get(ng)
            name = (poly.get("space_name") or poly.get("primary_function") or ng) if poly else ng
            neighbor_names.append(name)
    adjacent_str = ", ".join(neighbor_names) if neighbor_names else None

    return {
        "nearest_lift": nearest_lift_name,
        "lift_distance_m": nearest_lift_dist,
        "nearest_stair": nearest_stair_name,
        "stair_distance_m": nearest_stair_dist,
        "step_free_access": step_free,
        "adjacent_spaces": adjacent_str,
    }

"""
Occupancy density model for Office Campus (Abu Dhabi).

Maps primary_function categories to occupancy rates (persons per m2).
Rates are derived from ADIBC (Abu Dhabi International Building Code)
Table 1004.1.2 and UAE Fire Code 2018 evacuation capacities.

Reference norms (ADIBC Table 1004.1.2, net area):
    Business / Office           9.3  m2/person
    Assembly (concentrated)     0.65 m2/person
    Assembly (unconcentrated)   1.4  m2/person
    Residential                18.6  m2/person
    Educational classroom       1.9  m2/person
    Kitchen / commercial       18.6  m2/person
    Storage                    27.9  m2/person
    Mechanical                  no occupancy

normal_occupancy  = floor(area / ADIBC rate)
max_occupancy     = ceil(area / (ADIBC rate * reduction_factor))
    where reduction_factor ~ 0.65-0.77  (i.e. max ~ 130-150% of normal)
"""

import math

# ---------------------------------------------------------------------------
# Zero-occupancy keywords
# ---------------------------------------------------------------------------
# If the function or space name contains any of these (case-insensitive),
# the space is treated as non-occupiable (occupancy = 0).
ZERO_OCCUPANCY_KEYWORDS = [
    "no access",
    "no infrastructure",
    "technical room",
    "technical",
    "data room",
    "hvac",
    "hvac plant",
    "mechanical",
    "shaft",
    "vent",
    "riser",
    "waste room",
    "waste",
    "bicycle parking",
    "bike parking",
    "parking",
    "staircase",
    "stairwell",
    "stair ",
    "stair/",
    "stairway",
    "corridor",
    "circulation",
    "vestibule",
    "ramp",
    "airlock",
    "elevator",
    "lift",
    "basement",
    "underground",
    "evacuation",
]

# ---------------------------------------------------------------------------
# Zero-override keywords
# ---------------------------------------------------------------------------
# If a space name contains any of these, it is NOT zeroed even when a
# ZERO_OCCUPANCY_KEYWORDS match exists (e.g. "Control Centre + Technical").
ZERO_OVERRIDE_KEYWORDS = [
    "control centre",
    "control center",
    "surveillance",
    "first aid",
]

# ---------------------------------------------------------------------------
# Density rules
# ---------------------------------------------------------------------------
# Each rule: (keyword_list, occupancy_class, normal_m2_per_person, max_m2_per_person)
#
# normal_m2_per_person  = ADIBC base rate (m2 per person)
# max_m2_per_person     = reduced rate for peak/emergency (~130-150% load)
#
# Matched in order; first match wins. Put more specific rules above
# broader ones.
DENSITY_RULES = [
    # -- Assembly: concentrated seating (seminar, multipurpose) --
    # ADIBC concentrated assembly = 0.65 m2/person
    (["seminar room", "seminar"],
     "assembly_concentrated", 0.65, 0.5),

    # -- Assembly: unconcentrated (meeting rooms) --
    # ADIBC unconcentrated assembly = 1.4 m2/person
    (["meeting room", "meeting", "multipurpose room", "multipurpose",
      "conference", "boardroom"],
     "assembly_unconcentrated", 1.4, 1.0),

    # -- Coworking / hot-desk (denser than private office) --
    # ADIBC business 9.3 m2/person; coworking uses ~60% of that (5.6 m2)
    (["coworking", "co-working", "hot desk", "hotdesk", "open plan",
      "flex space"],
     "coworking", 5.6, 4.0),

    # -- Workshop (hands-on space, tools and benches) --
    # Treat like educational/lab: moderate density
    (["workshop"],
     "workshop", 9.3, 6.5),

    # -- Studio apartment / residential --
    # ADIBC residential = 18.6 m2/person
    (["studio apartment", "studio", "apartment", "residential"],
     "residential", 18.6, 14.0),

    # -- Cafe / kitchenette --
    # ADIBC kitchen/commercial = 18.6 m2/person for kitchen area;
    # seating area treated as unconcentrated assembly (1.4).
    # Blended rate for a cafe with both: ~3.7 m2/person
    (["cafe", "café", "cafeteria", "kitchenette", "pantry", "break room",
      "tea point", "coffee"],
     "cafe", 3.7, 2.6),

    # -- Sanitary / showers --
    # Transient occupancy; ~4 m2/person based on fixture count proxy
    (["sanitary", "sanitation", "toilet", "washroom", "wc", "shower",
      "showers", "restroom", "lavatory"],
     "sanitary", 4.0, 3.0),

    # -- Locker room / changing --
    # Similar to sanitary but slightly denser
    (["locker room", "locker", "changing room", "changing"],
     "changing", 4.0, 2.8),

    # -- Business / private office (most common) --
    # ADIBC business = 9.3 m2/person
    (["office", "bureau", "workroom", "work room", "private office"],
     "office", 9.3, 6.5),

    # -- Storage --
    # ADIBC storage = 27.9 m2/person (minimal occupancy, maintenance only)
    (["storage", "store room", "storeroom", "archive"],
     "storage", 27.9, 20.0),

    # -- Surveillance / control centre --
    # Staffed monitoring; moderate density like office
    (["surveillance", "control centre", "control center", "security"],
     "control", 9.3, 6.5),

    # -- First aid --
    # Small treatment space; fixed staff + patient
    (["first aid", "medical room", "clinic"],
     "first_aid", 9.3, 6.5),

    # -- Reception / lobby --
    # Public-facing entry; treat as unconcentrated assembly
    (["reception", "lobby", "entrance", "foyer"],
     "reception", 2.8, 2.0),
]

# Default fallback for unmatched functions
DEFAULT_CLASS = "general"
DEFAULT_M2_PER_PERSON_NORMAL = 9.3    # ADIBC business as safe default
DEFAULT_M2_PER_PERSON_MAX = 6.5       # ~140% of normal


def _matches_any(text: str, keywords: list[str]) -> bool:
    """Check if text contains any keyword (case-insensitive)."""
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in keywords)


def compute_occupancy(
    primary_function: str | None,
    area_m2: float | None,
    space_name: str | None = None,
) -> dict:
    """
    Compute occupancy metrics for a campus space.

    Tries primary_function first; if no rule matches, falls back to
    space_name. Both fields come from polygon data.

    Args:
        primary_function: The functional designation of the space
            (e.g. "Office", "Meeting Room", "Corridor").
        area_m2: Net floor area in square metres.
        space_name: Human-readable name of the space (fallback for matching).

    Returns:
        {
            "normal_occupancy": int,   -- typical working-day occupancy
            "max_occupancy": int,      -- peak / evacuation-planning occupancy
            "occupancy_class": str,    -- classification label
            "occupiable": bool,        -- whether the space is occupiable at all
        }
    """
    fn = primary_function or ""
    name = space_name or ""
    area = area_m2 or 0.0

    # ── Zero-occupancy check ──
    combined = fn + " " + name
    has_zero_kw = (
        _matches_any(fn, ZERO_OCCUPANCY_KEYWORDS)
        or (name and _matches_any(name, ZERO_OCCUPANCY_KEYWORDS))
    )
    has_override = _matches_any(combined, ZERO_OVERRIDE_KEYWORDS)
    if has_zero_kw and not has_override:
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    # ── No function / no name ──
    if not fn.strip() and not name.strip():
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    # Build candidate strings (primary_function first, then space_name)
    candidates = [fn] if fn.strip() else []
    if name.strip():
        candidates.append(name)

    # ── Too small to occupy ──
    if area < 2:
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    # ── Density-based rules ──
    for keywords, occ_class, normal_m2pp, max_m2pp in DENSITY_RULES:
        for text in candidates:
            if _matches_any(text, keywords):
                normal = max(1, math.floor(area / normal_m2pp))
                maximum = max(1, math.ceil(area / max_m2pp))
                # Ensure max >= normal
                maximum = max(maximum, normal)
                return {
                    "normal_occupancy": normal,
                    "max_occupancy": maximum,
                    "occupancy_class": occ_class,
                    "occupiable": True,
                }

    # ── Default fallback (ADIBC business rate) ──
    normal = max(1, math.floor(area / DEFAULT_M2_PER_PERSON_NORMAL))
    maximum = max(1, math.ceil(area / DEFAULT_M2_PER_PERSON_MAX))
    maximum = max(maximum, normal)
    return {
        "normal_occupancy": normal,
        "max_occupancy": maximum,
        "occupancy_class": DEFAULT_CLASS,
        "occupiable": True,
    }

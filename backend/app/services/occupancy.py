"""
Occupancy density model for CHIREC Delta Hospital spaces.

Maps primary_function categories to occupancy rates (persons per m²).
Rates are derived from Belgian fire safety norms (NBN S 21-100) and
European healthcare facility guidelines.
"""

import math
import re

# ── Zero-occupancy keywords ──
# If a function contains any of these (case-insensitive), occupancy = 0.
ZERO_OCCUPANCY_KEYWORDS = [
    "no access",
    "no infrastructure",
    "staircase",
    "stair ",
    "stair/",
    "staircasse",     # typo in data
    "stairway",
    "technical",
    "vent",
    "shaft",
    "corridor",
    "circulation",
    "ramp",
    "waste",
    "cold storage",
    "ambulance",
    "basement",
    "airlock",
    "atrium",
    "housekeeping",
    "cleaning",
    "underground",
    "evacuation",
    "sanitation",
    "coded technical",
    "coded engineering",
]

# ── Density rules ──
# Each rule: (keyword_list, occupancy_class, normal_per_m2, max_per_m2)
# Matched in order; first match wins.
DENSITY_RULES = [
    # Patient bed rooms — fixed per room, not per m²
    (["single patient room", "single-bed"],
     "patient_bed", None, None),  # handled specially: 1 patient + 2 staff normal, +1 max
    (["double patient room", "two-bed"],
     "patient_bed_double", None, None),  # 2 patients + 2 staff normal, +2 max

    # Clinical / procedural
    (["surgical", "surgery", "operating room", "operating-theatre", "operating theatre"],
     "surgical", 1/25, 1/15),
    (["patient care", "patient room", "intensive-care", "neonatal", "dialysis"],
     "clinical", 1/12, 1/8),
    (["endoscopy", "consultation", "examination", "check-up", "check up",
      "dental", "clinical"],
     "clinical", 1/12, 1/8),
    (["nuclear-medicine", "nuclear medicine", "PET imaging"],
     "clinical", 1/20, 1/12),

    # Emergency department (high throughput)
    (["emergency"],
     "emergency", 1/15, 1/10),

    # Radiotherapy (restricted but staffed)
    (["radiotherapy"],
     "radiotherapy", 1/20, 1/12),

    # Sterilization (industrial process, multiple technicians)
    (["sterilization", "sterilisation"],
     "sterilization", 1/25, 1/15),

    # Morgue / preparation (mortuary technicians)
    (["morgue", "incinerator"],
     "morgue", 1/30, 1/20),

    # Changing rooms / locker rooms (before office/storage so name wins over fn)
    (["changing", "locker room", "locker"],
     "changing", 1/4, 1/2.5),

    # Staff / office (must come AFTER specific name-based rules above)
    (["staff", "office", "bureau", "nursing station", "workroom",
      "nurse's office", "doctor's office"],
     "office", 1/10, 1/6),

    # Waiting / public
    (["waiting room", "main hall"],
     "waiting", 1/2.5, 1/1.5),

    # Assembly / meeting / debrief
    (["assembly", "meeting", "conference", "debrief", "gathering"],
     "assembly", 1/2, 1/1.2),

    # Commercial
    (["restaurant", "cafeteria", "commercial"],
     "commercial", 1/3, 1/1.8),

    # Storage / support (no "locker" — locker rooms are changing, not storage)
    (["storage", "store room", "janitor", "pantry", "archive",
      "cold / refrigerated", "dirty utility"],
     "storage", 1/20, 1/15),

    # Laboratory / specialist
    (["laboratory", "dosimetry", "medical physics",
      "preparation room", "pharmacy"],
     "laboratory", 1/15, 1/10),

    # Sanitary
    (["toilet", "sanitary", "washroom", "shower", "WC"],
     "sanitary", 1/4, 1/3),

    # Patient care + residency (on-call rooms etc.)
    (["residency"],
     "clinical", 1/15, 1/10),

    # Control rooms
    (["control room"],
     "office", 1/15, 1/10),

    # Accessibility elevator (bed/wheelchair transport + staff + passengers)
    (["accessibility elevator"],
     "elevator", 1/2, 1/1),

    # Visitor / standard elevator
    (["elevator", "lift"],
     "elevator", 1/3, 1/1.5),

    # Facilities / plant rooms (technician access)
    (["facilities", "facitilies"],
     "facilities", 1/25, 1/15),

    # Reception / entrance / lobby (public-facing)
    (["reception", "entrance", "lobby"],
     "reception", 1/4, 1/2),
]

# Default fallback for unmatched functions (conservative)
DEFAULT_CLASS = "general"
DEFAULT_NORMAL_PER_M2 = 1 / 12
DEFAULT_MAX_PER_M2 = 1 / 8


def _matches_any(function: str, keywords: list[str]) -> bool:
    """Check if function string contains any keyword (case-insensitive)."""
    fn_lower = function.lower()
    return any(kw.lower() in fn_lower for kw in keywords)


def compute_occupancy(primary_function: str | None, area_m2: float | None,
                      space_name: str | None = None) -> dict:
    """
    Compute occupancy metrics for a space.

    Tries primary_function first; if no rule matches, falls back to space_name.
    Both fields come from polygon data.

    Returns:
        {
            "normal_occupancy": int,
            "max_occupancy": int,
            "occupancy_class": str,
            "occupiable": bool,
        }
    """
    fn = primary_function or ""
    name = space_name or ""
    area = area_m2 or 0.0

    # Zero-occupancy check (both polygon fields)
    if _matches_any(fn, ZERO_OCCUPANCY_KEYWORDS) or (name and _matches_any(name, ZERO_OCCUPANCY_KEYWORDS)):
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    if not fn.strip() and not name.strip():
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    # Try matching against both polygon fields (primary_function first, then space_name)
    candidates = [fn] if fn.strip() else []
    if name.strip():
        candidates.append(name)

    # Special: single patient bed room
    for text in candidates:
        if _matches_any(text, ["single patient room", "single-bed"]):
            return {
                "normal_occupancy": 3,   # 1 patient + 2 staff
                "max_occupancy": 4,      # + 1 visitor
                "occupancy_class": "patient_bed",
                "occupiable": True,
            }

    # Special: double patient bed room
    for text in candidates:
        if _matches_any(text, ["double patient room", "two-bed"]):
            return {
                "normal_occupancy": 4,   # 2 patients + 2 staff
                "max_occupancy": 6,      # + 2 visitors
                "occupancy_class": "patient_bed_double",
                "occupiable": True,
            }

    # Too small to occupy (catches 0 m² rooms before density rules)
    if area < 2:
        return {
            "normal_occupancy": 0,
            "max_occupancy": 0,
            "occupancy_class": "zero",
            "occupiable": False,
        }

    # Density-based rules
    for keywords, occ_class, normal_rate, max_rate in DENSITY_RULES:
        if normal_rate is None:
            continue  # skip bed-room rules (handled above)
        for text in candidates:
            if _matches_any(text, keywords):
                normal = max(1, math.floor(area * normal_rate))
                maximum = max(1, math.ceil(area * max_rate))
                return {
                    "normal_occupancy": normal,
                    "max_occupancy": maximum,
                    "occupancy_class": occ_class,
                    "occupiable": True,
                }

    # Default fallback
    normal = max(1, math.floor(area * DEFAULT_NORMAL_PER_M2))
    maximum = max(1, math.ceil(area * DEFAULT_MAX_PER_M2))
    return {
        "normal_occupancy": normal,
        "max_occupancy": maximum,
        "occupancy_class": DEFAULT_CLASS,
        "occupiable": True,
    }

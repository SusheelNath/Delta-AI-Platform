"""
Furnishing type catalog and rule-based seeder for CHIREC Delta Hospital.

Provides:
- FURNISHING_CATALOG: reference data for the furnishing_types table
- FUNCTION_FURNISHING_RULES: maps primary_function keywords to default furnishings
- seed_furnishing_types(): populates furnishing_types table
- seed_space_furnishings(): auto-populates space_furnishings from polygon functions
- compute_furnishing_occupancy(): computes occupancy from furnishing inventory
"""

import math
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import FurnishingType, SpaceFurnishing, SpaceMetrics


# ══════════════════════════════════════════════════════════════════════
# Furnishing type catalog
# ══════════════════════════════════════════════════════════════════════
# (item_type, category, label, footprint_m2, normal_occ, max_occ)

FURNISHING_CATALOG = [
    # ── Beds ──
    ("patient_bed",         "bed",       "Patient Bed",           4.5, 1, 2),
    ("patient_bed_double",  "bed",       "Patient Bed (Double)",  6.0, 2, 4),
    ("icu_bed",             "bed",       "ICU Bed",               8.0, 1, 3),
    ("surgical_table",      "bed",       "Surgical Table",        6.0, 0, 5),
    ("examination_table",   "bed",       "Examination Table",     3.0, 1, 2),
    ("recovery_bed",        "bed",       "Recovery Bed",          3.5, 1, 2),
    ("crib",                "bed",       "Crib",                  2.0, 1, 2),

    # ── Seating ──
    ("visitor_chair",       "seating",   "Visitor Chair",         0.8, 1, 1),
    ("desk_chair",          "seating",   "Desk Chair",            1.2, 1, 1),
    ("waiting_bench",       "seating",   "Waiting Bench",         1.8, 3, 4),
    ("stool",               "seating",   "Stool",                 0.4, 1, 1),
    ("wheelchair_bay",      "seating",   "Wheelchair Bay",        1.5, 1, 1),

    # ── Storage ──
    ("wardrobe",            "storage",   "Wardrobe",              0.6, 0, 0),
    ("closet",              "storage",   "Closet",                0.5, 0, 0),
    ("cabinet",             "storage",   "Cabinet",               0.4, 0, 0),
    ("shelving",            "storage",   "Shelving Unit",         0.5, 0, 0),
    ("medication_cart",     "storage",   "Medication Cart",       0.6, 0, 0),
    ("supply_cart",         "storage",   "Supply Cart",           0.5, 0, 0),

    # ── Equipment ──
    ("ventilator",          "equipment", "Ventilator",            0.8, 0, 0),
    ("monitor",             "equipment", "Patient Monitor",       0.3, 0, 0),
    ("infusion_pump",       "equipment", "Infusion Pump",         0.2, 0, 0),
    ("anaesthesia_unit",    "equipment", "Anaesthesia Unit",      1.0, 0, 0),
    ("defibrillator",       "equipment", "Defibrillator",         0.3, 0, 0),
    ("imaging_unit",        "equipment", "Imaging Unit",          4.0, 0, 2),
    ("autoclave",           "equipment", "Autoclave",             1.0, 0, 0),

    # ── Fixtures ──
    ("sink",                "fixture",   "Sink",                  0.4, 0, 0),
    ("toilet",              "fixture",   "Toilet",                1.2, 0, 0),
    ("shower",              "fixture",   "Shower",                1.5, 0, 0),
    ("scrub_station",       "fixture",   "Scrub Station",         0.8, 0, 0),
    ("gas_outlet",          "fixture",   "Gas Outlet",            0.0, 0, 0),
    ("nurse_call",          "fixture",   "Nurse Call",            0.0, 0, 0),

    # ── Furniture ──
    ("desk",                "furniture", "Desk",                  2.0, 1, 1),
    ("table",               "furniture", "Table",                 1.8, 0, 0),
    ("countertop",          "furniture", "Countertop",            1.5, 0, 0),
    ("bedside_table",       "furniture", "Bedside Table",         0.3, 0, 0),
    ("curtain_divider",     "furniture", "Curtain Divider",       0.2, 0, 0),

    # ── Elevator ──
    ("elevator_panel",      "equipment", "Elevator Control Panel", 0.2, 0, 0),
    ("handrail",            "fixture",   "Handrail",              0.1, 0, 0),
    ("elevator_mirror",     "fixture",   "Elevator Mirror",       0.0, 0, 0),

    # ── Facilities / MEP ──
    ("hvac_unit",           "equipment", "HVAC Unit",             3.0, 0, 0),
    ("electrical_panel",    "equipment", "Electrical Panel",      0.6, 0, 0),
    ("pump",                "equipment", "Pump",                  1.0, 0, 0),
]


# ══════════════════════════════════════════════════════════════════════
# Excluded function patterns — these rooms NEVER get furnishings
# ══════════════════════════════════════════════════════════════════════

EXCLUDED_PATTERNS = [
    "staircase", "stairway", "stair ", "stair-core", "vertical circulation",
    "shaft", "vent shaft", "ventilation",
    "no access", "no acccess", "no infrastructure",
    "corridor", "circulation", "hallway",
    "parking", "ramp",
    "airlock", "lobby", "transition",
    "basement",
    "waste",
    "technical", "plant room", "building-services",
    "coded technical",
    "core / technical",
    "staircasse",  # typo in data
    "loading",
]


def _is_excluded(fn: str, space_name: str | None = None) -> bool:
    """Check if a space should be excluded from furnishing.

    Checks both primary_function and space_name against exclusion patterns.
    """
    for text in (fn, space_name):
        if not text:
            continue
        text_lower = text.lower()
        for pattern in EXCLUDED_PATTERNS:
            if pattern in text_lower:
                return True
    return False


# ══════════════════════════════════════════════════════════════════════
# Rule-based seeding: primary_function → default furnishings
# ══════════════════════════════════════════════════════════════════════
#
# Each rule: (keywords_list, base_furnishings, options)
#   keywords: list of case-insensitive substrings (first match wins)
#   base_furnishings: [(item_type, quantity), ...]
#   options: dict with optional keys:
#     min_area: minimum room area (m²) for this rule to apply
#     scale: dict of {item_type: {"per_m2": float, "min": int, "max": int}}
#            scales quantity based on room area

FUNCTION_FURNISHING_RULES = [
    # ═══════════════════ SINGLE PATIENT ROOMS ═══════════════════
    (["single patient room", "single-bed", "single surgery/medicine inpatient",
      "single geriatric inpatient", "single-bed rehabilitation",
      "single neonatal intensive-care", "single post-partum maternity",
      "single high-risk pregnancy", "koala maternity",
      "single clinical/day-hospital treatment"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1)],
     {"min_area": 10}),

    # ═══════════════════ DOUBLE PATIENT ROOMS ═══════════════════
    (["double patient room", "two-bed", "double surgery/medicine inpatient",
      "double geriatric inpatient", "double-bed rehabilitation",
      "double post-partum maternity", "double bariatric"],
     [("patient_bed", 2), ("bedside_table", 2), ("wardrobe", 2),
      ("visitor_chair", 2), ("curtain_divider", 1), ("nurse_call", 2), ("gas_outlet", 2)],
     {"min_area": 18}),

    # ═══════════════════ LARGER PATIENT ROOMS / SUITES ═══════════════════
    (["larger single patient room", "suite / larger single",
      "surgery/medicine suite", "geriatric suite", "rehabilitation suite",
      "maternity suite", "bariatric/adapted suite"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("desk", 1), ("desk_chair", 1),
      ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1)],
     {"min_area": 15}),

    # ═══════════════════ PATIENT ROOM (named) ═══════════════════
    (["patient room"],
     [("patient_bed", 1), ("bedside_table", 1), ("wardrobe", 1),
      ("visitor_chair", 2), ("nurse_call", 1), ("gas_outlet", 1), ("cabinet", 1)],
     {"min_area": 10}),

    # ═══════════════════ PATIENT CARE (generic — includes "patient" keyword) ═══════════════════
    (["patient care", "patient"],
     [("patient_bed", 1), ("bedside_table", 1), ("visitor_chair", 1),
      ("nurse_call", 1), ("cabinet", 1)],
     {"min_area": 10,
      "scale": {"patient_bed": {"per_m2": 25, "min": 1, "max": 2},
                "bedside_table": {"per_m2": 25, "min": 1, "max": 2},
                "visitor_chair": {"per_m2": 15, "min": 1, "max": 3},
                "curtain_divider": {"per_m2": 30, "min": 0, "max": 1}}}),

    # ═══════════════════ ICU ═══════════════════
    (["intensive-care", "intensive care", "icu"],
     [("icu_bed", 1), ("ventilator", 1), ("monitor", 1), ("infusion_pump", 2),
      ("bedside_table", 1), ("nurse_call", 1), ("gas_outlet", 2)],
     {"min_area": 12}),

    # ═══════════════════ CONTROL ROOM ═══════════════════
    # (before operating rooms — "Surgery Room - Control" must match here, not OR rule)
    (["control room", "control"],
     [("desk", 2), ("desk_chair", 2), ("monitor", 2)],
     {"min_area": 5}),

    # ═══════════════════ OPERATING ROOMS / SURGERY ═══════════════════
    (["operating room", "operating-theatre", "operating theatre",
      "surgical room", "surgery room", "coded op5", "coded op7",
      "caesarean", "obstetric procedure"],
     [("surgical_table", 1), ("anaesthesia_unit", 1), ("monitor", 2),
      ("infusion_pump", 1), ("defibrillator", 1), ("scrub_station", 1),
      ("gas_outlet", 4), ("supply_cart", 1)],
     {"min_area": 20}),

    # ═══════════════════ SCRUB / SURGICAL PREPARATION ═══════════════════
    (["scrub / surgical", "scrub station", "surgical preparation"],
     [("scrub_station", 2), ("sink", 1), ("supply_cart", 1), ("shelving", 1)],
     {"min_area": 6}),

    # ═══════════════════ RECOVERY / POST-ANAESTHESIA ═══════════════════
    (["recovery", "post-operative", "post operative", "pacu",
      "post-anaesthesia"],
     [("recovery_bed", 1), ("monitor", 1), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 1)],
     {"min_area": 8}),

    # ═══════════════════ NEONATAL ═══════════════════
    (["neonatal", "nicu", "resuscitation"],
     [("crib", 1), ("monitor", 1), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 2)],
     {"min_area": 6}),

    # ═══════════════════ BIRTHING / DELIVERY ═══════════════════
    (["birthing", "delivery room"],
     [("patient_bed", 1), ("monitor", 2), ("infusion_pump", 1),
      ("nurse_call", 1), ("gas_outlet", 2), ("supply_cart", 1),
      ("visitor_chair", 1)],
     {"min_area": 15}),

    # ═══════════════════ DIALYSIS ═══════════════════
    (["dialysis"],
     [("patient_bed", 1), ("monitor", 1), ("infusion_pump", 1),
      ("visitor_chair", 1), ("nurse_call", 1)],
     {"min_area": 6}),

    # ═══════════════════ CONSULTATION / EXAMINATION / CHECK-UP ═══════════════════
    (["consultation", "examination", "endoscopy procedure",
      "triage room", "triage area", "dental", "check-up", "check up",
      "checkup"],
     [("examination_table", 1), ("desk", 1), ("desk_chair", 1),
      ("visitor_chair", 2), ("cabinet", 1), ("sink", 1)],
     {"min_area": 8}),

    # ═══════════════════ PHYSIOTHERAPY / REHABILITATION ═══════════════════
    (["physiotherapy", "kinesiotherapy", "occupational therapy", "ergotherapy"],
     [("examination_table", 1), ("desk", 1), ("desk_chair", 1),
      ("visitor_chair", 1), ("cabinet", 1)],
     {"min_area": 10}),

    # ═══════════════════ IMAGING / RADIOLOGY ═══════════════════
    (["diagnostic-imaging", "radiography", "x-ray", "mri room", "mri suite",
      "scanner", "radiology", "nuclear-medicine", "nuclear medicine",
      "radiotherapy bunker"],
     [("imaging_unit", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1)],
     {"min_area": 10}),

    # ═══════════════════ NURSING STATION ═══════════════════
    (["nursing station", "staff base", "staff work base"],
     [("desk", 2), ("desk_chair", 2), ("monitor", 1), ("cabinet", 1),
      ("shelving", 1)],
     {"min_area": 6,
      "scale": {"desk": {"per_m2": 6, "min": 2, "max": 6},
                "desk_chair": {"per_m2": 6, "min": 2, "max": 6}}}),

    # ═══════════════════ OFFICE / WORKROOM ═══════════════════
    (["office", "bureau", "workroom"],
     [("desk", 1), ("desk_chair", 1), ("cabinet", 1), ("shelving", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 8, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 1, "max": 8}}}),

    # ═══════════════════ RECEPTION ═══════════════════
    (["reception"],
     [("desk", 1), ("desk_chair", 1), ("visitor_chair", 2), ("cabinet", 1)],
     {"min_area": 6}),

    # ═══════════════════ WAITING ROOM ═══════════════════
    (["waiting room", "waiting", "main hall", "day room", "lounge",
      "play room"],
     [("waiting_bench", 2), ("visitor_chair", 3)],
     {"min_area": 8,
      "scale": {"waiting_bench": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 6, "min": 2, "max": 20}}}),

    # ═══════════════════ MEETING / CONFERENCE / DEBRIEF ═══════════════════
    (["meeting", "conference", "debrief", "gathering"],
     [("table", 1), ("desk_chair", 6)],
     {"min_area": 10,
      "scale": {"desk_chair": {"per_m2": 4, "min": 4, "max": 24}}}),

    # ═══════════════════ ASSEMBLY ROOM ═══════════════════
    (["assembly"],
     [("table", 1), ("desk_chair", 8)],
     {"min_area": 12,
      "scale": {"desk_chair": {"per_m2": 4, "min": 6, "max": 30}}}),

    # ═══════════════════ RESTAURANT / CAFETERIA ═══════════════════
    (["restaurant", "cafeteria"],
     [("table", 4), ("visitor_chair", 16), ("countertop", 2)],
     {"min_area": 30,
      "scale": {"table": {"per_m2": 12, "min": 2, "max": 20},
                "visitor_chair": {"per_m2": 3, "min": 8, "max": 80}}}),

    # ═══════════════════ COMMERCIAL ═══════════════════
    (["commercial", "supermarket", "convenience store", "pharmacy", "store"],
     [("countertop", 1), ("shelving", 3), ("desk", 1), ("desk_chair", 1)],
     {"min_area": 8,
      "scale": {"shelving": {"per_m2": 8, "min": 2, "max": 20}}}),

    # ═══════════════════ LABORATORY ═══════════════════
    (["laboratory", "lab "],
     [("countertop", 2), ("stool", 2), ("cabinet", 2), ("sink", 1), ("shelving", 2)],
     {"min_area": 6}),

    # ═══════════════════ STERILISATION ═══════════════════
    (["sterilisation", "sterilization", "sterile"],
     [("autoclave", 1), ("countertop", 2), ("shelving", 2), ("sink", 1)],
     {"min_area": 6,
      "scale": {"autoclave": {"per_m2": 50, "min": 1, "max": 10},
                "countertop": {"per_m2": 25, "min": 2, "max": 16},
                "shelving": {"per_m2": 20, "min": 2, "max": 20},
                "sink": {"per_m2": 60, "min": 1, "max": 8}}}),

    # ═══════════════════ DIRTY UTILITY ═══════════════════
    (["dirty utility"],
     [("sink", 1), ("countertop", 1), ("shelving", 1), ("cabinet", 1)],
     {"min_area": 4}),

    # ═══════════════════ CLEAN UTILITY ═══════════════════
    (["clean utility"],
     [("countertop", 1), ("shelving", 2), ("cabinet", 1), ("medication_cart", 1)],
     {"min_area": 4}),

    # ═══════════════════ PREPARATION ROOM ═══════════════════
    (["preparation room"],
     [("countertop", 1), ("cabinet", 2), ("sink", 1), ("supply_cart", 1)],
     {"min_area": 5}),

    # ═══════════════════ PANTRY ═══════════════════
    (["pantry"],
     [("countertop", 1), ("sink", 1), ("shelving", 1), ("cabinet", 1)],
     {"min_area": 3}),

    # ═══════════════════ HOUSEKEEPING / CLEANING ═══════════════════
    (["housekeeping", "cleaning room", "janitor", "laundry"],
     [("sink", 1), ("shelving", 2), ("cabinet", 1)],
     {"min_area": 3}),

    # ═══════════════════ STORAGE ═══════════════════
    (["storage", "store room", "archive", "reserve"],
     [("shelving", 2), ("cabinet", 1)],
     {"min_area": 3,
      "scale": {"shelving": {"per_m2": 6, "min": 1, "max": 12}}}),

    # ═══════════════════ MORGUE ═══════════════════
    (["morgue", "incinerator"],
     [("countertop", 2), ("sink", 1), ("cabinet", 2), ("shelving", 2)],
     {"min_area": 10,
      "scale": {"countertop": {"per_m2": 30, "min": 2, "max": 12},
                "cabinet": {"per_m2": 30, "min": 2, "max": 10},
                "shelving": {"per_m2": 20, "min": 2, "max": 15},
                "sink": {"per_m2": 60, "min": 1, "max": 6}}}),

    # ═══════════════════ LOCKER / CHANGING ═══════════════════
    (["locker", "changing"],
     [("wardrobe", 4), ("stool", 2)],
     {"min_area": 4,
      "scale": {"wardrobe": {"per_m2": 3, "min": 2, "max": 20}}}),

    # ═══════════════════ SANITARY / WC ═══════════════════
    (["toilet", "wc", "washroom", "sanitary", "sanitation", "ensuite",
      "shower / wash", "assisted bathroom", "bathing room"],
     [("toilet", 1), ("sink", 1)],
     {"min_area": 2.0,
      "scale": {"toilet": {"per_m2": 6, "min": 1, "max": 20},
                "sink": {"per_m2": 10, "min": 1, "max": 12}}}),

    (["shower"],
     [("shower", 1), ("sink", 1)],
     {"min_area": 2}),

    # ═══════════════════ STAFF (generic catchall) ═══════════════════
    (["staff room", "staff access", "staff"],
     [("desk", 1), ("desk_chair", 2), ("visitor_chair", 2), ("cabinet", 1),
      ("countertop", 1), ("sink", 1)],
     {"min_area": 5,
      "scale": {"desk": {"per_m2": 10, "min": 1, "max": 8},
                "desk_chair": {"per_m2": 8, "min": 2, "max": 12},
                "visitor_chair": {"per_m2": 10, "min": 1, "max": 6}}}),

    # ═══════════════════ RESIDENCY / ON-CALL ═══════════════════
    (["residency", "on-call", "patient care + residency"],
     [("patient_bed", 1), ("desk", 1), ("desk_chair", 1), ("wardrobe", 1)],
     {"min_area": 8}),

    # ═══════════════════ EMERGENCY CLINICAL ROOMS ═══════════════════
    (["emergency-department clinical", "emergency"],
     [("examination_table", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1),
      ("cabinet", 1), ("sink", 1)],
     {"min_area": 8,
      "scale": {"examination_table": {"per_m2": 25, "min": 1, "max": 30},
                "monitor": {"per_m2": 30, "min": 1, "max": 25},
                "desk": {"per_m2": 60, "min": 1, "max": 10},
                "desk_chair": {"per_m2": 60, "min": 1, "max": 10},
                "cabinet": {"per_m2": 40, "min": 1, "max": 15},
                "sink": {"per_m2": 80, "min": 1, "max": 10}}}),

    # ═══════════════════ DEPARTMENT-SPECIFIC (unresolved) ═══════════════════
    # Generic fallback for coded department rooms with unknown exact function
    (["department-specific", "existing department"],
     [("desk", 1), ("desk_chair", 1), ("cabinet", 1), ("shelving", 1)],
     {"min_area": 5}),

    # ═══════════════════ RADIOTHERAPY ═══════════════════
    (["radiotherapy", "dosimetry", "medical physics"],
     [("imaging_unit", 1), ("monitor", 1), ("desk", 1), ("desk_chair", 1)],
     {"min_area": 8}),

    # ═══════════════════ RADIOTHERAPY SIMULATION ═══════════════════
    (["radiotherapy simulation"],
     [("examination_table", 1), ("imaging_unit", 1), ("monitor", 1),
      ("desk", 1), ("desk_chair", 1)],
     {"min_area": 10}),

    # ═══════════════════ WORKSHOP ═══════════════════
    (["workshop", "carpentry", "woodwork", "mechanical workshop"],
     [("countertop", 2), ("stool", 2), ("shelving", 2), ("cabinet", 1)],
     {"min_area": 8,
      "scale": {"shelving": {"per_m2": 10, "min": 1, "max": 10}}}),

    # ═══════════════════ ENTRANCE ═══════════════════
    (["entrance"],
     [("desk", 1), ("desk_chair", 1), ("visitor_chair", 2)],
     {"min_area": 10}),

    # ═══════════════════ DEPARTMENT SUPPORT (generic small rooms) ═══════════════════
    (["support/service space", "department support"],
     [("countertop", 1), ("cabinet", 1), ("shelving", 1)],
     {"min_area": 3}),

    # ═══════════════════ ELEVATOR ═══════════════════
    (["elevator", "lift"],
     [("elevator_panel", 1), ("handrail", 2), ("elevator_mirror", 1)],
     {"min_area": 4}),

    # ═══════════════════ FACILITIES / MEP ═══════════════════
    (["facilities", "facitilies", "hvac", "plant room", "building-services"],
     [("hvac_unit", 1), ("electrical_panel", 1), ("shelving", 1), ("cabinet", 1)],
     {"min_area": 8,
      "scale": {"hvac_unit": {"per_m2": 15, "min": 1, "max": 6},
                "electrical_panel": {"per_m2": 20, "min": 1, "max": 4}}}),

]


# Absolute occupancy standing density: arm's-length spacing
STANDING_DENSITY_M2 = 1.8  # m² per person
EGRESS_RESERVE_PER_DOOR = 1.5  # m² kept clear per door
FURNITURE_BUFFER_FACTOR = 0.15  # 15% of used area as clearance around furniture
DEFAULT_DOORS = 1  # assume 1 door per space unless otherwise specified
MAX_FURNISHING_PCT = 0.80  # skip seeding if furnishings would exceed 80% of room area


# ══════════════════════════════════════════════════════════════════════
# Seed functions
# ══════════════════════════════════════════════════════════════════════

def seed_furnishing_types(db: Session) -> int:
    """Populate furnishing_types table from catalog. Returns count of new rows."""
    existing = {ft.item_type for ft in db.query(FurnishingType).all()}
    added = 0
    for item_type, category, label, footprint, normal_occ, max_occ in FURNISHING_CATALOG:
        if item_type not in existing:
            db.add(FurnishingType(
                item_type=item_type,
                category=category,
                label=label,
                footprint_m2=footprint,
                normal_occ=normal_occ,
                max_occ=max_occ,
            ))
            added += 1
    db.commit()
    return added


def _matches_any(function: str, keywords: list[str]) -> bool:
    fn_lower = function.lower()
    return any(kw.lower() in fn_lower for kw in keywords)


def _apply_scaling(base_furnishings: list[tuple], area_m2: float,
                   scale_rules: dict, ft_footprints: dict) -> list[tuple]:
    """Scale furnishing quantities based on room area.

    scale_rules: {item_type: {"per_m2": float, "min": int, "max": int}}
      per_m2: one item per this many m² of room area
    """
    result = []
    for item_type, base_qty in base_furnishings:
        if item_type in scale_rules:
            rule = scale_rules[item_type]
            scaled_qty = max(rule["min"], min(rule["max"],
                             math.floor(area_m2 / rule["per_m2"])))
            result.append((item_type, scaled_qty))
        else:
            result.append((item_type, base_qty))
    return result


def _compute_total_footprint(furnishing_list: list[tuple],
                             ft_footprints: dict) -> float:
    """Compute total footprint of a furnishing list."""
    return sum(ft_footprints.get(item_type, 0) * qty
               for item_type, qty in furnishing_list)


def seed_space_furnishings(db: Session, polygons: list[dict]) -> dict:
    """Auto-populate space_furnishings for all polygons based on primary_function.

    Only adds furnishings to spaces that don't already have any.
    Respects exclusion list, area minimums, and scaling rules.
    Returns stats dict."""
    valid_types = {ft.item_type for ft in db.query(FurnishingType).all()}

    # Build footprint lookup
    ft_footprints = {}
    for ft in db.query(FurnishingType).all():
        ft_footprints[ft.item_type] = ft.footprint_m2

    existing_guids = {
        row.ifc_guid for row in
        db.query(SpaceFurnishing.ifc_guid).distinct().all()
    }

    now = datetime.utcnow().isoformat()
    seeded = 0
    skipped_existing = 0
    skipped_excluded = 0
    skipped_no_function = 0
    skipped_too_small = 0
    skipped_overflow = 0
    no_match = 0

    for p in polygons:
        ifc_guid = p.get("ifc_guid")
        if not ifc_guid:
            continue

        if ifc_guid in existing_guids:
            skipped_existing += 1
            continue

        fn = p.get("primary_function") or ""
        space_name = p.get("space_name") or ""
        floor_id = p.get("floor_id", "")
        area_m2 = p.get("area_m2") or 0

        # Skip unknown / empty functions (check both polygon fields)
        if (not fn or fn == "?" or fn == "Unassigned") and not space_name:
            skipped_no_function += 1
            continue

        # Skip excluded space types (check both polygon fields)
        if _is_excluded(fn, space_name):
            skipped_excluded += 1
            continue

        # Find matching rule — try primary_function first, fall back to space_name
        matched = False
        for keywords, base_furnishings, options in FUNCTION_FURNISHING_RULES:
            if _matches_any(fn, keywords) or (space_name and _matches_any(space_name, keywords)):
                # Check minimum area
                min_area = options.get("min_area", 0)
                if area_m2 > 0 and area_m2 < min_area:
                    skipped_too_small += 1
                    matched = True
                    break

                # Apply scaling if specified
                scale_rules = options.get("scale", {})
                if scale_rules and area_m2 > 0:
                    furnishing_list = _apply_scaling(
                        base_furnishings, area_m2, scale_rules, ft_footprints)
                else:
                    furnishing_list = list(base_furnishings)

                # Check total footprint doesn't exceed room area
                if area_m2 > 0:
                    total_fp = _compute_total_footprint(furnishing_list, ft_footprints)
                    if total_fp > area_m2 * MAX_FURNISHING_PCT:
                        skipped_overflow += 1
                        matched = True
                        break

                # Add furnishings
                for item_type, quantity in furnishing_list:
                    if item_type not in valid_types:
                        continue
                    if quantity <= 0:
                        continue
                    db.add(SpaceFurnishing(
                        ifc_guid=ifc_guid,
                        floor_id=floor_id,
                        item_type=item_type,
                        quantity=quantity,
                        created_at=now,
                    ))
                seeded += 1
                matched = True
                break

        if not matched:
            no_match += 1

    db.commit()
    return {
        "seeded": seeded,
        "skipped_existing": skipped_existing,
        "skipped_excluded": skipped_excluded,
        "skipped_no_function": skipped_no_function,
        "skipped_too_small": skipped_too_small,
        "skipped_overflow": skipped_overflow,
        "no_rule_match": no_match,
    }


# ══════════════════════════════════════════════════════════════════════
# Occupancy computation from furnishings
# ══════════════════════════════════════════════════════════════════════

def compute_furnishing_occupancy(
    furnishings: list[SpaceFurnishing],
    furnishing_types: dict[str, FurnishingType],
    area_m2: float,
    num_doors: int = DEFAULT_DOORS,
) -> dict:
    """Compute normal, max, and absolute occupancy from furnishing inventory.

    Returns dict with:
        normal_occupancy, max_occupancy, absolute_occupancy,
        used_area_m2, free_area_m2
    """
    used_area = 0.0
    normal_occ = 0
    max_occ = 0

    for f in furnishings:
        ft = furnishing_types.get(f.item_type)
        if not ft:
            continue
        used_area += ft.footprint_m2 * f.quantity
        normal_occ += ft.normal_occ * f.quantity
        max_occ += ft.max_occ * f.quantity

    free_area = max(0, area_m2 - used_area)

    # Rooms with only zero-occ furnishings (storage, equipment) still need
    # at least 1 person to access them
    if normal_occ == 0 and max_occ == 0 and area_m2 >= 2 and furnishings:
        normal_occ = 1
        max_occ = 1

    # Absolute occupancy: max_occ + standing people in remaining space
    egress_reserve = num_doors * EGRESS_RESERVE_PER_DOOR
    furniture_buffer = used_area * FURNITURE_BUFFER_FACTOR
    standable_area = max(0, free_area - egress_reserve - furniture_buffer)
    standing_extra = math.floor(standable_area / STANDING_DENSITY_M2)
    absolute_occ = max_occ + standing_extra

    return {
        "normal_occupancy": normal_occ,
        "max_occupancy": max_occ,
        "absolute_occupancy": absolute_occ,
        "used_area_m2": round(used_area, 2),
        "free_area_m2": round(free_area, 2),
    }

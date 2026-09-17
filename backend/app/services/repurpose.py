"""
Deterministic room repurpose analysis engine for CHIREC Delta Hospital.

All output is pre-computed from rules, profiles, and spatial data — no LLM
involved.  Every sentence of justification is a template filled with real
numbers.  The cache is built at startup alongside the intelligence cache so
API responses are O(1) dict lookups.

Provides:
- FUNCTION_PROFILES: FM financial/operational fingerprint per function
- compute_repurpose_options(): top-4 ranked options for a space
- Pre-computed furnishing deltas, cost breakdowns, ROI projections
"""

import math
import logging
from collections import defaultdict

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Function profiles — Facilities & Operations Management data
# ══════════════════════════════════════════════════════════════════════
# Each function gets a financial/operational fingerprint:
#   category:            clinical / public / revenue / support / infrastructure
#   min/ideal/max_area:  m² range for the function
#   revenue_per_m2_year: estimated annual revenue per m²
#   operating_cost_m2_year: annual OPEX per m²
#   staffing_ratio:      FTE per 10 m² of room area
#   patient_facing:      serves patients directly?
#   renovation_class:    light / moderate / heavy / structural
#   adjacency_benefits:  list of synergistic functions
#   adjacency_conflicts: list of operationally conflicting functions
#   requires_*:          infrastructure flags

FUNCTION_PROFILES = {
    "Patient Care": {
        "category": "clinical",
        "label": "Patient Care",
        "min_area": 12, "ideal_area": 22, "max_area": 40,
        "revenue_per_m2_year": 2800,
        "operating_cost_m2_year": 950,
        "staffing_ratio": 0.4,
        "patient_facing": True,
        "requires_medical_gas": True,
        "requires_nurse_call": True,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Toilet", "Corridor", "Storage"],
        "adjacency_conflicts": ["Commercial", "Morgue"],
        "benefit_if_non_revenue": "Increases bed capacity and direct patient throughput on this floor.",
    },
    "Waiting Room": {
        "category": "public",
        "label": "Waiting Room",
        "min_area": 10, "ideal_area": 40, "max_area": 200,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 180,
        "staffing_ratio": 0.0,
        "patient_facing": True,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Reception", "Patient Care", "Corridor", "Toilet"],
        "adjacency_conflicts": ["Morgue", "Sterilization"],
        "benefit_if_non_revenue": "Reduces corridor congestion and improves patient experience scores.",
    },
    "Office": {
        "category": "support",
        "label": "Office / Workroom",
        "min_area": 6, "ideal_area": 15, "max_area": 50,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 280,
        "staffing_ratio": 0.3,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Meeting Room", "Reception", "Corridor", "Staff"],
        "adjacency_conflicts": ["Morgue"],
        "benefit_if_non_revenue": "Provides dedicated workspace for clinical or admin staff.",
    },
    "Meeting Room": {
        "category": "support",
        "label": "Meeting / Conference Room",
        "min_area": 10, "ideal_area": 25, "max_area": 80,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 200,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Office", "Staff", "Corridor"],
        "adjacency_conflicts": ["Morgue", "Surgery Room"],
        "benefit_if_non_revenue": "Supports multidisciplinary team briefings and clinical handover.",
    },
    "Commercial": {
        "category": "revenue",
        "label": "Commercial / Retail",
        "min_area": 15, "ideal_area": 50, "max_area": 300,
        "revenue_per_m2_year": 1800,
        "operating_cost_m2_year": 350,
        "staffing_ratio": 0.1,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Main Hall", "Waiting Room", "Corridor", "Entrance"],
        "adjacency_conflicts": ["Surgery Room", "Sterilization", "Morgue"],
        "benefit_if_non_revenue": None,
    },
    "Reception": {
        "category": "public",
        "label": "Reception / Intake",
        "min_area": 8, "ideal_area": 30, "max_area": 200,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 320,
        "staffing_ratio": 0.2,
        "patient_facing": True,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Waiting Room", "Corridor", "Entrance", "Main Hall"],
        "adjacency_conflicts": ["Morgue", "Storage"],
        "benefit_if_non_revenue": "Improves patient intake flow and reduces bottleneck at registration.",
    },
    "Storage": {
        "category": "support",
        "label": "Storage",
        "min_area": 3, "ideal_area": 15, "max_area": 80,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 60,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Surgery Room", "Patient Care", "Corridor"],
        "adjacency_conflicts": [],
        "benefit_if_non_revenue": "Provides clinical supply staging and reduces corridor clutter.",
    },
    "Staff": {
        "category": "support",
        "label": "Staff Room",
        "min_area": 8, "ideal_area": 25, "max_area": 60,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 250,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Office", "Corridor", "Pantry"],
        "adjacency_conflicts": ["Morgue"],
        "benefit_if_non_revenue": "Staff rest and break area, supports wellbeing and retention.",
    },
    "Surgery Room": {
        "category": "clinical",
        "label": "Surgery / Operating Room",
        "min_area": 30, "ideal_area": 55, "max_area": 80,
        "revenue_per_m2_year": 8500,
        "operating_cost_m2_year": 3200,
        "staffing_ratio": 1.2,
        "patient_facing": True,
        "requires_medical_gas": True,
        "requires_nurse_call": True,
        "requires_special_hvac": True,
        "renovation_class": "heavy",
        "adjacency_benefits": ["Sterilization", "Storage", "Corridor"],
        "adjacency_conflicts": ["Commercial", "Waiting Room"],
        "benefit_if_non_revenue": None,
    },
    "Laboratory": {
        "category": "clinical",
        "label": "Laboratory",
        "min_area": 10, "ideal_area": 30, "max_area": 80,
        "revenue_per_m2_year": 1200,
        "operating_cost_m2_year": 650,
        "staffing_ratio": 0.25,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Storage", "Corridor", "Sterilization"],
        "adjacency_conflicts": ["Waiting Room", "Commercial"],
        "benefit_if_non_revenue": None,
    },
    "Assembly Room": {
        "category": "public",
        "label": "Assembly Room",
        "min_area": 15, "ideal_area": 50, "max_area": 200,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 180,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Corridor", "Toilet", "Entrance"],
        "adjacency_conflicts": ["Surgery Room", "Morgue"],
        "benefit_if_non_revenue": "Provides multi-purpose space for training, events, and public sessions.",
    },
    "Pantry": {
        "category": "support",
        "label": "Pantry / Kitchenette",
        "min_area": 4, "ideal_area": 10, "max_area": 25,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 220,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Staff", "Corridor"],
        "adjacency_conflicts": ["Surgery Room", "Sterilization"],
        "benefit_if_non_revenue": "Provides meal prep support for staff and patient nutrition services.",
    },
    "Consultation": {
        "category": "clinical",
        "label": "Consultation / Examination",
        "min_area": 10, "ideal_area": 18, "max_area": 35,
        "revenue_per_m2_year": 1600,
        "operating_cost_m2_year": 480,
        "staffing_ratio": 0.3,
        "patient_facing": True,
        "requires_medical_gas": False,
        "requires_nurse_call": True,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Waiting Room", "Patient Care", "Corridor", "Toilet"],
        "adjacency_conflicts": ["Commercial", "Morgue"],
        "benefit_if_non_revenue": None,
    },
    "Pharmacy": {
        "category": "clinical",
        "label": "Pharmacy",
        "min_area": 10, "ideal_area": 30, "max_area": 80,
        "revenue_per_m2_year": 2200,
        "operating_cost_m2_year": 550,
        "staffing_ratio": 0.2,
        "patient_facing": True,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "moderate",
        "adjacency_benefits": ["Waiting Room", "Reception", "Corridor", "Commercial"],
        "adjacency_conflicts": ["Morgue"],
        "benefit_if_non_revenue": None,
    },
    "Locker Room": {
        "category": "support",
        "label": "Locker / Changing Room",
        "min_area": 5, "ideal_area": 15, "max_area": 40,
        "revenue_per_m2_year": 0,
        "operating_cost_m2_year": 120,
        "staffing_ratio": 0.0,
        "patient_facing": False,
        "requires_medical_gas": False,
        "requires_nurse_call": False,
        "renovation_class": "light",
        "adjacency_benefits": ["Staff", "Corridor", "Toilet"],
        "adjacency_conflicts": ["Waiting Room", "Commercial"],
        "benefit_if_non_revenue": "Provides staff personal storage and changing facilities.",
    },
}

# Functions that can never be repurposed (infrastructure, circulation, etc.)
NON_REPURPOSABLE_FUNCTIONS = {
    "Corridor", "Corridor Access", "Elevator", "Staircase", "Staircasse",
    "Ramp", "No Access", "No Acccess", "No Infrastructure",
    "Ventilation Shaft", "Vent", "Technical", "Main Hall",
    "Ambulance", "Atrium", "Basement", "Waste",
}

# Candidate target functions that a room can be repurposed to
REPURPOSE_TARGETS = list(FUNCTION_PROFILES.keys())


# ══════════════════════════════════════════════════════════════════════
# Cost model
# ══════════════════════════════════════════════════════════════════════

RENOVATION_COSTS = {
    "light":      {"base_per_m2": 120,  "weeks_min": 4,  "weeks_max": 8},
    "moderate":   {"base_per_m2": 350,  "weeks_min": 10, "weeks_max": 18},
    "heavy":      {"base_per_m2": 850,  "weeks_min": 20, "weeks_max": 36},
    "structural": {"base_per_m2": 1800, "weeks_min": 36, "weeks_max": 56},
}

# Estimated unit cost (€) per furnishing item_type
FURNISHING_PRICES = {
    # Beds
    "patient_bed": 3500, "patient_bed_double": 5500, "icu_bed": 12000,
    "surgical_table": 18000, "examination_table": 2800, "recovery_bed": 2200,
    "crib": 900, "stretcher": 1200, "incubator": 22000, "bassinet": 450,
    "dialysis_chair": 3800, "triage_station": 2500, "birthing_bed": 8000,
    "dental_chair": 12000,
    # Seating
    "visitor_chair": 120, "desk_chair": 280, "waiting_bench": 380,
    "stool": 80, "wheelchair_bay": 0, "recliner": 650, "sofa": 900,
    "high_chair": 150, "bench": 250, "chair": 100,
    # Storage
    "wardrobe": 350, "closet": 280, "cabinet": 220, "shelving": 180,
    "medication_cart": 1500, "supply_cart": 450, "locker": 200,
    "filing_cabinet": 280, "linen_cart": 380, "laundry_cart": 320,
    "waste_bin": 35, "biohazard_bin": 85, "sharps_container": 25,
    "crash_cart": 4500, "instrument_trolley": 650, "iv_stand": 180,
    "coat_rack": 120,
    # Equipment
    "ventilator": 25000, "monitor": 4500, "infusion_pump": 3200,
    "anaesthesia_unit": 45000, "defibrillator": 3500, "imaging_unit": 85000,
    "autoclave": 8000, "oxygen_tank": 350, "suction_unit": 1200,
    "ecg_machine": 3500, "ultrasound": 35000, "blood_pressure_unit": 450,
    "pulse_oximeter": 250, "dialysis_machine": 28000, "xray_unit": 95000,
    "ct_scanner": 350000, "mri_scanner": 1200000, "sterilizer": 6500,
    "centrifuge": 4500, "microscope": 3500, "surgical_light": 8500,
    "baby_warmer": 5500, "phototherapy_unit": 3800,
    "printer": 650, "computer": 1200, "server_rack": 5000,
    "projector": 1500, "display_screen": 800, "telephone": 120,
    "intercom": 350, "whiteboard": 180,
    "hvac_unit": 8000, "electrical_panel": 2500, "fire_alarm_panel": 3500,
    "generator": 25000, "ups_unit": 4500, "pump": 2000,
    "elevator_panel": 2000, "access_control": 1500, "cctv_camera": 450,
    # Fixtures
    "sink": 650, "toilet": 450, "shower": 800, "grab_bar": 85,
    "mirror": 120, "hand_sanitizer": 45, "soap_dispenser": 35,
    "paper_towel_dispenser": 55, "water_fountain": 650, "fire_extinguisher": 65,
    "gas_outlet": 0, "nurse_call": 0, "scrub_station": 2500,
    "eyewash_station": 450, "handrail": 180, "baby_changing_station": 350,
    "elevator_mirror": 250,
    # Furniture
    "desk": 450, "bedside_table": 220, "table": 350, "dining_table": 550,
    "conference_table": 1200, "countertop": 800, "reception_desk": 2500,
    "curtain_divider": 280, "room_divider": 450, "bookshelf": 350,
    "sign_board": 150, "notice_board": 180, "podium": 900, "coat_rack": 120,
    # Safety
    "aed": 1800, "first_aid_kit": 65, "emergency_light": 120,
    "exit_sign": 80, "spill_kit": 85, "fire_blanket": 45,
    "evacuation_chair": 650, "oxygen_mask_station": 350,
    # Appliances
    "refrigerator": 650, "microwave": 180, "oven": 1200,
    "coffee_machine": 450, "dishwasher": 800, "water_cooler": 350,
    "ice_machine": 1500, "vending_machine": 3500, "food_trolley": 650,
}

INFRASTRUCTURE_COSTS = {
    "medical_gas_outlet": 2500,
    "nurse_call_install": 1200,
    "plumbing_new_sink": 1800,
    "electrical_upgrade": 3000,
    "data_cabling_point": 800,
    "hvac_modification": 5000,
    "hvac_surgical_grade": 35000,
    "fire_suppression_upgrade": 8000,
}

# Average FTE salary for staffing delta computation
AVG_FTE_SALARY = 55000  # €/year


# ══════════════════════════════════════════════════════════════════════
# Hospital benchmarks — avg % of spaces per function per floor
# ══════════════════════════════════════════════════════════════════════
# Derived from the hospital's own overall distribution.
# These are computed at cache build time from actual data.

_hospital_benchmarks: dict[str, float] = {}  # {function: avg_pct across floors}


def _compute_hospital_benchmarks(floor_groups, intelligence):
    """Compute hospital-wide average function distribution percentages."""
    global _hospital_benchmarks
    fn_totals = defaultdict(int)
    total = 0
    for guid, intel in intelligence.items():
        fn = intel.get("primary_function") or ""
        if fn and fn not in NON_REPURPOSABLE_FUNCTIONS:
            fn_totals[fn] += 1
            total += 1
    _hospital_benchmarks = {
        fn: (count / max(1, total)) * 100
        for fn, count in fn_totals.items()
    }


# ══════════════════════════════════════════════════════════════════════
# Furnishing rule lookup
# ══════════════════════════════════════════════════════════════════════

def _find_furnishing_rule(target_fn: str):
    """Find the matching furnishing rule for a target function."""
    from app.services.furnishings import FUNCTION_FURNISHING_RULES, _matches_any
    for keywords, base_furnishings, options in FUNCTION_FURNISHING_RULES:
        if _matches_any(target_fn, keywords):
            return keywords, base_furnishings, options
    return None, [], {}


def _get_target_furnishings(target_fn: str, area_m2: float) -> list[tuple[str, int]]:
    """Get the complete furnishing list for a target function at a given area."""
    from app.services.furnishings import (
        FUNCTION_FURNISHING_RULES, _matches_any,
        _apply_scaling, FURNISHING_CATALOG,
    )
    ft_footprints = {item[0]: item[3] for item in FURNISHING_CATALOG}

    _, base, options = _find_furnishing_rule(target_fn)
    if not base:
        return []

    scale_rules = options.get("scale", {})
    if scale_rules and area_m2 > 0:
        return _apply_scaling(base, area_m2, scale_rules, ft_footprints)
    return list(base)


# ══════════════════════════════════════════════════════════════════════
# Occupancy estimation
# ══════════════════════════════════════════════════════════════════════

def _estimate_occupancy(target_fn: str, area_m2: float) -> int:
    """Estimate normal occupancy for a target function at given area."""
    from app.services.occupancy import compute_occupancy
    occ = compute_occupancy(target_fn, area_m2, target_fn)
    return occ.get("normal_occupancy", 0)


def _estimate_patient_capacity(target_fn: str, target_furnishings: list) -> int:
    """Estimate patient capacity from target furnishing list."""
    from app.services.furnishings import FURNISHING_CATALOG
    bed_occ = {}
    for item_type, cat, label, fp, n_occ, m_occ in FURNISHING_CATALOG:
        if cat == "bed" and n_occ > 0:
            bed_occ[item_type] = n_occ
    total = 0
    for item_type, qty in target_furnishings:
        if item_type in bed_occ:
            total += qty * bed_occ[item_type]
    return total


# ══════════════════════════════════════════════════════════════════════
# Scoring engine — 6 dimensions
# ══════════════════════════════════════════════════════════════════════

def _score_area_fit(area_m2: float, profile: dict) -> tuple[int, str]:
    """Score how well the room's area matches the target function (0-100).
    Returns (score, reason)."""
    mn, ideal, mx = profile["min_area"], profile["ideal_area"], profile["max_area"]
    if area_m2 < mn:
        score = max(0, int(100 - (mn - area_m2) * 10))
        reason = f"{area_m2:.0f} m² is below minimum {mn} m²"
    elif area_m2 > mx:
        score = max(0, int(100 - (area_m2 - mx) * 3))
        reason = f"{area_m2:.0f} m² exceeds max {mx} m² for this function"
    else:
        deviation = abs(area_m2 - ideal) / max(1, ideal)
        score = max(0, min(100, int(100 * (1 - deviation * 0.5))))
        if abs(area_m2 - ideal) < ideal * 0.15:
            reason = f"{area_m2:.0f} m² is near-ideal ({ideal} m² target)"
        elif area_m2 < ideal:
            reason = f"{area_m2:.0f} m² is below ideal {ideal} m² but within range"
        else:
            reason = f"{area_m2:.0f} m² exceeds ideal {ideal} m², extra space available"
    return score, reason


def _score_distribution_gap(target_fn: str, floor_fn_counts: dict, floor_total: int) -> tuple[int, str]:
    """Score how underrepresented this function is on the floor (0-100).
    Returns (score, reason)."""
    avg_pct = _hospital_benchmarks.get(target_fn, 0)
    current_count = floor_fn_counts.get(target_fn, 0)
    current_pct = (current_count / max(1, floor_total)) * 100
    gap = avg_pct - current_pct  # positive = underserved

    if current_count == 0 and avg_pct > 1:
        score = max(0, min(100, int(85 + gap * 3)))
        reason = f"Floor has 0, hospital avg is {avg_pct:.1f}%, critical gap"
    elif gap > 2:
        score = max(0, min(100, int(65 + gap * 5)))
        reason = f"{current_count} on floor ({current_pct:.1f}%) vs {avg_pct:.1f}% avg, significant shortfall"
    elif gap > 0:
        score = max(0, min(100, int(50 + gap * 5)))
        reason = f"{current_count} on floor, slightly below hospital average"
    else:
        score = max(0, min(100, int(50 + gap * 5)))
        reason = f"{current_count} on floor, at or above hospital average"
    return score, reason


def _score_adjacency(target_fn: str, adjacent_fns: list[str], profile: dict) -> tuple[int, str]:
    """Score synergy/conflict with adjacent spaces (0-100).
    Returns (score, reason)."""
    benefits = sum(1 for f in adjacent_fns if f in profile["adjacency_benefits"])
    conflicts = sum(1 for f in adjacent_fns if f in profile["adjacency_conflicts"])
    score = max(0, min(100, 50 + benefits * 20 - conflicts * 25))
    if benefits > 0 and conflicts == 0:
        reason = f"{benefits} synergistic neighbour(s), strong location fit"
    elif conflicts > 0 and benefits == 0:
        reason = f"{conflicts} conflicting neighbour(s), poor location fit"
    elif benefits > 0 and conflicts > 0:
        reason = f"{benefits} synergy vs {conflicts} conflict, mixed location"
    else:
        reason = "No strong synergy or conflict with neighbours"
    return score, reason


def _score_furnishing_reuse(current_items: set, target_items: set) -> tuple[int, str]:
    """Score how much existing furniture carries over (0-100).
    Returns (score, reason)."""
    overlap = len(current_items & target_items)
    total_needed = len(target_items)
    if total_needed == 0:
        return 50, "No furnishings required for target function"
    pct = int(overlap / total_needed * 100)
    score = min(100, pct)
    if pct >= 80:
        reason = f"{overlap} of {total_needed} items reusable, minimal procurement"
    elif pct >= 40:
        reason = f"{overlap} of {total_needed} items reusable, moderate procurement"
    else:
        reason = f"Only {overlap} of {total_needed} items reusable, significant procurement"
    return score, reason


def _score_cost_efficiency(total_cost: float) -> tuple[int, str]:
    """Score inversely proportional to renovation cost (0-100).
    Returns (score, reason)."""
    max_cost = 50000
    score = max(0, int(100 * (1 - min(total_cost, max_cost) / max_cost)))
    if total_cost < 10000:
        reason = f"EUR {total_cost:,.0f}, low conversion cost"
    elif total_cost < 25000:
        reason = f"EUR {total_cost:,.0f}, moderate conversion cost"
    elif total_cost < 50000:
        reason = f"EUR {total_cost:,.0f}, significant investment required"
    else:
        reason = f"EUR {total_cost:,.0f}, major capital investment"
    return score, reason


# ── Zone compatibility matrix ──
# (target_category, zone_dominant_category) → base score
_ZONE_COMPAT = {
    ("clinical", "clinical"): 90, ("clinical", "public"): 55,
    ("clinical", "support"): 45, ("clinical", "revenue"): 20,
    ("public", "clinical"): 60, ("public", "public"): 85,
    ("public", "support"): 55, ("public", "revenue"): 60,
    ("support", "clinical"): 55, ("support", "public"): 60,
    ("support", "support"): 80, ("support", "revenue"): 55,
    ("revenue", "clinical"): 15, ("revenue", "public"): 65,
    ("revenue", "support"): 45, ("revenue", "revenue"): 85,
}


def _score_zone_fit(
    profile: dict, adjacent_spaces: list[dict],
) -> tuple[int, str]:
    """Score whether the target function fits the surrounding zone (0-100)."""
    if not adjacent_spaces:
        return 50, "No adjacent space data, neutral zone fit"

    target_cat = profile["category"]

    # Count categories of adjacent spaces
    cat_counts: dict[str, int] = defaultdict(int)
    for adj in adjacent_spaces:
        adj_fn = adj.get("primary_function", "")
        adj_prof = FUNCTION_PROFILES.get(adj_fn)
        if adj_prof:
            cat_counts[adj_prof["category"]] += 1
        else:
            # Infer: corridors/elevators/toilets are infrastructure (ignore),
            # everything else is support
            adj_lower = adj_fn.lower()
            if any(k in adj_lower for k in (
                "corridor", "elevator", "staircase", "lobby", "entrance",
                "toilet", "vent", "shaft", "technical", "ramp",
            )):
                continue  # skip infrastructure from zone calc
            else:
                cat_counts["support"] += 1

    total = sum(cat_counts.values())
    if total == 0:
        return 50, "Surrounding zone is all infrastructure, neutral"

    # Dominant category
    dominant_cat = max(cat_counts, key=cat_counts.get)
    dominant_pct = cat_counts[dominant_cat] / total * 100

    base = _ZONE_COMPAT.get((target_cat, dominant_cat), 50)

    # Strengthen/weaken based on how dominant the zone is
    if dominant_pct >= 60:
        score = max(0, min(100, base + 10))
    elif dominant_pct >= 40:
        score = max(0, min(100, base))
    else:
        # Mixed zone — pull towards 50
        score = max(0, min(100, int(base * 0.7 + 50 * 0.3)))

    same_pct = cat_counts.get(target_cat, 0) / total * 100
    if score >= 75:
        reason = f"{dominant_cat} zone ({dominant_pct:.0f}%), strong fit for {target_cat}"
    elif score >= 50:
        reason = f"{dominant_cat} zone, acceptable for {target_cat}"
    elif score >= 30:
        reason = f"{dominant_cat} zone ({dominant_pct:.0f}%), poor fit for {target_cat}"
    else:
        reason = f"{dominant_cat} zone ({dominant_pct:.0f}%), {target_cat} doesn't belong here"
    return score, reason


def _score_infrastructure_readiness(
    current_fn: str, profile: dict,
) -> tuple[int, str]:
    """Score how well existing infrastructure matches target requirements (0-100)."""
    needs_gas = profile.get("requires_medical_gas", False)
    needs_nurse = profile.get("requires_nurse_call", False)
    needs_hvac = profile.get("requires_special_hvac", False)

    # What does the current room likely already have?
    current_profile = FUNCTION_PROFILES.get(current_fn, {})
    current_cat = current_profile.get("category", "support")
    target_cat = profile["category"]
    has_gas = current_profile.get("requires_medical_gas", False)
    has_nurse = current_profile.get("requires_nurse_call", False)
    has_hvac = current_profile.get("requires_special_hvac", False)

    existing = []
    needed = []
    penalty = 0

    # Core clinical systems
    if needs_gas:
        (existing if has_gas else needed).append("medical gas")
    if needs_nurse:
        (existing if has_nurse else needed).append("nurse call")
    if needs_hvac:
        (existing if has_hvac else needed).append("surgical HVAC")

    # Plumbing: clinical/support targets from non-clinical/non-support origins
    needs_plumbing = target_cat in ("clinical", "support")
    had_plumbing = current_cat in ("clinical", "support")
    if needs_plumbing and not had_plumbing:
        needed.append("plumbing")
        penalty += 10

    # Data cabling: clinical/revenue targets from other categories
    needs_data = target_cat in ("clinical", "revenue")
    had_data = current_cat in ("clinical", "revenue")
    if needs_data and not had_data:
        needed.append("data cabling")
        penalty += 8

    # Electrical upgrade: revenue spaces often need more circuits
    if target_cat == "revenue" and current_cat != "revenue":
        needed.append("electrical upgrade")
        penalty += 5

    # Target needs nothing special at all
    if not needs_gas and not needs_nurse and not needs_hvac and penalty == 0:
        return 95, "No specialist infrastructure required"

    # Penalty per missing core system (HVAC is much harder than nurse call)
    for sys in needed:
        if sys == "surgical HVAC":
            penalty += 35
        elif sys == "medical gas":
            penalty += 25
        elif sys == "nurse call":
            penalty += 15
        # plumbing, data cabling, electrical already added above

    # Check if all core systems already present (ignoring secondary needs)
    core_needed = [s for s in needed if s in ("medical gas", "nurse call", "surgical HVAC")]
    if not core_needed and penalty <= 10:
        score = max(0, min(100, 90 - penalty))
        if existing:
            return score, f"Room already has {', '.join(existing)}, minor upgrades only"
        return score, "Minor infrastructure upgrades needed"

    if not core_needed and penalty > 10:
        score = max(0, min(100, 90 - penalty))
        secondary = [s for s in needed if s not in ("medical gas", "nurse call", "surgical HVAC")]
        reason = f"Needs {', '.join(secondary)}"
        if existing:
            reason = f"Has {', '.join(existing)}; {reason}"
        return score, reason

    score = max(0, min(100, 90 - penalty))

    if existing:
        reason = f"Has {', '.join(existing)}; needs {', '.join(needed)}"
    else:
        reason = f"Needs installation: {', '.join(needed)}"
    return score, reason


# ── Regulatory transition scores ──
_CATEGORY_TRANSITIONS = {
    ("clinical", "clinical"): 80, ("clinical", "support"): 70,
    ("clinical", "public"): 60, ("clinical", "revenue"): 40,
    ("public", "public"): 90, ("public", "support"): 80,
    ("public", "clinical"): 35, ("public", "revenue"): 55,
    ("support", "support"): 95, ("support", "public"): 75,
    ("support", "revenue"): 60, ("support", "clinical"): 25,
    ("revenue", "revenue"): 85, ("revenue", "support"): 70,
    ("revenue", "public"): 65, ("revenue", "clinical"): 20,
}


def _score_regulatory_complexity(
    current_fn: str, profile: dict,
) -> tuple[int, str]:
    """Score the regulatory burden of the category transition (0-100)."""
    current_cat = FUNCTION_PROFILES.get(current_fn, {}).get("category", "support")
    target_cat = profile["category"]

    score = _CATEGORY_TRANSITIONS.get((current_cat, target_cat), 50)

    if current_cat == target_cat:
        reason = f"Same category ({target_cat}), minimal regulatory change"
    elif score >= 70:
        reason = f"{current_cat} to {target_cat}, straightforward approval"
    elif score >= 40:
        reason = f"{current_cat} to {target_cat}, moderate regulatory review needed"
    else:
        reason = f"{current_cat} to {target_cat}, extensive compliance review required"
    return score, reason


_NON_REVENUE_VALUE = {
    "Staff": 45,
    "Storage": 35,
    "Waiting Room": 50,
    "Office": 42,
    "Meeting Room": 38,
    "Assembly Room": 40,
    "Locker Room": 32,
}


def _score_revenue_impact(
    area_m2: float, current_fn: str, profile: dict, target_fn: str = "",
) -> tuple[int, str]:
    """Score the financial upside of the conversion (0-100)."""
    current_rev = FUNCTION_PROFILES.get(current_fn, {}).get("revenue_per_m2_year", 0)
    target_rev = profile.get("revenue_per_m2_year", 0)
    delta = (target_rev - current_rev) * area_m2

    if target_rev == 0 and current_rev == 0:
        base = _NON_REVENUE_VALUE.get(target_fn, 40)
        labels = {
            "Staff": "staff wellness value",
            "Storage": "low operational value",
            "Waiting Room": "patient experience value",
            "Office": "admin support value",
            "Meeting Room": "limited operational value",
            "Assembly Room": "occasional use value",
            "Locker Room": "personal convenience value",
        }
        label = labels.get(target_fn, "operational benefit only")
        return base, f"Non-revenue function, {label}"

    if delta > 50000:
        return 100, f"+EUR {delta:,.0f}/yr, major revenue opportunity"
    if delta > 20000:
        return 85, f"+EUR {delta:,.0f}/yr, strong revenue gain"
    if delta > 5000:
        return 70, f"+EUR {delta:,.0f}/yr, moderate revenue uplift"
    if delta > 0:
        return 55, f"+EUR {delta:,.0f}/yr, modest revenue gain"
    if delta == 0 and target_rev > 0:
        return 50, f"EUR {target_rev * area_m2:,.0f}/yr maintained"
    if delta == 0:
        return 40, "No revenue impact"

    # Revenue loss
    loss = abs(delta)
    if loss > 30000:
        return 10, f"-EUR {loss:,.0f}/yr, significant revenue loss"
    return max(15, int(50 - loss / 1000)), f"-EUR {loss:,.0f}/yr, revenue reduction"


def _score_service_continuity(
    current_fn: str, floor_fn_counts: dict,
    hospital_fn_counts: dict | None = None,
) -> tuple[int, str]:
    """Score the risk of removing one instance of current function from the floor (0-100)."""
    current_count = floor_fn_counts.get(current_fn, 0)
    remaining = current_count - 1

    # Hospital-wide context adjustment
    hospital_adj = 0
    hospital_total = (hospital_fn_counts or {}).get(current_fn, 0)
    if hospital_total >= 50:
        hospital_adj = 12
    elif hospital_total >= 20:
        hospital_adj = 8
    elif hospital_total >= 10:
        hospital_adj = 4
    elif hospital_total > 0 and hospital_total < 5:
        hospital_adj = -12

    if current_count <= 1:
        score = max(0, min(100, 15 + hospital_adj))
        suffix = f", {hospital_total} hospital-wide" if hospital_total else ""
        return score, f"Only {current_fn} on floor{suffix}, removal eliminates this function"
    if remaining <= 2:
        pct_loss = round(1 / current_count * 100)
        base = max(25, 60 - pct_loss)
        score = max(0, min(100, base + hospital_adj))
        suffix = f", {hospital_total} hospital-wide" if hospital_total else ""
        return score, f"{current_count} on floor{suffix}, {pct_loss}% reduction, moderate risk"
    if remaining <= 5:
        score = max(0, min(100, 75 + hospital_adj))
        return score, f"{current_count} on floor, manageable reduction"
    score = max(0, min(100, 90 + hospital_adj))
    return score, f"{current_count} on floor, minimal impact"


def _score_patient_flow(
    target_fn: str, profile: dict, adjacent_spaces: list[dict],
    floor_fn_counts: dict, floor_total: int,
) -> tuple[int, str]:
    """Score how this conversion affects patient journey on this floor (0-100)."""
    target_cat = profile["category"]
    is_patient_facing = profile.get("patient_facing", False)

    # Count patient-facing functions among neighbours
    adj_patient_facing = 0
    adj_non_patient = 0
    for adj in adjacent_spaces:
        adj_fn = adj.get("primary_function", "")
        adj_prof = FUNCTION_PROFILES.get(adj_fn)
        if adj_prof and adj_prof.get("patient_facing"):
            adj_patient_facing += 1
        elif adj_prof:
            adj_non_patient += 1

    # Count patient-facing functions on floor
    patient_facing_count = 0
    for fn, count in floor_fn_counts.items():
        fp = FUNCTION_PROFILES.get(fn)
        if fp and fp.get("patient_facing"):
            patient_facing_count += count
    patient_facing_pct = (patient_facing_count / max(1, floor_total)) * 100

    if is_patient_facing:
        # Adding a patient-facing function
        if adj_patient_facing >= 2:
            score = 85
            reason = f"Patient-facing target with {adj_patient_facing} complementary patient spaces nearby"
        elif adj_patient_facing == 1:
            score = 72
            reason = "Patient-facing target adjacent to one other patient-serving space"
        elif patient_facing_pct < 20:
            score = 78
            reason = f"Floor has only {patient_facing_pct:.0f}% patient-facing spaces, this fills a gap"
        else:
            score = 60
            reason = "Patient-facing target, neutral adjacency context"

        # Boost if floor is underserved for patient-facing
        if patient_facing_pct < 15:
            score = min(100, score + 10)
    elif target_cat in ("support", "infrastructure"):
        # Support/infrastructure functions have neutral patient flow impact
        score = 50
        reason = f"Support function, neutral impact on patient flow"
        if adj_patient_facing >= 2:
            # Introducing non-patient function in a patient zone
            score = 38
            reason = f"Non-patient function amid {adj_patient_facing} patient-facing spaces, may disrupt flow"
    else:
        # Revenue or other non-patient-facing
        if adj_patient_facing >= 2:
            score = 35
            reason = f"Non-patient function in a patient-care zone ({adj_patient_facing} patient spaces nearby)"
        else:
            score = 55
            reason = "Non-patient function, minimal patient flow impact"

    return max(0, min(100, score)), reason


def _score_operational_complexity(
    profile: dict, current_fn: str, furnishing_delta: dict, area_m2: float,
) -> tuple[int, str]:
    """Score how disruptive the conversion process itself is (0-100, high = easy)."""
    reno_class = profile.get("renovation_class", "moderate")
    current_profile = FUNCTION_PROFILES.get(current_fn, {})
    current_cat = current_profile.get("category", "support")
    target_cat = profile["category"]

    # Base score from renovation class
    reno_base = {"light": 80, "moderate": 55, "heavy": 30, "structural": 15}
    score = reno_base.get(reno_class, 50)

    reasons = []

    # Furniture change volume penalty
    items_remove = sum(i["quantity"] for i in furnishing_delta["remove"])
    items_add = sum(i["quantity"] for i in furnishing_delta["add"])
    total_changes = items_remove + items_add
    if total_changes > 30:
        score -= 15
        reasons.append(f"{total_changes} furnishing changes")
    elif total_changes > 15:
        score -= 8
        reasons.append(f"{total_changes} furnishing changes")
    elif total_changes > 5:
        score -= 3

    # Area penalty
    if area_m2 > 80:
        score -= 10
        reasons.append(f"large room ({area_m2:.0f} m2)")
    elif area_m2 > 40:
        score -= 5

    # Cross-category penalty
    if current_cat != target_cat:
        score -= 10
        reasons.append(f"cross-category ({current_cat} to {target_cat})")

    # Specialist infrastructure penalty
    has_specialist = profile.get("requires_medical_gas") or profile.get("requires_special_hvac")
    if has_specialist:
        score -= 8
        reasons.append("specialist systems needed")

    score = max(0, min(100, score))

    if score >= 70:
        reason = f"Straightforward conversion, {reno_class} renovation"
    elif score >= 45:
        detail = ", ".join(reasons[:2]) if reasons else "moderate scope"
        reason = f"Moderate complexity, {detail}"
    else:
        detail = ", ".join(reasons[:3]) if reasons else "extensive scope"
        reason = f"Complex conversion, {detail}"

    return score, reason


def _score_utilisation_potential(
    profile: dict, area_m2: float, floor_fn_counts: dict, floor_total: int,
    target_fn: str = "",
) -> tuple[int, str]:
    """Score expected utilisation based on area match and function characteristics (0-100)."""
    ideal = profile.get("ideal_area", 20)
    min_area = profile.get("min_area", 5)
    max_area = profile.get("max_area", 100)

    # Area match factor (0.0 to 1.0)
    if min_area <= area_m2 <= max_area:
        deviation = abs(area_m2 - ideal) / max(1, ideal)
        area_match = max(0.3, 1.0 - deviation * 0.5)
    elif area_m2 < min_area:
        area_match = max(0.1, 1.0 - (min_area - area_m2) / max(1, ideal))
    else:
        area_match = max(0.2, 1.0 - (area_m2 - max_area) / max(1, ideal) * 0.3)

    # Utilisation proxy: revenue potential, staffing, patient-facing
    revenue = profile.get("revenue_per_m2_year", 0)
    staffing = profile.get("staffing_ratio", 0)
    patient_facing = profile.get("patient_facing", False)

    # High-utilisation functions score well
    if revenue > 2000:
        util_factor = 0.9
    elif revenue > 500:
        util_factor = 0.7
    elif patient_facing:
        util_factor = 0.65
    elif staffing > 0.2:
        util_factor = 0.55
    else:
        util_factor = 0.4

    # Low-utilisation functions with excess supply on floor
    low_util_fns = {"Storage", "Locker Room"}
    current_count = floor_fn_counts.get(target_fn, 0)
    if target_fn in low_util_fns and current_count >= 3:
        util_factor *= 0.6  # oversupply reduces expected utilisation

    score = int(area_match * util_factor * 100)
    score = max(0, min(100, score))

    if score >= 75:
        reason = f"Strong utilisation expected, area well-matched at {area_m2:.0f} m2"
    elif score >= 50:
        reason = f"Moderate utilisation expected for {profile.get('label', target_fn)}"
    elif score >= 30:
        reason = f"Below-average utilisation likely, area or function mismatch"
    else:
        reason = f"Low utilisation expected, poor area-function fit"

    return score, reason


SCORE_WEIGHTS = {
    "area_fit": 0.10,
    "distribution_gap": 0.12,
    "adjacency": 0.06,
    "zone_fit": 0.08,
    "infrastructure": 0.10,
    "regulatory": 0.07,
    "furnishing_reuse": 0.04,
    "cost_efficiency": 0.05,
    "revenue_impact": 0.08,
    "service_continuity": 0.08,
    "patient_flow": 0.08,
    "operational_complexity": 0.07,
    "utilisation_potential": 0.07,
}


# ══════════════════════════════════════════════════════════════════════
# Furnishing delta computation
# ══════════════════════════════════════════════════════════════════════

def _compute_furnishing_delta(
    current_furnishings: list,  # [{item_type, quantity, label}]
    target_furnishings: list[tuple[str, int]],
    ft_label_map: dict,
) -> dict:
    """Compute keep/remove/add furnishing changes."""
    current_map = {}  # {item_type: total_qty}
    for f in current_furnishings:
        it = f["item_type"] if isinstance(f, dict) else f.item_type
        qty = f["quantity"] if isinstance(f, dict) else f.quantity
        current_map[it] = current_map.get(it, 0) + qty

    target_map = {}  # {item_type: qty}
    for item_type, qty in target_furnishings:
        target_map[item_type] = target_map.get(item_type, 0) + qty

    all_items = set(current_map.keys()) | set(target_map.keys())

    keep = []
    remove = []
    add = []

    for it in sorted(all_items):
        cur = current_map.get(it, 0)
        tgt = target_map.get(it, 0)
        label = ft_label_map.get(it, it.replace("_", " ").title())
        price = FURNISHING_PRICES.get(it, 200)

        if cur > 0 and tgt > 0:
            kept = min(cur, tgt)
            keep.append({"item_type": it, "quantity": kept, "label": label})
            if cur > tgt:
                remove.append({
                    "item_type": it, "quantity": cur - tgt,
                    "label": label, "unit_cost": price,
                })
            elif tgt > cur:
                add.append({
                    "item_type": it, "quantity": tgt - cur,
                    "label": label, "unit_cost": price,
                })
        elif cur > 0 and tgt == 0:
            remove.append({
                "item_type": it, "quantity": cur,
                "label": label, "unit_cost": price,
            })
        elif tgt > 0 and cur == 0:
            add.append({
                "item_type": it, "quantity": tgt,
                "label": label, "unit_cost": price,
            })

    return {"keep": keep, "remove": remove, "add": add}


# ══════════════════════════════════════════════════════════════════════
# Cost & ROI computation
# ══════════════════════════════════════════════════════════════════════

def _compute_costs(
    area_m2: float,
    current_fn: str,
    target_fn: str,
    profile: dict,
    furnishing_delta: dict,
) -> dict:
    """Compute full cost breakdown for a repurpose option."""
    current_profile = FUNCTION_PROFILES.get(current_fn, {})
    reno = RENOVATION_COSTS[profile.get("renovation_class", "moderate")]

    # Renovation costs
    renovation = {
        "paint_flooring": round(area_m2 * reno["base_per_m2"] * 0.40),
        "ceiling_walls":  round(area_m2 * reno["base_per_m2"] * 0.25),
        "mep_services":   round(area_m2 * reno["base_per_m2"] * 0.35),
    }
    renovation["subtotal"] = sum(renovation.values())

    # Furnishing costs
    removal_count = sum(i["quantity"] for i in furnishing_delta["remove"])
    removal_cost = removal_count * 65
    if removal_count > 10:
        removal_cost = int(removal_cost * 0.7)  # bulk discount

    new_purchase = sum(
        i.get("unit_cost", FURNISHING_PRICES.get(i["item_type"], 200)) * i["quantity"]
        for i in furnishing_delta["add"]
    )
    install_cost = len(furnishing_delta["add"]) * 85

    furnishing = {
        "removal": removal_cost,
        "new_purchase": new_purchase,
        "installation": install_cost,
        "subtotal": removal_cost + new_purchase + install_cost,
    }

    # Infrastructure costs
    infrastructure = {}
    needs_gas = profile.get("requires_medical_gas", False)
    had_gas = current_profile.get("requires_medical_gas", False)
    if needs_gas and not had_gas:
        infrastructure["medical_gas"] = INFRASTRUCTURE_COSTS["medical_gas_outlet"]

    needs_nurse = profile.get("requires_nurse_call", False)
    had_nurse = current_profile.get("requires_nurse_call", False)
    if needs_nurse and not had_nurse:
        infrastructure["nurse_call"] = INFRASTRUCTURE_COSTS["nurse_call_install"]

    if profile.get("requires_special_hvac", False):
        infrastructure["hvac_upgrade"] = INFRASTRUCTURE_COSTS["hvac_surgical_grade"]

    # Add plumbing if target needs sink and current doesn't have one
    needs_plumbing = profile.get("category") in ("clinical", "support")
    had_plumbing = current_profile.get("category") in ("clinical", "support")
    if needs_plumbing and not had_plumbing:
        infrastructure["plumbing"] = INFRASTRUCTURE_COSTS["plumbing_new_sink"]

    # Add data cabling for clinical/revenue spaces coming from non-tech origins
    needs_data = profile.get("category") in ("clinical", "revenue")
    had_data = current_profile.get("category") in ("clinical", "revenue")
    if needs_data and not had_data:
        infrastructure["data_cabling"] = INFRASTRUCTURE_COSTS["data_cabling_point"]

    infrastructure["subtotal"] = sum(
        v for k, v in infrastructure.items() if k != "subtotal"
    )

    # Compliance costs — variable based on category transition
    current_cat = current_profile.get("category", "support")
    target_cat = profile["category"]

    fire_safety = 1500
    accessibility = 800
    infection_control = 0
    permitting = 0
    environmental = 0

    # Clinical targets always need infection control review
    if target_cat == "clinical":
        infection_control = 2200
    # Cross-category transitions need permitting
    if current_cat != target_cat:
        permitting = 1800
        # Heavy transitions need environmental assessment
        transition_score = _CATEGORY_TRANSITIONS.get((current_cat, target_cat), 50)
        if transition_score < 40:
            environmental = 1500

    compliance = {
        "fire_safety_review": fire_safety,
        "accessibility_audit": accessibility,
        "infection_control": infection_control,
        "permitting_fees": permitting,
        "environmental_review": environmental,
        "subtotal": fire_safety + accessibility + infection_control + permitting + environmental,
    }

    total_capex = (
        renovation["subtotal"] + furnishing["subtotal"]
        + infrastructure["subtotal"] + compliance["subtotal"]
    )

    # Professional fees & contingency
    design_fees = round(total_capex * 0.06)
    contingency = round(total_capex * 0.12)

    # Downtime cost (revenue lost during renovation)
    current_revenue = area_m2 * current_profile.get("revenue_per_m2_year", 0)
    avg_days = ((reno["weeks_min"] + reno["weeks_max"]) / 2) * 7
    downtime_cost = round((current_revenue / 365) * avg_days)

    total_project_cost = total_capex + design_fees + contingency + downtime_cost

    return {
        "renovation": renovation,
        "furnishing": furnishing,
        "infrastructure": infrastructure,
        "compliance": compliance,
        "total_capex": total_capex,
        "design_fees": design_fees,
        "contingency": contingency,
        "downtime_cost": downtime_cost,
        "total_project_cost": total_project_cost,
        "cost_per_m2": round(total_project_cost / max(1, area_m2)),
    }


def _compute_roi(
    area_m2: float,
    current_fn: str,
    target_fn: str,
    profile: dict,
    total_capex: float,
    weeks_min: int,
    weeks_max: int,
) -> dict:
    """Compute ROI metrics for a repurpose option."""
    current_profile = FUNCTION_PROFILES.get(current_fn, {})

    current_revenue = area_m2 * current_profile.get("revenue_per_m2_year", 0)
    target_revenue = area_m2 * profile["revenue_per_m2_year"]
    revenue_delta = target_revenue - current_revenue

    current_opex = area_m2 * current_profile.get("operating_cost_m2_year", 60)
    target_opex = area_m2 * profile["operating_cost_m2_year"]
    opex_delta = target_opex - current_opex

    net_annual_delta = revenue_delta - opex_delta

    avg_days = ((weeks_min + weeks_max) / 2) * 7
    daily_revenue_loss = current_revenue / 365
    downtime_cost = round(daily_revenue_loss * avg_days)

    payback_months = None
    roi_5yr_pct = None

    if net_annual_delta > 0:
        monthly_gain = net_annual_delta / 12
        if monthly_gain > 0:
            payback_months = round((total_capex + downtime_cost) / monthly_gain)
        roi_5yr_pct = round(
            ((net_annual_delta * 5) - total_capex - downtime_cost)
            / max(1, total_capex + downtime_cost) * 100
        )
    else:
        roi_5yr_pct = round(
            (net_annual_delta * 5 - total_capex - downtime_cost)
            / max(1, total_capex + downtime_cost) * 100
        )

    # Build narrative
    if net_annual_delta > 0:
        narrative = (
            f"Net annual gain of €{net_annual_delta:,.0f}/year after conversion. "
        )
        if payback_months and payback_months <= 60:
            narrative += (
                f"Investment of €{total_capex:,.0f} pays back in approximately "
                f"{payback_months} months with a 5-year ROI of {roi_5yr_pct}%."
            )
        else:
            narrative += (
                f"Total investment of €{total_capex:,.0f}. "
                f"5-year projected return: {roi_5yr_pct}%."
            )
    elif net_annual_delta == 0:
        narrative = (
            f"Revenue-neutral conversion. Total investment: €{total_capex:,.0f}. "
            f"Operational benefit is non-financial."
        )
    else:
        reason = profile.get("benefit_if_non_revenue") or (
            "Improved operational efficiency and service quality."
        )
        narrative = (
            f"This is a service-quality investment, not a revenue generator. "
            f"The €{total_capex:,.0f} conversion cost "
        )
        if abs(net_annual_delta) > 100:
            narrative += f"plus €{abs(net_annual_delta):,.0f}/year operating cost "
        narrative += f"is offset by: {reason}"

    return {
        "annual_revenue_current": round(current_revenue),
        "annual_revenue_target": round(target_revenue),
        "annual_revenue_delta": round(revenue_delta),
        "annual_opex_current": round(current_opex),
        "annual_opex_target": round(target_opex),
        "annual_opex_delta": round(opex_delta),
        "net_annual_delta": round(net_annual_delta),
        "downtime_cost": downtime_cost,
        "payback_months": payback_months,
        "roi_5yr_pct": roi_5yr_pct,
        "roi_narrative": narrative,
    }


# ══════════════════════════════════════════════════════════════════════
# Service continuity risk assessment
# ══════════════════════════════════════════════════════════════════════

def _assess_service_risk(
    current_fn: str,
    floor_fn_counts: dict,
    floor_total: int,
) -> dict:
    """Assess impact of removing one space of current_fn from the floor."""
    current_count = floor_fn_counts.get(current_fn, 0)
    remaining = current_count - 1

    if current_count <= 1:
        risk = "high"
        assessment = (
            f"This is the only {current_fn} space on this floor. "
            f"Removing it eliminates this function entirely."
        )
    elif remaining <= 2:
        risk = "moderate"
        pct_loss = round(1 / current_count * 100)
        assessment = (
            f"Floor has {current_count} {current_fn} spaces. "
            f"Removing one is a {pct_loss}% reduction, "
            f"only {remaining} would remain."
        )
    else:
        risk = "low"
        assessment = (
            f"Floor has {current_count} {current_fn} spaces. "
            f"Removing one has minimal impact, {remaining} remain."
        )

    return {"risk_level": risk, "assessment": assessment}


# ══════════════════════════════════════════════════════════════════════
# Templated justification builder
# ══════════════════════════════════════════════════════════════════════

ADJACENCY_REASONS = {
    ("Waiting Room", "Patient Care"): "patients can wait closer to their ward",
    ("Waiting Room", "Reception"): "reception staff can manage patient flow directly",
    ("Waiting Room", "Corridor"): "easy wheelchair and stretcher navigation",
    ("Waiting Room", "Toilet"): "sanitary facilities within reach for waiting patients",
    ("Commercial", "Main Hall"): "high foot traffic increases commercial viability",
    ("Commercial", "Waiting Room"): "captive audience increases retail footfall",
    ("Commercial", "Corridor"): "corridor visibility drives impulse visits",
    ("Commercial", "Entrance"): "entrance proximity maximises visitor exposure",
    ("Storage", "Surgery Room"): "surgical supply access without corridor transit",
    ("Storage", "Patient Care"): "bedside supply replenishment is faster",
    ("Office", "Meeting Room"): "staff move easily between desk and meetings",
    ("Office", "Reception"): "admin support close to patient intake",
    ("Office", "Corridor"): "accessible location for interdepartmental coordination",
    ("Reception", "Waiting Room"): "seamless patient check-in to waiting flow",
    ("Reception", "Entrance"): "first point of contact for arriving visitors",
    ("Reception", "Corridor"): "central location for patient wayfinding",
    ("Meeting Room", "Office"): "staff can transition between meetings and work",
    ("Meeting Room", "Corridor"): "accessible for multi-department attendees",
    ("Staff", "Corridor"): "quick access for on-duty staff breaks",
    ("Staff", "Pantry"): "break area with immediate food prep access",
    ("Consultation", "Waiting Room"): "patients move directly from waiting to consult",
    ("Consultation", "Patient Care"): "bedside referrals can reach consultation quickly",
    ("Consultation", "Toilet"): "patients can access facilities during visit",
    ("Patient Care", "Toilet"): "ensuite or nearby sanitary access for patients",
    ("Patient Care", "Corridor"): "corridor access enables staff rounds and patient transport",
    ("Patient Care", "Storage"): "clinical supplies within reach",
    ("Laboratory", "Storage"): "sample and reagent storage nearby",
    ("Laboratory", "Sterilization"): "instrument cycle between lab and sterile processing",
    ("Surgery Room", "Sterilization"): "sterile instruments delivered without corridor exposure",
    ("Surgery Room", "Storage"): "surgical supply staging adjacent to theatre",
    ("Pharmacy", "Waiting Room"): "patients collect prescriptions after consultation",
    ("Pharmacy", "Reception"): "visible from intake for medication queries",
    ("Assembly Room", "Corridor"): "accessible for large group gatherings",
    ("Assembly Room", "Toilet"): "facilities available for event attendees",
    ("Pantry", "Staff"): "meal prep area adjacent to staff break room",
    ("Locker Room", "Staff"): "personal storage adjacent to staff areas",
    ("Locker Room", "Corridor"): "accessible for shift changeovers",
    ("Locker Room", "Toilet"): "changing and hygiene facilities together",
}


def _build_justification(
    space: dict,
    target_fn: str,
    profile: dict,
    scores: dict,
    roi: dict,
    floor_fn_counts: dict,
    floor_total: int,
    adjacent_spaces: list[dict],
    furnishing_delta: dict,
    costs: dict | None = None,
    operational_impact: dict | None = None,
) -> list[str]:
    """Build fully deterministic justification paragraphs from templates."""
    sections = []
    area = space.get("area_m2") or 0
    current_fn = space.get("primary_function", "Unknown")

    # ── Area assessment ──
    if scores["area_fit"] >= 80:
        sections.append(
            f"At {area:.0f} m², this room is well-sized for "
            f"{profile['label']} (ideal range: "
            f"{profile['min_area']}to {profile['max_area']} m²)."
        )
    elif area < profile["ideal_area"]:
        sections.append(
            f"At {area:.0f} m², this room is below the ideal "
            f"{profile['ideal_area']} m² for {profile['label']}, "
            f"but meets the minimum {profile['min_area']} m² requirement."
        )
    else:
        sections.append(
            f"At {area:.0f} m², this room exceeds the typical "
            f"{profile['ideal_area']} m² for {profile['label']}. "
            f"The extra space can accommodate additional furnishings."
        )

    # ── Distribution analysis ──
    avg_pct = _hospital_benchmarks.get(target_fn, 0)
    current_pct = (floor_fn_counts.get(target_fn, 0) / max(1, floor_total)) * 100
    gap = avg_pct - current_pct
    current_count = floor_fn_counts.get(target_fn, 0)

    if gap > 3:
        sections.append(
            f"Floor {space.get('floor_id', '?')} currently has "
            f"{current_count} {target_fn} space(s) "
            f"({current_pct:.1f}% of the floor). "
            f"The hospital average is {avg_pct:.1f}%. "
            f"Adding another {target_fn} here addresses a "
            f"{gap:.1f}% shortfall."
        )
    elif gap > 0:
        sections.append(
            f"Floor {space.get('floor_id', '?')} has "
            f"{current_count} {target_fn} space(s), "
            f"slightly below the hospital average. "
            f"This conversion would improve floor balance."
        )
    else:
        sections.append(
            f"Floor {space.get('floor_id', '?')} has "
            f"{current_count} {target_fn} space(s), "
            f"close to or above the hospital average of {avg_pct:.1f}%. "
            f"This conversion supports capacity but is not urgently needed."
        )

    # ── Zone fit ──
    if scores.get("zone_fit", 0) >= 75:
        sections.append(
            f"The surrounding zone is well-suited for {profile['label']}. "
            f"Neighbouring spaces share a compatible functional category, "
            f"supporting efficient workflows and patient flow."
        )
    elif scores.get("zone_fit", 0) >= 50:
        sections.append(
            f"The surrounding zone is acceptable for {profile['label']}, "
            f"though not an ideal categorical match. "
            f"Operational coordination with adjacent functions may require attention."
        )

    # ── Adjacency context ──
    for adj in adjacent_spaces[:4]:
        adj_fn = adj.get("primary_function", "")
        reason = ADJACENCY_REASONS.get((target_fn, adj_fn))
        if reason:
            sections.append(
                f"Adjacent to {adj.get('space_name', adj_fn)} "
                f"({adj_fn}), so {reason}."
            )
            break  # one adjacency note is enough

    # Check for conflicts
    for adj in adjacent_spaces[:4]:
        adj_fn = adj.get("primary_function", "")
        if adj_fn in profile.get("adjacency_conflicts", []):
            sections.append(
                f"Proximity to {adj.get('space_name', adj_fn)} "
                f"({adj_fn}) may pose operational challenges."
            )
            break

    # ── Infrastructure readiness ──
    infra_score = scores.get("infrastructure", 0)
    if infra_score >= 80:
        sections.append(
            f"Existing MEP infrastructure is largely sufficient for {profile['label']}. "
            f"No major mechanical, electrical, or plumbing upgrades are anticipated."
        )
    elif infra_score >= 50:
        extras = []
        if profile.get("requires_medical_gas"):
            extras.append("medical gas installation")
        if profile.get("requires_special_hvac"):
            extras.append("specialised HVAC upgrade")
        if profile.get("requires_plumbing") and not profile.get("requires_plumbing_existing"):
            extras.append("new plumbing connections")
        if extras:
            sections.append(
                f"Some infrastructure work is needed, including {', '.join(extras)}. "
                f"These are manageable additions within the renovation scope."
            )
        else:
            sections.append(
                f"Moderate infrastructure adaptation is required to support "
                f"{profile['label']} operations."
            )
    else:
        sections.append(
            f"Significant infrastructure upgrades are required for this conversion. "
            f"The current MEP setup does not support {profile['label']} without "
            f"substantial modification."
        )

    # ── Regulatory complexity ──
    reg_score = scores.get("regulatory", 0)
    current_cat = FUNCTION_PROFILES.get(current_fn, {}).get("category", "Support")
    target_cat = profile.get("category", "Support")
    if current_cat == target_cat:
        sections.append(
            f"Both the current function ({current_fn}) and {profile['label']} "
            f"fall under the same category ({target_cat}), minimising regulatory "
            f"requirements and permitting complexity."
        )
    elif reg_score >= 60:
        sections.append(
            f"Converting from {current_cat} to {target_cat} requires a "
            f"straightforward approval process with standard compliance review."
        )
    else:
        sections.append(
            f"The transition from {current_cat} to {target_cat} involves "
            f"an extensive regulatory and compliance review, including "
            f"potential environmental assessments and specialist inspections."
        )

    # ── Furnishing reuse ──
    keep_count = sum(i["quantity"] for i in furnishing_delta["keep"])
    remove_count = sum(i["quantity"] for i in furnishing_delta["remove"])
    add_count = sum(i["quantity"] for i in furnishing_delta["add"])
    total_target = keep_count + add_count
    if total_target > 0:
        reuse_pct = round(keep_count / total_target * 100)
        if reuse_pct >= 50:
            sections.append(
                f"{keep_count} of {total_target} required furnishing items are already "
                f"in place ({reuse_pct}% reuse), reducing procurement costs. "
                f"{remove_count} existing item(s) will be removed or relocated."
            )
        else:
            sections.append(
                f"Only {keep_count} of {total_target} required items can be retained "
                f"({reuse_pct}% reuse). {add_count} new item(s) must be procured "
                f"and {remove_count} existing item(s) removed."
            )

    # ── Cost efficiency ──
    if costs:
        total_project = costs.get("total_project_cost") or costs.get("total_capex", 0)
        cost_m2 = costs.get("cost_per_m2", 0)
        if scores.get("cost_efficiency", 0) >= 75:
            sections.append(
                f"Total project cost of EUR {total_project:,.0f} "
                f"(EUR {cost_m2:,.0f}/m²) represents a cost-efficient conversion "
                f"with limited structural and compliance expenditure."
            )
        elif scores.get("cost_efficiency", 0) >= 50:
            sections.append(
                f"Total project cost of EUR {total_project:,.0f} "
                f"(EUR {cost_m2:,.0f}/m²) is moderate, driven primarily by "
                f"furnishing procurement and MEP adaptation."
            )
        else:
            sections.append(
                f"Total project cost of EUR {total_project:,.0f} "
                f"(EUR {cost_m2:,.0f}/m²) reflects a significant investment, "
                f"largely due to infrastructure and compliance requirements."
            )

    # ── Service continuity ──
    sc_score = scores.get("service_continuity", 0)
    if sc_score >= 75:
        sections.append(
            f"Removing one {current_fn} from this floor has minimal impact on service "
            f"delivery. Sufficient capacity remains to maintain operations."
        )
    elif sc_score >= 40:
        sections.append(
            f"Removing this {current_fn} will moderately reduce floor capacity for "
            f"that function. Coordination with operations is recommended to "
            f"mitigate service disruption."
        )
    else:
        sections.append(
            f"This is one of very few {current_fn} spaces on the floor. "
            f"Removing it poses a notable risk to service continuity and "
            f"should be carefully evaluated against clinical needs."
        )

    # ── Financial summary ──
    if roi["net_annual_delta"] > 0:
        sections.append(
            f"Projected annual revenue increases by "
            f"EUR {roi['annual_revenue_delta']:,.0f}/year "
            f"(from EUR {roi['annual_revenue_current']:,.0f} to "
            f"EUR {roi['annual_revenue_target']:,.0f}). "
        )
        if roi.get("payback_months"):
            sections.append(
                f"The investment pays back in approximately "
                f"{roi['payback_months']} months based on net annual returns."
            )
    elif roi["annual_revenue_target"] == 0 and roi["annual_revenue_current"] == 0:
        benefit = profile.get("benefit_if_non_revenue") or (
            "Improved operational efficiency and service quality."
        )
        sections.append(
            f"Non-revenue function. Operational benefit: {benefit}"
        )
    elif roi["annual_revenue_delta"] < 0:
        sections.append(
            f"Annual revenue decreases by "
            f"EUR {abs(roi['annual_revenue_delta']):,.0f}/year. "
            f"This is offset by operational benefits."
        )

    # ── Staffing impact ──
    if operational_impact and operational_impact.get("staffing"):
        delta_fte = operational_impact["staffing"].get("delta_fte", 0)
        cost_delta = operational_impact["staffing"].get("annual_cost_delta", 0)
        if delta_fte > 0:
            sections.append(
                f"This conversion requires an additional {delta_fte:.1f} FTE, "
                f"adding approximately EUR {cost_delta:,.0f}/year in staffing costs."
            )
        elif delta_fte < 0:
            sections.append(
                f"This conversion reduces staffing by {abs(delta_fte):.1f} FTE, "
                f"saving approximately EUR {abs(cost_delta):,.0f}/year."
            )

    return sections


# ══════════════════════════════════════════════════════════════════════
# Timeline builder
# ══════════════════════════════════════════════════════════════════════

_PHASE_DETAILS = {
    "Clearing & prep": {
        "description": "Prepare the room for renovation by removing loose items and protecting adjacent spaces.",
        "tasks": [
            "Remove existing furnishings and equipment",
            "Install temporary barriers and dust screens",
            "Protect adjacent corridors and rooms from debris",
            "Disconnect non-essential MEP services",
        ],
        "responsible": "Contractor",
    },
    "Clearing & demolition": {
        "description": "Strip the room to its structural shell, removing all existing finishes, partitions, and fixed installations.",
        "tasks": [
            "Remove existing wall and floor finishes",
            "Demolish non-structural partitions",
            "Disconnect and cap MEP services",
            "Dispose of demolition waste per hospital protocol",
            "Asbestos/hazmat survey if building pre-2000",
        ],
        "responsible": "Contractor",
    },
    "Paint & flooring": {
        "description": "Apply new surface finishes to walls, ceilings, and floors to meet the target function's standards.",
        "tasks": [
            "Apply primer and two coats of antimicrobial paint",
            "Install clinical-grade or commercial flooring",
            "Fit baseboard trim and transition strips",
            "Touch-up ceiling tiles or apply ceiling paint",
        ],
        "responsible": "Contractor",
    },
    "MEP rough-in": {
        "description": "Route mechanical, electrical, and plumbing infrastructure to support the new function.",
        "tasks": [
            "Run new electrical circuits and data cabling",
            "Install or modify plumbing connections",
            "Route HVAC ductwork and adjust airflow",
            "Fit fire detection and suppression tie-ins",
            "Rough-in nurse call or intercom wiring if required",
        ],
        "responsible": "MEP Subcontractor",
    },
    "Flooring & finishing": {
        "description": "Complete all interior finishes including floors, walls, ceilings, and paintwork.",
        "tasks": [
            "Install floor covering and skirting",
            "Apply wall finishes and protective rails",
            "Fit ceiling tiles or panels",
            "Final paint coat and edge detailing",
        ],
        "responsible": "Contractor",
    },
    "Structural & MEP": {
        "description": "Major structural modifications and primary MEP routing for complex conversions.",
        "tasks": [
            "Structural wall modifications or reinforcement",
            "Primary electrical and plumbing trunk routing",
            "HVAC main duct installation",
            "Fire stopping and compartmentation work",
            "Structural engineer sign-off on modifications",
        ],
        "responsible": "Structural / MEP Subcontractor",
    },
    "Specialist systems": {
        "description": "Install and commission specialist clinical infrastructure required by the target function.",
        "tasks": [
            "Medical gas pipeline installation and certification",
            "Surgical-grade HVAC commissioning (laminar flow, pressure cascade)",
            "Nurse call system wiring and panel installation",
            "Specialist drainage or waste handling",
        ],
        "responsible": "Specialist Installer",
    },
    "Finishing & fit-out": {
        "description": "Complete interior fit-out including cabinetry, countertops, and fixed equipment mounting.",
        "tasks": [
            "Install built-in cabinetry and countertops",
            "Mount wall-fixed equipment and brackets",
            "Final floor and wall finishing",
            "Signage and wayfinding installation",
        ],
        "responsible": "Fit-out Contractor",
    },
    "Furnishing install": {
        "description": "Deliver, position, and connect all new furniture and movable equipment.",
        "tasks": [
            "Receive and inspect delivered furnishings",
            "Position furniture per approved layout plan",
            "Connect powered equipment and IT peripherals",
            "Verify functionality of all installed items",
        ],
        "responsible": "Procurement / Facilities",
    },
    "Inspection & handover": {
        "description": "Final quality assurance, regulatory sign-off, and handover to operational staff.",
        "tasks": [
            "Fire safety inspection and sign-off",
            "Accessibility compliance verification",
            "Clinical compliance check (if applicable)",
            "Staff walkthrough and orientation session",
            "Formal handover to floor operations",
        ],
        "responsible": "Compliance / Facilities",
    },
    "Inspection & commissioning": {
        "description": "Full systems commissioning, regulatory inspection, and clinical certification for complex conversions.",
        "tasks": [
            "Complete systems commissioning and testing",
            "Regulatory and fire safety inspection",
            "Clinical environment certification",
            "Staff training on specialist equipment",
            "Formal handover with commissioning documentation",
        ],
        "responsible": "Compliance / Clinical Engineering",
    },
}


def _build_timeline(
    profile: dict, furnishing_delta: dict,
    space: dict | None = None, current_fn: str = "",
) -> dict:
    """Build a phased renovation timeline with detailed task descriptions."""
    reno = RENOVATION_COSTS[profile.get("renovation_class", "moderate")]
    w_min = reno["weeks_min"]
    w_max = reno["weeks_max"]

    # Area-based scaling
    area = (space.get("area_m2") or 0) if space else 0
    scale_pct = 0
    if area > 80:
        scale_pct = 40
    elif area > 40:
        scale_pct = 20

    if scale_pct > 0:
        w_min = int(math.ceil(w_min * (1 + scale_pct / 100)))
        w_max = int(math.ceil(w_max * (1 + scale_pct / 100)))

    has_infra = profile.get("requires_medical_gas") or profile.get("requires_special_hvac")
    has_items = len(furnishing_delta["add"]) > 0

    raw_phases: list[tuple[str, str]] = []  # (name, weeks_str)

    if profile["renovation_class"] == "light":
        raw_phases.append(("Clearing & prep", "Week 1"))
        raw_phases.append(("Paint & flooring", f"Week 2 to {max(3, w_max - 2)}"))
        if has_items:
            raw_phases.append(("Furnishing install", f"Week {max(3, w_max - 2)} to {w_max - 1}"))
        raw_phases.append(("Inspection & handover", f"Week {w_max}"))
    elif profile["renovation_class"] == "moderate":
        raw_phases.append(("Clearing & demolition", f"Week 1 to {max(2, w_min // 3)}"))
        raw_phases.append(("MEP rough-in", f"Week {w_min // 3 + 1} to {w_min // 2}"))
        raw_phases.append(("Flooring & finishing", f"Week {w_min // 2 + 1} to {w_max - 3}"))
        if has_items:
            raw_phases.append(("Furnishing install", f"Week {w_max - 3} to {w_max - 1}"))
        raw_phases.append(("Inspection & handover", f"Week {w_max}"))
    else:  # heavy / structural
        raw_phases.append(("Clearing & demolition", f"Week 1 to {w_min // 4}"))
        raw_phases.append(("Structural & MEP", f"Week {w_min // 4 + 1} to {w_min // 2}"))
        if has_infra:
            raw_phases.append(("Specialist systems", f"Week {w_min // 2 + 1} to {w_max * 2 // 3}"))
        raw_phases.append(("Finishing & fit-out", f"Week {w_max * 2 // 3 + 1} to {w_max - 3}"))
        if has_items:
            raw_phases.append(("Furnishing install", f"Week {w_max - 3} to {w_max - 1}"))
        raw_phases.append(("Inspection & commissioning", f"Week {w_max}"))

    phases = []
    for name, weeks_str in raw_phases:
        detail = _PHASE_DETAILS.get(name, {})
        phases.append({
            "name": name,
            "weeks": weeks_str,
            "description": detail.get("description", ""),
            "tasks": detail.get("tasks", []),
            "responsible": detail.get("responsible", ""),
        })

    # Timeline justification reasons
    current_cat = FUNCTION_PROFILES.get(current_fn, {}).get("category", "support")
    target_cat = profile["category"]
    reasons = []
    reasons.append(f"Base duration for {profile['renovation_class']} renovation: {reno['weeks_min']} to {reno['weeks_max']} weeks")
    if area > 40:
        reasons.append(f"Room area of {area:.0f} m2 adds {scale_pct}% to base timeline")
    if current_cat != target_cat:
        reasons.append(f"Cross-category transition ({current_cat} to {target_cat}) requires additional permitting time")
    if has_infra:
        reasons.append("Specialist infrastructure installation extends the schedule")
    if has_items:
        reasons.append(f"Procurement lead time for {len(furnishing_delta['add'])} new furnishing items")

    return {
        "phases": phases,
        "total": f"{w_min} to {w_max} weeks",
        "weeks_min": w_min,
        "weeks_max": w_max,
        "reasons": reasons,
    }


# ══════════════════════════════════════════════════════════════════════
# Main computation — produces one complete option
# ══════════════════════════════════════════════════════════════════════

def _build_option(
    space: dict,
    target_fn: str,
    profile: dict,
    current_furnishings: list,
    floor_fn_counts: dict,
    floor_total: int,
    adjacent_spaces: list[dict],
    ft_label_map: dict,
    hospital_fn_counts: dict | None = None,
) -> dict | None:
    """Build a complete repurpose option for one target function."""
    area = space.get("area_m2") or 0
    current_fn = space.get("primary_function") or ""

    # Skip self
    if target_fn == current_fn:
        return None

    # Skip if area is too small for target
    if area > 0 and area < profile["min_area"]:
        return None

    # Get target furnishings
    target_furnishings = _get_target_furnishings(target_fn, area)
    if not target_furnishings:
        return None

    # Furnishing delta
    furnishing_delta = _compute_furnishing_delta(
        current_furnishings, target_furnishings, ft_label_map
    )

    # Scores
    current_items = set()
    for f in current_furnishings:
        it = f["item_type"] if isinstance(f, dict) else f.item_type
        current_items.add(it)
    target_items = set(it for it, _ in target_furnishings)

    adjacent_fns = [a.get("primary_function", "") for a in adjacent_spaces]
    current_occ = space.get("normal_occupancy", 0) or 0
    target_occ = _estimate_occupancy(target_fn, area)

    # Costs
    costs = _compute_costs(area, current_fn, target_fn, profile, furnishing_delta)

    _raw_scores = {
        "area_fit": _score_area_fit(area, profile),
        "distribution_gap": _score_distribution_gap(target_fn, floor_fn_counts, floor_total),
        "adjacency": _score_adjacency(target_fn, adjacent_fns, profile),
        "zone_fit": _score_zone_fit(profile, adjacent_spaces),
        "infrastructure": _score_infrastructure_readiness(current_fn, profile),
        "regulatory": _score_regulatory_complexity(current_fn, profile),
        "furnishing_reuse": _score_furnishing_reuse(current_items, target_items),
        "cost_efficiency": _score_cost_efficiency(costs["total_capex"]),
        "revenue_impact": _score_revenue_impact(area, current_fn, profile, target_fn=target_fn),
        "service_continuity": _score_service_continuity(
            current_fn, floor_fn_counts, hospital_fn_counts=hospital_fn_counts,
        ),
        "patient_flow": _score_patient_flow(
            target_fn, profile, adjacent_spaces, floor_fn_counts, floor_total,
        ),
        "operational_complexity": _score_operational_complexity(
            profile, current_fn, furnishing_delta, area,
        ),
        "utilisation_potential": _score_utilisation_potential(
            profile, area, floor_fn_counts, floor_total, target_fn=target_fn,
        ),
    }
    scores = {k: v[0] for k, v in _raw_scores.items()}
    score_reasons = {k: v[1] for k, v in _raw_scores.items()}

    overall = int(sum(scores[k] * SCORE_WEIGHTS[k] for k in SCORE_WEIGHTS))

    # ROI
    reno = RENOVATION_COSTS[profile.get("renovation_class", "moderate")]
    roi = _compute_roi(
        area, current_fn, target_fn, profile,
        costs["total_capex"], reno["weeks_min"], reno["weeks_max"],
    )

    # Timeline
    timeline = _build_timeline(profile, furnishing_delta, space=space, current_fn=current_fn)

    # Operational impact
    current_patient_cap = space.get("patient_capacity") or 0
    target_patient_cap = _estimate_patient_capacity(target_fn, target_furnishings)

    current_profile = FUNCTION_PROFILES.get(current_fn, {})
    current_fte = area * current_profile.get("staffing_ratio", 0) / 10
    target_fte = area * profile["staffing_ratio"] / 10

    service_risk = _assess_service_risk(current_fn, floor_fn_counts, floor_total)

    # Care capacity assessment
    if target_patient_cap > current_patient_cap:
        care_assessment = (
            f"Adds {target_patient_cap - current_patient_cap} patient bed(s) "
            f"to Floor {space.get('floor_id', '?')}."
        )
    elif target_patient_cap < current_patient_cap:
        care_assessment = (
            f"Removes {current_patient_cap - target_patient_cap} patient bed(s) "
            f"from Floor {space.get('floor_id', '?')}."
        )
    else:
        care_assessment = "No change to patient bed capacity."

    operational_impact = {
        "care_capacity": {
            "current_beds": current_patient_cap,
            "projected_beds": target_patient_cap,
            "delta": target_patient_cap - current_patient_cap,
            "assessment": care_assessment,
        },
        "staffing": {
            "current_fte": round(current_fte, 1),
            "projected_fte": round(target_fte, 1),
            "delta_fte": round(target_fte - current_fte, 1),
            "annual_cost_delta": round((target_fte - current_fte) * AVG_FTE_SALARY),
        },
        "occupancy": {
            "current": current_occ,
            "projected": target_occ,
            "delta": target_occ - current_occ,
            "current_density": round(current_occ / max(1, area), 2),
            "projected_density": round(target_occ / max(1, area), 2),
        },
        "service_continuity": service_risk,
    }

    # Justification
    justification = _build_justification(
        space, target_fn, profile, scores, roi,
        floor_fn_counts, floor_total, adjacent_spaces, furnishing_delta,
        costs=costs, operational_impact=operational_impact,
    )

    return {
        "target_function": target_fn,
        "target_label": profile["label"],
        "target_category": profile["category"],
        "overall_score": overall,
        "scores": scores,
        "score_reasons": score_reasons,
        "justification": justification,
        "furnishing_delta": furnishing_delta,
        "cost_breakdown": costs,
        "roi": roi,
        "operational_impact": operational_impact,
        "timeline": timeline,
    }


# ══════════════════════════════════════════════════════════════════════
# Public API — called by intelligence_cache at build time
# ══════════════════════════════════════════════════════════════════════

def compute_repurpose_options(
    space: dict,
    current_furnishings: list,
    floor_fn_counts: dict,
    floor_total: int,
    adjacent_spaces: list[dict],
    ft_label_map: dict,
    top_n: int = 4,
    hospital_fn_counts: dict | None = None,
) -> list[dict]:
    """Compute top-N repurpose options for a space.

    All inputs are pre-collected from cache. Returns a list of fully-detailed
    option dicts, sorted by overall_score descending.
    """
    current_fn = space.get("primary_function") or ""
    area = space.get("area_m2") or 0

    if current_fn in NON_REPURPOSABLE_FUNCTIONS:
        return []
    if area < 3:
        return []

    options = []
    for target_fn in REPURPOSE_TARGETS:
        profile = FUNCTION_PROFILES[target_fn]
        opt = _build_option(
            space, target_fn, profile,
            current_furnishings, floor_fn_counts, floor_total,
            adjacent_spaces, ft_label_map,
            hospital_fn_counts=hospital_fn_counts,
        )
        if opt and opt["overall_score"] > 20:
            options.append(opt)

    options.sort(key=lambda o: -o["overall_score"])
    # Add rank
    for i, opt in enumerate(options[:top_n]):
        opt["rank"] = i + 1

    return options[:top_n]

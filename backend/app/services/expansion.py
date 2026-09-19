"""
Commercial Space Expansion Analysis engine for CHIREC Delta Hospital.

When a commercial room is selected, this engine identifies adjacent rooms
that could be absorbed/merged to expand the commercial footprint.  Seven
analysis layers are computed deterministically (no LLM):

    1. Adjacency Detection  - find rooms touching the commercial space
    2. Candidate Scoring     - viability score per adjacent room (12 dims)
    3. Merged-Space Proj.    - combined area, shape, access modelling
    4. Financial Modelling   - costs, revenue uplift, ROI
    5. Construction Intel.   - wall classification, MEP, service continuity,
                               sequencing, interim provisions, risk  (PRIORITY)
    6. Regulatory & Compliance - permits, codes, hospital-specific
    7. Visualization helpers - GUIDs list for floor-plan highlighting

Pre-computed at startup alongside the repurpose cache so API responses
are O(1) dict lookups.
"""

import math
import logging
from collections import defaultdict

from app.services.repurpose import (
    FUNCTION_PROFILES,
    RENOVATION_COSTS,
    FURNISHING_PRICES,
    INFRASTRUCTURE_COSTS,
    NON_REPURPOSABLE_FUNCTIONS,
    AVG_FTE_SALARY,
)
from app.services.geometry import (
    bbox_gap,
    euclidean_distance,
    polygon_area_pct,
    ADJACENCY_THRESHOLD,
)

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Commercial function detection
# ══════════════════════════════════════════════════════════════════════

COMMERCIAL_FUNCTIONS = {
    "Commercial", "Restaurant", "Coffee Bar", "Gift Shop",
    "Pharmacy", "Cafeteria", "Kiosk", "Retail",
    "Shop", "Florist", "Newsstand", "Convenience Store",
}

_COMMERCIAL_KEYWORDS = [
    "commercial", "restaurant", "coffee", "cafe", "cafeteria",
    "gift", "shop", "pharmacy", "kiosk", "retail", "florist",
    "newsstand", "convenience", "bar", "canteen", "bistro",
]


def is_commercial_space(primary_function: str, space_name: str = "") -> bool:
    """Check whether a space qualifies as a commercial/revenue space."""
    if primary_function in COMMERCIAL_FUNCTIONS:
        return True
    combined = f"{primary_function} {space_name}".lower()
    return any(kw in combined for kw in _COMMERCIAL_KEYWORDS)


# ══════════════════════════════════════════════════════════════════════
# Commercial space profiles - revenue/ops fingerprint per sub-type
# ══════════════════════════════════════════════════════════════════════

COMMERCIAL_PROFILES = {
    "Restaurant": {
        "label": "Restaurant / Dining",
        "revenue_per_m2_year": 2400,
        "operating_cost_m2_year": 520,
        "optimal_area_min": 80, "optimal_area_max": 400,
        "revenue_uplift_per_m2": 0.85,  # marginal revenue % of avg
        "seating_density": 1.8,  # m2 per seat
        "kitchen_ratio": 0.30,   # kitchen share of total area
        "peak_hours": "11:30-14:00, 17:30-20:00",
    },
    "Coffee Bar": {
        "label": "Coffee Bar / Cafe",
        "revenue_per_m2_year": 2800,
        "operating_cost_m2_year": 480,
        "optimal_area_min": 25, "optimal_area_max": 120,
        "revenue_uplift_per_m2": 0.90,
        "seating_density": 1.5,
        "kitchen_ratio": 0.20,
        "peak_hours": "07:00-10:00, 14:00-16:00",
    },
    "Gift Shop": {
        "label": "Gift Shop / Retail",
        "revenue_per_m2_year": 1800,
        "operating_cost_m2_year": 350,
        "optimal_area_min": 20, "optimal_area_max": 100,
        "revenue_uplift_per_m2": 0.75,
        "seating_density": 0,
        "kitchen_ratio": 0,
        "peak_hours": "09:00-18:00",
    },
    "Pharmacy": {
        "label": "Pharmacy",
        "revenue_per_m2_year": 3200,
        "operating_cost_m2_year": 650,
        "optimal_area_min": 30, "optimal_area_max": 120,
        "revenue_uplift_per_m2": 0.70,
        "seating_density": 0,
        "kitchen_ratio": 0,
        "peak_hours": "08:00-20:00",
    },
    "Commercial": {
        "label": "Commercial / Retail",
        "revenue_per_m2_year": 1800,
        "operating_cost_m2_year": 350,
        "optimal_area_min": 15, "optimal_area_max": 300,
        "revenue_uplift_per_m2": 0.80,
        "seating_density": 0,
        "kitchen_ratio": 0,
        "peak_hours": "08:00-20:00",
    },
}

def _get_commercial_profile(fn: str) -> dict:
    """Look up the commercial profile for a function, fallback to generic."""
    if fn in COMMERCIAL_PROFILES:
        return COMMERCIAL_PROFILES[fn]
    fn_lower = fn.lower()
    for key, profile in COMMERCIAL_PROFILES.items():
        if key.lower() in fn_lower:
            return profile
    return COMMERCIAL_PROFILES["Commercial"]


# ══════════════════════════════════════════════════════════════════════
# Wall classification system (Layer 5 - Construction Intelligence)
# ══════════════════════════════════════════════════════════════════════

# Structural inference: functions that typically have load-bearing walls
_STRUCTURAL_FUNCTIONS = {
    "Elevator", "Staircase", "Staircasse", "Main Hall", "Atrium",
    "Ventilation Shaft", "Technical", "Ramp",
}

# Functions that almost always have lightweight/partition walls
_PARTITION_FUNCTIONS = {
    "Office", "Meeting Room", "Storage", "Staff", "Locker Room",
    "Waiting Room", "Reception", "Pantry",
}

# Wall thickness estimates (metres) by classification
WALL_CLASSIFICATIONS = {
    "load_bearing": {
        "label": "Load-Bearing",
        "typical_thickness_m": 0.30,
        "removable": False,
        "cost_to_modify": 18000,  # per linear metre
        "structural_engineer_required": True,
        "shoring_required": True,
        "risk_level": "high",
        "description": (
            "Reinforced concrete or masonry wall carrying floor/roof loads. "
            "Cannot be removed without structural engineer assessment, "
            "temporary shoring, and steel beam installation."
        ),
    },
    "partition_masonry": {
        "label": "Masonry Partition",
        "typical_thickness_m": 0.15,
        "removable": True,
        "cost_to_modify": 3500,
        "structural_engineer_required": False,
        "shoring_required": False,
        "risk_level": "low",
        "description": (
            "Non-load-bearing masonry block or brick partition. "
            "Can be removed with standard demolition, requires only "
            "fire stopping remediation and surface finishing."
        ),
    },
    "partition_drywall": {
        "label": "Drywall / Stud Partition",
        "typical_thickness_m": 0.10,
        "removable": True,
        "cost_to_modify": 1200,
        "structural_engineer_required": False,
        "shoring_required": False,
        "risk_level": "very_low",
        "description": (
            "Metal-stud and plasterboard partition wall. Fastest and "
            "cheapest to remove. Typically found between offices, "
            "meeting rooms, and storage areas."
        ),
    },
    "fire_rated": {
        "label": "Fire-Rated Partition",
        "typical_thickness_m": 0.20,
        "removable": True,
        "cost_to_modify": 8500,
        "structural_engineer_required": False,
        "shoring_required": False,
        "risk_level": "medium",
        "description": (
            "Fire compartment boundary wall (typically 60 or 120 min rated). "
            "Removal requires fire engineer sign-off, revised compartmentation "
            "drawings, and compensatory fire protection measures."
        ),
    },
    "wet_wall": {
        "label": "Wet Wall (Services)",
        "typical_thickness_m": 0.20,
        "removable": True,
        "cost_to_modify": 6500,
        "structural_engineer_required": False,
        "shoring_required": False,
        "risk_level": "medium",
        "description": (
            "Wall containing plumbing risers, waste pipes, or drainage. "
            "Can be removed but requires rerouting of services, capping "
            "of redundant pipes, and pressure testing."
        ),
    },
}


def _classify_shared_wall(
    commercial_fn: str,
    candidate_fn: str,
    candidate_space_name: str = "",
) -> dict:
    """Infer wall type between commercial space and candidate room.

    Uses function-based heuristics since we don't have BIM wall data.
    Returns a wall classification dict with properties.
    """
    # Infrastructure rooms almost always share structural walls
    if candidate_fn in _STRUCTURAL_FUNCTIONS:
        return {**WALL_CLASSIFICATIONS["load_bearing"], "classification": "load_bearing"}

    # Toilets, pantries, labs have wet walls
    wet_keywords = ["toilet", "wc", "shower", "bath", "pantry", "kitchen", "lab"]
    combined_lower = f"{candidate_fn} {candidate_space_name}".lower()
    if any(kw in combined_lower for kw in wet_keywords):
        return {**WALL_CLASSIFICATIONS["wet_wall"], "classification": "wet_wall"}

    # Clinical spaces typically have fire-rated compartmentation
    candidate_profile = FUNCTION_PROFILES.get(candidate_fn, {})
    candidate_cat = candidate_profile.get("category", "support")
    commercial_cat = FUNCTION_PROFILES.get(commercial_fn, {}).get("category", "revenue")

    # Different fire compartments if crossing categories
    if candidate_cat == "clinical":
        return {**WALL_CLASSIFICATIONS["fire_rated"], "classification": "fire_rated"}

    # Partition functions
    if candidate_fn in _PARTITION_FUNCTIONS:
        return {**WALL_CLASSIFICATIONS["partition_drywall"], "classification": "partition_drywall"}

    # Default: masonry partition
    return {**WALL_CLASSIFICATIONS["partition_masonry"], "classification": "partition_masonry"}


# ══════════════════════════════════════════════════════════════════════
# MEP Impact Analysis (Layer 5)
# ══════════════════════════════════════════════════════════════════════

MEP_SYSTEMS = {
    "hvac": {
        "label": "HVAC / Climate Control",
        "icon": "thermometer",
        "reroute_cost_base": 4500,
        "reroute_per_m2": 65,
        "description": "Heating, ventilation, and air conditioning ductwork and controls",
    },
    "electrical": {
        "label": "Electrical Distribution",
        "icon": "zap",
        "reroute_cost_base": 2800,
        "reroute_per_m2": 45,
        "description": "Power circuits, lighting, panel boards, and emergency power",
    },
    "plumbing": {
        "label": "Plumbing & Drainage",
        "icon": "droplet",
        "reroute_cost_base": 3500,
        "reroute_per_m2": 55,
        "description": "Water supply, waste, and drainage lines",
    },
    "fire_suppression": {
        "label": "Fire Suppression",
        "icon": "shield",
        "reroute_cost_base": 2200,
        "reroute_per_m2": 35,
        "description": "Sprinkler heads, fire detection, alarm circuits",
    },
    "medical_gas": {
        "label": "Medical Gas",
        "icon": "wind",
        "reroute_cost_base": 5000,
        "reroute_per_m2": 80,
        "description": "Piped O2, vacuum, N2O, and medical air supply",
    },
    "data_network": {
        "label": "Data & Communications",
        "icon": "wifi",
        "reroute_cost_base": 1500,
        "reroute_per_m2": 25,
        "description": "Cat6A cabling, nurse call, BMS, and WiFi infrastructure",
    },
    "nurse_call": {
        "label": "Nurse Call System",
        "icon": "bell",
        "reroute_cost_base": 1200,
        "reroute_per_m2": 20,
        "description": "Patient call buttons, corridor lights, staff pagers",
    },
}


def _assess_mep_impact(
    candidate_fn: str,
    candidate_area: float,
    wall_class: dict,
) -> dict:
    """Assess MEP systems that may be impacted by absorbing a candidate room.

    Returns dict with affected systems, rerouting costs, and complexity rating.
    """
    candidate_profile = FUNCTION_PROFILES.get(candidate_fn, {})
    candidate_cat = candidate_profile.get("category", "support")

    affected = []
    total_reroute_cost = 0

    # HVAC: always affected (merged space needs rezoning)
    hvac_cost = MEP_SYSTEMS["hvac"]["reroute_cost_base"] + round(
        MEP_SYSTEMS["hvac"]["reroute_per_m2"] * candidate_area
    )
    affected.append({
        **MEP_SYSTEMS["hvac"],
        "impact": "high",
        "reroute_cost": hvac_cost,
        "action": (
            "Merged space requires HVAC zone recalculation. Existing ductwork "
            "in the dividing wall must be rerouted or sealed. Capacity assessment "
            "needed for the combined area."
        ),
    })
    total_reroute_cost += hvac_cost

    # Electrical: always affected
    elec_cost = MEP_SYSTEMS["electrical"]["reroute_cost_base"] + round(
        MEP_SYSTEMS["electrical"]["reroute_per_m2"] * candidate_area
    )
    elec_impact = "high" if candidate_cat == "clinical" else "medium"
    affected.append({
        **MEP_SYSTEMS["electrical"],
        "impact": elec_impact,
        "reroute_cost": elec_cost,
        "action": (
            f"Electrical circuits from {candidate_fn} must be consolidated or "
            f"rerouted to the commercial space panel. "
            f"{'Clinical-grade isolation may need removal. ' if candidate_cat == 'clinical' else ''}"
            f"Lighting circuit merge required."
        ),
    })
    total_reroute_cost += elec_cost

    # Fire suppression: always affected when removing a wall
    fire_cost = MEP_SYSTEMS["fire_suppression"]["reroute_cost_base"] + round(
        MEP_SYSTEMS["fire_suppression"]["reroute_per_m2"] * candidate_area
    )
    affected.append({
        **MEP_SYSTEMS["fire_suppression"],
        "impact": "high" if wall_class.get("classification") == "fire_rated" else "medium",
        "reroute_cost": fire_cost,
        "action": (
            "Sprinkler head positions must be recalculated for merged ceiling area. "
            "Fire detection zones must be updated in the BMS. "
            f"{'Fire compartment boundary requires compensatory measures. ' if wall_class.get('classification') == 'fire_rated' else ''}"
            "Emergency lighting coverage review required."
        ),
    })
    total_reroute_cost += fire_cost

    # Data network: always affected
    data_cost = MEP_SYSTEMS["data_network"]["reroute_cost_base"] + round(
        MEP_SYSTEMS["data_network"]["reroute_per_m2"] * candidate_area
    )
    affected.append({
        **MEP_SYSTEMS["data_network"],
        "impact": "low",
        "reroute_cost": data_cost,
        "action": (
            "Data points from absorbed room to be decommissioned or repurposed. "
            "WiFi coverage reassessment for expanded footprint."
        ),
    })
    total_reroute_cost += data_cost

    # Plumbing: only if candidate has wet services
    wet_fns = {"Toilet", "Pantry", "Laboratory", "Sterilization", "Patient Care"}
    if candidate_fn in wet_fns or wall_class.get("classification") == "wet_wall":
        plumb_cost = MEP_SYSTEMS["plumbing"]["reroute_cost_base"] + round(
            MEP_SYSTEMS["plumbing"]["reroute_per_m2"] * candidate_area
        )
        affected.append({
            **MEP_SYSTEMS["plumbing"],
            "impact": "high",
            "reroute_cost": plumb_cost,
            "action": (
                f"Plumbing services in {candidate_fn} must be capped, rerouted, "
                f"or incorporated. Waste pipes require proper disconnection. "
                f"Pressure testing mandatory after modification."
            ),
        })
        total_reroute_cost += plumb_cost

    # Medical gas: only if candidate is clinical
    if candidate_profile.get("requires_medical_gas"):
        gas_cost = MEP_SYSTEMS["medical_gas"]["reroute_cost_base"] + round(
            MEP_SYSTEMS["medical_gas"]["reroute_per_m2"] * candidate_area
        )
        affected.append({
            **MEP_SYSTEMS["medical_gas"],
            "impact": "critical",
            "reroute_cost": gas_cost,
            "action": (
                "Medical gas outlets must be safely decommissioned by certified "
                "installer. Gas lines capped and tested. Zone valve configuration "
                "may need updating."
            ),
        })
        total_reroute_cost += gas_cost

    # Nurse call: only if candidate has it
    if candidate_profile.get("requires_nurse_call"):
        nc_cost = MEP_SYSTEMS["nurse_call"]["reroute_cost_base"] + round(
            MEP_SYSTEMS["nurse_call"]["reroute_per_m2"] * candidate_area
        )
        affected.append({
            **MEP_SYSTEMS["nurse_call"],
            "impact": "medium",
            "reroute_cost": nc_cost,
            "action": (
                "Nurse call points to be decommissioned and removed from "
                "the central panel. Corridor indicator lights to be removed."
            ),
        })
        total_reroute_cost += nc_cost

    # Complexity rating
    high_count = sum(1 for s in affected if s["impact"] in ("high", "critical"))
    if high_count >= 3:
        complexity = "high"
        complexity_narrative = (
            f"{high_count} high-impact MEP systems affected. Requires phased "
            f"shutdown coordination and specialist subcontractors for each system."
        )
    elif high_count >= 1:
        complexity = "medium"
        complexity_narrative = (
            f"{high_count} high-impact system(s) alongside standard rerouting. "
            f"Coordinated shutdown scheduling recommended."
        )
    else:
        complexity = "low"
        complexity_narrative = (
            "No critical MEP conflicts. Standard rerouting with minimal "
            "service disruption expected."
        )

    return {
        "affected_systems": affected,
        "total_reroute_cost": total_reroute_cost,
        "complexity": complexity,
        "complexity_narrative": complexity_narrative,
        "system_count": len(affected),
    }


# ══════════════════════════════════════════════════════════════════════
# Service Continuity Planning (Layer 5)
# ══════════════════════════════════════════════════════════════════════

def _plan_service_continuity(
    commercial_fn: str,
    commercial_area: float,
    candidate_fn: str,
    candidate_area: float,
    floor_fn_counts: dict,
    wall_class: dict,
) -> dict:
    """Plan how to maintain services during expansion construction.

    Considers both the commercial space's operational continuity and
    the impact of removing the candidate room from service.
    """
    candidate_profile = FUNCTION_PROFILES.get(candidate_fn, {})
    candidate_cat = candidate_profile.get("category", "support")
    is_patient_facing = candidate_profile.get("patient_facing", False)
    floor_count = floor_fn_counts.get(candidate_fn, 0)
    remaining = floor_count - 1

    # Commercial space continuity
    wall_removable = wall_class.get("removable", True)
    reno_class = wall_class.get("risk_level", "low")

    if wall_removable and reno_class in ("very_low", "low"):
        commercial_downtime_weeks = 2
        partial_operation = True
        commercial_strategy = (
            "Phased construction allows the commercial space to remain partially "
            "operational. Temporary hoarding divides the active zone from the "
            "construction area. Evening/weekend demolition recommended."
        )
    elif wall_removable:
        commercial_downtime_weeks = 4
        partial_operation = True
        commercial_strategy = (
            "Commercial space requires temporary closure of the expansion zone "
            "during wall removal and MEP rerouting. Core operations can continue "
            "in the existing footprint with reduced capacity."
        )
    else:
        commercial_downtime_weeks = 8
        partial_operation = False
        commercial_strategy = (
            "Load-bearing wall modification requires full commercial space closure. "
            "Temporary shoring installation affects the entire ceiling zone. "
            "Alternative service provision must be arranged."
        )

    # Candidate room impact
    if candidate_fn in NON_REPURPOSABLE_FUNCTIONS:
        candidate_impact = "critical"
        candidate_strategy = (
            f"Cannot absorb {candidate_fn} - this is essential infrastructure."
        )
        relocation_required = False
        relocation_cost = 0
    elif is_patient_facing and remaining <= 1:
        candidate_impact = "high"
        candidate_strategy = (
            f"Removing {candidate_fn} leaves only {remaining} on this floor. "
            f"Temporary relocation to an adjacent floor is mandatory. "
            f"Patient scheduling must be coordinated hospital-wide."
        )
        relocation_required = True
        relocation_cost = round(2500 + candidate_area * 20)
    elif is_patient_facing:
        candidate_impact = "moderate"
        candidate_strategy = (
            f"Floor has {floor_count} {candidate_fn} spaces. "
            f"Workload redistribution across remaining {remaining} spaces "
            f"during construction. Schedule adjustment needed."
        )
        relocation_required = False
        relocation_cost = round(800 + candidate_area * 8)
    elif remaining == 0:
        candidate_impact = "moderate"
        candidate_strategy = (
            f"This is the only {candidate_fn} on the floor. "
            f"Function must be temporarily relocated or suspended."
        )
        relocation_required = True
        relocation_cost = round(1500 + candidate_area * 12)
    else:
        candidate_impact = "low"
        candidate_strategy = (
            f"Floor has {floor_count} {candidate_fn} spaces. "
            f"Losing one has minimal operational impact. "
            f"Existing capacity absorbs the workload."
        )
        relocation_required = False
        relocation_cost = 0

    # Interim provisions
    interim_provisions = []

    # Temporary food service if restaurant is affected
    if commercial_fn.lower() in ("restaurant", "cafeteria", "canteen"):
        interim_provisions.append({
            "provision": "Temporary food service",
            "description": (
                "Mobile food cart or temporary serving station in the main hall "
                "during construction. Maintains staff and visitor meal access."
            ),
            "estimated_cost": 3500,
            "duration_weeks": commercial_downtime_weeks,
        })

    # Dust/noise containment
    interim_provisions.append({
        "provision": "Dust and noise containment",
        "description": (
            "HEPA-filtered negative pressure enclosure around construction zone. "
            "Critical in hospital environment to prevent airborne contamination. "
            "Includes temporary walls, air scrubbers, and vibration dampeners."
        ),
        "estimated_cost": round(1800 + candidate_area * 25),
        "duration_weeks": commercial_downtime_weeks,
    })

    # Temporary wayfinding
    interim_provisions.append({
        "provision": "Temporary wayfinding and signage",
        "description": (
            "Redirectional signage for visitors and patients around the "
            "construction zone. Digital display updates and staff communication."
        ),
        "estimated_cost": 650,
        "duration_weeks": commercial_downtime_weeks,
    })

    # Patient/visitor flow management if near clinical areas
    if candidate_cat == "clinical":
        interim_provisions.append({
            "provision": "Patient flow management",
            "description": (
                "Temporary patient routing around the construction zone. "
                "Dedicated escort staff during peak hours. "
                "Emergency egress path verification and marking."
            ),
            "estimated_cost": round(1200 + commercial_downtime_weeks * 400),
            "duration_weeks": commercial_downtime_weeks,
        })

    # Security/access control
    interim_provisions.append({
        "provision": "Construction zone access control",
        "description": (
            "Temporary badge access barriers, CCTV coverage of construction "
            "perimeter, and contractor check-in/out protocol."
        ),
        "estimated_cost": 800,
        "duration_weeks": commercial_downtime_weeks,
    })

    interim_total = sum(p["estimated_cost"] for p in interim_provisions)

    return {
        "commercial_continuity": {
            "downtime_weeks": commercial_downtime_weeks,
            "partial_operation": partial_operation,
            "strategy": commercial_strategy,
        },
        "candidate_impact": {
            "impact_level": candidate_impact,
            "strategy": candidate_strategy,
            "floor_count": floor_count,
            "remaining_after": remaining,
            "relocation_required": relocation_required,
            "relocation_cost": relocation_cost,
        },
        "interim_provisions": interim_provisions,
        "interim_total_cost": interim_total,
    }


# ══════════════════════════════════════════════════════════════════════
# Construction Sequencing (Layer 5)
# ══════════════════════════════════════════════════════════════════════

def _build_construction_sequence(
    candidate_area: float,
    wall_class: dict,
    mep_impact: dict,
    service_plan: dict,
) -> dict:
    """Build a phased construction sequence with dependency graph.

    Returns phases, critical path, and scheduling constraints.
    """
    wall_type = wall_class.get("classification", "partition_masonry")
    downtime = service_plan["commercial_continuity"]["downtime_weeks"]

    phases = []

    # Phase 0: Pre-construction
    preconstruction_weeks = 2
    if wall_type == "load_bearing":
        preconstruction_weeks = 4
    phases.append({
        "phase": 0,
        "name": "Pre-Construction & Permits",
        "duration_weeks": preconstruction_weeks,
        "parallel": False,
        "tasks": [
            "Structural survey and wall classification confirmation",
            "Building permit application and approval",
            "Fire engineer compartmentation review",
            "MEP shutdown scheduling with hospital operations",
            "Contractor mobilisation and site compound setup",
            "Infection control risk assessment (ICRA) sign-off",
        ],
        "dependencies": [],
        "decision_gate": (
            "Proceed/hold decision: structural survey results must confirm "
            "wall classification assumptions. Fire engineer must approve "
            "revised compartmentation before demolition begins."
        ),
        "hospital_constraints": (
            "All permit applications must be routed through CHIREC Facilities "
            "Management. ICRA committee meets bi-weekly - allow lead time."
        ),
    })

    # Phase 1: Candidate room strip-out
    strip_weeks = 1 if candidate_area < 30 else 2
    phases.append({
        "phase": 1,
        "name": "Room Strip-Out & Service Isolation",
        "duration_weeks": strip_weeks,
        "parallel": False,
        "tasks": [
            f"Relocate {service_plan['candidate_impact'].get('floor_count', 0)} occupants/services from candidate room",
            "Furniture and equipment removal to temporary storage",
            "MEP service isolation (valve/breaker lockout)",
            "Hazardous material survey (asbestos, lead paint)",
            "Temporary hoarding and dust containment installation",
            "Negative pressure air handling activation",
        ],
        "dependencies": [0],
        "decision_gate": (
            "Hazmat survey results must be clear before demolition. "
            "Any positive findings trigger remediation sub-phase."
        ),
        "hospital_constraints": (
            "Furniture removal via service corridors only - no patient corridor "
            "transit. Evening/night shift scheduling preferred."
        ),
    })

    # Phase 2: Wall demolition
    if wall_type == "load_bearing":
        demo_weeks = 4
        demo_tasks = [
            "Temporary shoring installation (props and needles)",
            "Structural engineer on-site supervision",
            "Controlled wall demolition in sections",
            "Steel beam (RSJ/UB) installation for load transfer",
            "Shoring removal after beam certification",
            "Structural sign-off and documentation",
        ]
    elif wall_type == "fire_rated":
        demo_weeks = 2
        demo_tasks = [
            "Fire stopping removal and documentation",
            "Wall demolition with dust containment",
            "Fire compartment boundary remediation",
            "Compensatory fire protection installation",
            "Fire engineer inspection and sign-off",
            "Updated compartmentation drawings",
        ]
    elif wall_type == "wet_wall":
        demo_weeks = 2
        demo_tasks = [
            "Service isolation and pipe capping",
            "Careful demolition preserving service runs",
            "Pipe rerouting and new connections",
            "Pressure testing of modified pipework",
            "Wall removal and opening creation",
            "Surface finishing and waterproofing",
        ]
    else:
        demo_weeks = 1
        demo_tasks = [
            "Partition wall demolition",
            "Service rerouting (if any in wall cavity)",
            "Opening creation and edge finishing",
            "Debris removal and floor levelling",
            "Dust suppression and air quality check",
        ]

    phases.append({
        "phase": 2,
        "name": "Wall Demolition & Opening",
        "duration_weeks": demo_weeks,
        "parallel": False,
        "tasks": demo_tasks,
        "dependencies": [1],
        "decision_gate": (
            "Structural integrity confirmed before proceeding to MEP works. "
            "Air quality monitoring must show safe levels."
        ),
        "hospital_constraints": (
            "Demolition work restricted to 07:00-19:00. Vibration monitoring "
            "mandatory if adjacent clinical spaces are operational. "
            "Noise levels must not exceed 75 dB at nearest patient area."
        ),
    })

    # Phase 3: MEP Integration
    mep_weeks = 2
    high_impact = sum(1 for s in mep_impact["affected_systems"] if s["impact"] in ("high", "critical"))
    if high_impact >= 3:
        mep_weeks = 4
    elif high_impact >= 1:
        mep_weeks = 3

    mep_tasks = [
        "Combined HVAC zone design and ductwork installation",
        "Electrical circuit consolidation and new distribution",
        "Fire detection and suppression reconfiguration",
        "Data and communications infrastructure merge",
    ]
    for sys in mep_impact["affected_systems"]:
        if sys["impact"] == "critical":
            mep_tasks.append(f"Critical: {sys['label']} - {sys['action']}")

    phases.append({
        "phase": 3,
        "name": "MEP Integration & Services",
        "duration_weeks": mep_weeks,
        "parallel": False,
        "tasks": mep_tasks,
        "dependencies": [2],
        "decision_gate": (
            "All MEP modifications must be tested and certified before "
            "fit-out begins. Pressure tests, continuity checks, and "
            "BMS integration verification required."
        ),
        "hospital_constraints": (
            "HVAC shutdown windows limited to 2 hours max during occupied hours. "
            "Electrical work on hospital ring main requires planned outage notification. "
            "Medical gas work requires certified installer and zone valve isolation."
        ),
    })

    # Phase 4: Fit-out
    fitout_weeks = 2 if candidate_area < 40 else 3
    phases.append({
        "phase": 4,
        "name": "Fit-Out & Interior Works",
        "duration_weeks": fitout_weeks,
        "parallel": True,  # Can overlap with tail end of MEP
        "tasks": [
            "Floor levelling and finish installation (commercial grade)",
            "Ceiling grid and tile installation for combined space",
            "Wall finishing, painting, and branding",
            "Commercial fixtures and furniture installation",
            "Point-of-sale and IT equipment setup",
            "Signage and wayfinding updates",
        ],
        "dependencies": [3],
        "decision_gate": None,
        "hospital_constraints": (
            "VOC-free paints and adhesives mandatory. "
            "Deliveries via loading dock only, scheduled with logistics."
        ),
    })

    # Phase 5: Commissioning
    commission_weeks = 1
    phases.append({
        "phase": 5,
        "name": "Testing, Commissioning & Handover",
        "duration_weeks": commission_weeks,
        "parallel": False,
        "tasks": [
            "HVAC balancing and commissioning for merged zone",
            "Electrical safety testing and certification",
            "Fire alarm and sprinkler system testing",
            "Fire compartmentation sign-off",
            "Infection control deep clean",
            "Snagging walk-through and defects list",
            "As-built documentation and BIM model update",
            "Staff orientation and operational handover",
            "Occupation certificate application",
        ],
        "dependencies": [4],
        "decision_gate": (
            "All testing certificates must be complete before occupation. "
            "Fire safety certificate is the critical-path document."
        ),
        "hospital_constraints": (
            "Occupation certificate required from commune before public use. "
            "Health authority notification for expanded commercial area."
        ),
    })

    # Calculate critical path
    total_weeks = sum(p["duration_weeks"] for p in phases)
    # Phase 4 can overlap with phase 3 by 1 week
    if any(p.get("parallel") for p in phases):
        total_weeks -= 1

    # Night/weekend work recommendation
    night_work = wall_type in ("load_bearing", "fire_rated") or high_impact >= 2
    weekend_work = candidate_area > 40 or wall_type == "load_bearing"

    return {
        "phases": phases,
        "total_weeks": total_weeks,
        "critical_path": [
            "Permits", "Strip-out", "Demolition",
            "MEP Integration", "Fire Certification",
        ],
        "parallel_opportunities": (
            "Fit-out can begin before MEP completion in non-service areas. "
            "Furniture procurement should start during Phase 1."
        ),
        "scheduling": {
            "night_work_recommended": night_work,
            "night_work_reason": (
                "Demolition and heavy MEP work should be scheduled outside "
                "clinical hours to minimise patient disturbance"
                if night_work else
                "Standard daytime scheduling sufficient"
            ),
            "weekend_work_recommended": weekend_work,
            "weekend_work_reason": (
                "Weekend windows allow uninterrupted access for structural "
                "modifications and major MEP shutdowns"
                if weekend_work else
                "Weekday scheduling adequate for scope"
            ),
        },
    }


# ══════════════════════════════════════════════════════════════════════
# Risk Assessment (Layer 5)
# ══════════════════════════════════════════════════════════════════════

def _assess_expansion_risks(
    wall_class: dict,
    mep_impact: dict,
    service_plan: dict,
    candidate_fn: str,
    candidate_area: float,
    construction_seq: dict,
) -> dict:
    """Comprehensive risk assessment for the expansion.

    Returns categorised risks with probability, impact, and mitigations.
    """
    risks = []

    # Structural risk
    if wall_class.get("classification") == "load_bearing":
        risks.append({
            "category": "Structural",
            "risk": "Hidden structural elements during demolition",
            "probability": "medium",
            "impact": "high",
            "risk_score": 8,
            "mitigation": (
                "Commission pre-demolition ground-penetrating radar survey. "
                "Structural engineer on-site during all demolition activities. "
                "Contingency steel beam sizes specified in advance."
            ),
            "cost_impact": round(candidate_area * 150),
        })
    elif wall_class.get("classification") == "fire_rated":
        risks.append({
            "category": "Structural",
            "risk": "Fire compartmentation compliance gap",
            "probability": "low",
            "impact": "high",
            "risk_score": 5,
            "mitigation": (
                "Early engagement with fire engineer for alternative "
                "compartmentation strategy. Compensatory detection and "
                "suppression measures pre-approved."
            ),
            "cost_impact": round(candidate_area * 80),
        })
    else:
        risks.append({
            "category": "Structural",
            "risk": "Unexpected services in wall cavity",
            "probability": "low",
            "impact": "low",
            "risk_score": 2,
            "mitigation": (
                "Thermal imaging scan of wall before demolition to identify "
                "hidden pipes or cables."
            ),
            "cost_impact": 1500,
        })

    # Service disruption risk
    candidate_impact = service_plan["candidate_impact"]["impact_level"]
    if candidate_impact in ("high", "critical"):
        risks.append({
            "category": "Service Disruption",
            "risk": f"Loss of {candidate_fn} capacity during construction",
            "probability": "certain",
            "impact": "high",
            "risk_score": 9,
            "mitigation": (
                f"Pre-arrange temporary {candidate_fn} provision on adjacent "
                f"floor. Schedule construction to avoid peak demand periods. "
                f"Notify affected departments 6 weeks in advance."
            ),
            "cost_impact": service_plan["candidate_impact"]["relocation_cost"],
        })
    elif candidate_impact == "moderate":
        risks.append({
            "category": "Service Disruption",
            "risk": f"Reduced {candidate_fn} capacity during works",
            "probability": "certain",
            "impact": "medium",
            "risk_score": 6,
            "mitigation": (
                "Redistribute workload across remaining spaces. "
                "Monitor utilisation and escalate if capacity is insufficient."
            ),
            "cost_impact": round(candidate_area * 15),
        })

    # MEP complexity risk
    if mep_impact["complexity"] == "high":
        risks.append({
            "category": "MEP / Technical",
            "risk": "Complex MEP rerouting delays",
            "probability": "medium",
            "impact": "medium",
            "risk_score": 6,
            "mitigation": (
                "Detailed MEP survey before works begin. Pre-order long-lead "
                "items (HVAC components, medical gas fittings). "
                "Allow float in MEP phase scheduling."
            ),
            "cost_impact": round(mep_impact["total_reroute_cost"] * 0.15),
        })

    # Infection control risk (hospital-specific)
    risks.append({
        "category": "Infection Control",
        "risk": "Airborne contamination from construction dust",
        "probability": "medium" if candidate_area > 30 else "low",
        "impact": "high",
        "risk_score": 7 if candidate_area > 30 else 4,
        "mitigation": (
            "ICRA Class IV containment for all demolition activities. "
            "HEPA filtration with negative pressure maintained at all times. "
            "Daily air quality monitoring with particle counts. "
            "Ante-room with sticky mats at construction zone entry."
        ),
        "cost_impact": round(800 + candidate_area * 30),
    })

    # Cost overrun risk
    total_weeks = construction_seq["total_weeks"]
    if total_weeks > 12:
        overrun_prob = "medium"
        overrun_score = 6
    elif total_weeks > 6:
        overrun_prob = "low"
        overrun_score = 4
    else:
        overrun_prob = "very_low"
        overrun_score = 2
    risks.append({
        "category": "Financial",
        "risk": "Budget overrun due to unforeseen conditions",
        "probability": overrun_prob,
        "impact": "medium",
        "risk_score": overrun_score,
        "mitigation": (
            "Contingency allowance included in cost estimate. "
            "Monthly cost reporting with variance analysis. "
            "Change order protocol with pre-approved thresholds."
        ),
        "cost_impact": 0,  # already in contingency
    })

    # Timeline risk
    risks.append({
        "category": "Schedule",
        "risk": "Permit processing delays",
        "probability": "medium",
        "impact": "medium",
        "risk_score": 5,
        "mitigation": (
            "Submit permits in parallel where possible. "
            "Pre-consultation with commune planning office. "
            "Fire department early engagement for compartmentation review."
        ),
        "cost_impact": round(total_weeks * 200),  # weekly holding cost
    })

    # Noise and vibration
    if wall_class.get("classification") in ("load_bearing", "partition_masonry"):
        risks.append({
            "category": "Operational",
            "risk": "Noise and vibration impact on adjacent clinical spaces",
            "probability": "high" if wall_class.get("classification") == "load_bearing" else "medium",
            "impact": "medium",
            "risk_score": 6 if wall_class.get("classification") == "load_bearing" else 4,
            "mitigation": (
                "Vibration monitoring on adjacent structural elements. "
                "Noise level agreements with contractor (max 75 dB at "
                "nearest patient area). Restrict percussive demolition "
                "to agreed time windows."
            ),
            "cost_impact": 1200,
        })

    # Sort by risk score descending
    risks.sort(key=lambda r: r["risk_score"], reverse=True)

    # Overall risk rating
    max_score = max(r["risk_score"] for r in risks) if risks else 0
    avg_score = sum(r["risk_score"] for r in risks) / max(1, len(risks))
    total_risk_cost = sum(r["cost_impact"] for r in risks)

    if max_score >= 8 or avg_score >= 6:
        overall = "high"
        summary = (
            "This expansion carries significant risk requiring careful management. "
            "Structural complexity, service disruption, and infection control "
            "all need dedicated attention and contingency planning."
        )
    elif max_score >= 5 or avg_score >= 4:
        overall = "medium"
        summary = (
            "Manageable risk level with standard mitigation measures. "
            "Key focus areas are MEP coordination and infection control."
        )
    else:
        overall = "low"
        summary = (
            "Low overall risk. Standard construction management practices "
            "are sufficient. Focus on infection control as primary concern."
        )

    return {
        "risks": risks,
        "overall_rating": overall,
        "overall_summary": summary,
        "max_risk_score": max_score,
        "avg_risk_score": round(avg_score, 1),
        "total_risk_cost_exposure": total_risk_cost,
    }


# ══════════════════════════════════════════════════════════════════════
# Candidate Scoring Engine (Layer 2)
# ══════════════════════════════════════════════════════════════════════

EXPANSION_SCORE_WEIGHTS = {
    "wall_removability":    0.14,
    "mep_complexity":       0.12,
    "structural_impact":    0.10,
    "service_continuity":   0.10,
    "construction_access":  0.06,
    "noise_sensitivity":    0.06,
    "infection_control":    0.08,
    "egress_compliance":    0.06,
    "utility_capacity":     0.05,
    "phasing_feasibility":  0.05,
    "adjacency_quality":    0.08,
    "area_gain_efficiency": 0.10,
}


def _score_candidate(
    candidate: dict,
    commercial_space: dict,
    wall_class: dict,
    mep_impact: dict,
    service_plan: dict,
    floor_fn_counts: dict,
    floor_total: int,
) -> dict:
    """Score an expansion candidate across 12 dimensions.

    Returns dict with individual scores, weighted total, and reasons.
    """
    candidate_fn = candidate.get("primary_function", "")
    candidate_area = candidate.get("area_m2", 0) or 0
    commercial_area = commercial_space.get("area_m2", 0) or 0

    scores = {}

    # 1. Wall removability (0-100)
    wall_type = wall_class.get("classification", "partition_masonry")
    wall_scores = {
        "partition_drywall": (95, "Drywall partition - easy removal, minimal disruption"),
        "partition_masonry": (75, "Masonry partition - standard demolition required"),
        "wet_wall": (50, "Wet wall - services must be rerouted before removal"),
        "fire_rated": (40, "Fire-rated wall - compensatory measures required"),
        "load_bearing": (15, "Load-bearing wall - structural intervention required"),
    }
    s, r = wall_scores.get(wall_type, (50, "Unknown wall type"))
    scores["wall_removability"] = {"score": s, "reason": r}

    # 2. MEP complexity (0-100, high = easy)
    mep_complex = mep_impact["complexity"]
    if mep_complex == "low":
        scores["mep_complexity"] = {"score": 85, "reason": "Standard MEP rerouting, no critical systems"}
    elif mep_complex == "medium":
        scores["mep_complexity"] = {"score": 55, "reason": f"{mep_impact['system_count']} systems affected, manageable coordination"}
    else:
        scores["mep_complexity"] = {"score": 25, "reason": f"Complex MEP with {mep_impact['system_count']} systems, specialist coordination needed"}

    # 3. Structural impact (0-100, high = low impact)
    if wall_type == "load_bearing":
        scores["structural_impact"] = {"score": 15, "reason": "Major structural modification with shoring and steel beams"}
    elif wall_type == "fire_rated":
        scores["structural_impact"] = {"score": 55, "reason": "Fire compartment boundary modification - fire engineer required"}
    else:
        scores["structural_impact"] = {"score": 90, "reason": "No structural implications, non-load-bearing wall"}

    # 4. Service continuity (0-100, high = easy)
    impact_level = service_plan["candidate_impact"]["impact_level"]
    if impact_level == "critical":
        scores["service_continuity"] = {"score": 5, "reason": f"Cannot remove {candidate_fn} - essential infrastructure"}
    elif impact_level == "high":
        sc = max(15, 40 - (floor_fn_counts.get(candidate_fn, 1) <= 1) * 20)
        scores["service_continuity"] = {"score": sc, "reason": f"High impact - only {floor_fn_counts.get(candidate_fn, 0)} {candidate_fn} on floor"}
    elif impact_level == "moderate":
        scores["service_continuity"] = {"score": 55, "reason": f"Moderate impact - {floor_fn_counts.get(candidate_fn, 0)} on floor, workload redistribution needed"}
    else:
        scores["service_continuity"] = {"score": 90, "reason": f"Low impact - {floor_fn_counts.get(candidate_fn, 0)} on floor, capacity absorbs loss"}

    # 5. Construction access (0-100)
    # Rooms near corridors are easier to access for construction
    candidate_profile = FUNCTION_PROFILES.get(candidate_fn, {})
    if candidate_fn in ("Corridor", "Main Hall", "Entrance"):
        scores["construction_access"] = {"score": 30, "reason": "Public circulation space - construction access complex"}
    elif candidate_profile.get("category") in ("support", "revenue"):
        scores["construction_access"] = {"score": 80, "reason": "Non-clinical space, flexible construction access scheduling"}
    else:
        scores["construction_access"] = {"score": 55, "reason": "Clinical space - construction access requires careful scheduling"}

    # 6. Noise sensitivity (0-100, high = low sensitivity)
    clinical_fns = {"Patient Care", "Surgery Room", "Consultation", "Laboratory"}
    if candidate_fn in clinical_fns:
        scores["noise_sensitivity"] = {"score": 25, "reason": f"{candidate_fn} is noise-sensitive - demolition constraints apply"}
    elif candidate_fn in ("Waiting Room", "Reception"):
        scores["noise_sensitivity"] = {"score": 45, "reason": "Public-facing space - noise management needed during work hours"}
    else:
        scores["noise_sensitivity"] = {"score": 80, "reason": "Low noise sensitivity - flexible construction scheduling"}

    # 7. Infection control (0-100, high = low risk)
    if candidate_profile.get("category") == "clinical":
        scores["infection_control"] = {"score": 25, "reason": "Clinical space - ICRA Class IV containment required"}
    elif candidate_profile.get("patient_facing"):
        scores["infection_control"] = {"score": 50, "reason": "Patient-facing space - ICRA Class III containment"}
    else:
        scores["infection_control"] = {"score": 85, "reason": "Non-clinical, non-patient space - standard containment"}

    # 8. Egress compliance (0-100)
    if candidate_fn in ("Corridor", "Staircase", "Elevator", "Ramp"):
        scores["egress_compliance"] = {"score": 5, "reason": "Cannot absorb emergency egress route"}
    elif candidate_fn in ("Main Hall", "Entrance"):
        scores["egress_compliance"] = {"score": 20, "reason": "Primary circulation space - egress impact likely"}
    else:
        scores["egress_compliance"] = {"score": 85, "reason": "Room absorption does not affect emergency egress routes"}

    # 9. Utility capacity (0-100)
    # Commercial expansion needs electrical, HVAC capacity
    if candidate_profile.get("requires_special_hvac"):
        scores["utility_capacity"] = {"score": 35, "reason": "Existing HVAC is specialised - conversion complex"}
    elif candidate_profile.get("requires_medical_gas"):
        scores["utility_capacity"] = {"score": 45, "reason": "Medical gas infrastructure needs decommissioning"}
    else:
        scores["utility_capacity"] = {"score": 75, "reason": "Standard utilities - capacity likely sufficient for commercial use"}

    # 10. Phasing feasibility (0-100)
    if service_plan["commercial_continuity"]["partial_operation"]:
        scores["phasing_feasibility"] = {"score": 80, "reason": "Commercial space can remain partially open during construction"}
    else:
        scores["phasing_feasibility"] = {"score": 30, "reason": "Full commercial closure required during construction"}

    # 11. Adjacency quality (0-100)
    # Direct adjacency to the commercial space is what we've already verified
    # Score based on how the candidate's location benefits the expansion
    commercial_profile = FUNCTION_PROFILES.get(commercial_space.get("primary_function", ""), {})
    adj_benefits = commercial_profile.get("adjacency_benefits", [])
    adj_conflicts = commercial_profile.get("adjacency_conflicts", [])
    if candidate_fn in adj_conflicts:
        scores["adjacency_quality"] = {"score": 20, "reason": f"{candidate_fn} conflicts with commercial operations"}
    elif candidate_fn in adj_benefits:
        scores["adjacency_quality"] = {"score": 90, "reason": f"{candidate_fn} is synergistic with commercial function"}
    else:
        scores["adjacency_quality"] = {"score": 60, "reason": "Neutral adjacency - no synergy or conflict"}

    # 12. Area gain efficiency (0-100)
    if commercial_area > 0:
        gain_pct = (candidate_area / commercial_area) * 100
        if 20 <= gain_pct <= 80:
            s = 90
            r = f"+{candidate_area:.0f} m2 ({gain_pct:.0f}% increase) - optimal expansion size"
        elif gain_pct > 80:
            s = 60
            r = f"+{candidate_area:.0f} m2 ({gain_pct:.0f}% increase) - very large expansion may be unwieldy"
        elif gain_pct >= 10:
            s = 70
            r = f"+{candidate_area:.0f} m2 ({gain_pct:.0f}% increase) - modest but worthwhile gain"
        else:
            s = 35
            r = f"+{candidate_area:.0f} m2 ({gain_pct:.0f}% increase) - minimal area gain"
    else:
        s = 50
        r = "Cannot assess area gain ratio"
    scores["area_gain_efficiency"] = {"score": s, "reason": r}

    # Weighted total
    weighted = sum(
        scores[dim]["score"] * EXPANSION_SCORE_WEIGHTS[dim]
        for dim in EXPANSION_SCORE_WEIGHTS
    )
    total_score = max(0, min(100, round(weighted)))

    return {
        "dimensions": scores,
        "total_score": total_score,
        "weights": EXPANSION_SCORE_WEIGHTS,
    }


# ══════════════════════════════════════════════════════════════════════
# Merged-Space Projection (Layer 3)
# ══════════════════════════════════════════════════════════════════════

def _project_merged_space(
    commercial_space: dict,
    candidate: dict,
    commercial_profile: dict,
) -> dict:
    """Project the characteristics of the merged commercial space.

    Returns area, capacity, and revenue projections.
    """
    current_area = commercial_space.get("area_m2", 0) or 0
    candidate_area = candidate.get("area_m2", 0) or 0
    merged_area = current_area + candidate_area

    # Revenue projection with marginal diminishing returns
    uplift_factor = commercial_profile.get("revenue_uplift_per_m2", 0.80)
    rev_rate = commercial_profile.get("revenue_per_m2_year", 1800)
    current_revenue = current_area * rev_rate
    additional_revenue = candidate_area * rev_rate * uplift_factor
    merged_revenue = current_revenue + additional_revenue

    # OPEX
    opex_rate = commercial_profile.get("operating_cost_m2_year", 350)
    current_opex = current_area * opex_rate
    merged_opex = merged_area * opex_rate  # OPEX scales linearly

    # Seating (for food service)
    seat_density = commercial_profile.get("seating_density", 0)
    kitchen_ratio = commercial_profile.get("kitchen_ratio", 0)
    if seat_density > 0:
        current_seats = round((current_area * (1 - kitchen_ratio)) / seat_density)
        merged_seats = round((merged_area * (1 - kitchen_ratio)) / seat_density)
        additional_seats = merged_seats - current_seats
    else:
        current_seats = 0
        merged_seats = 0
        additional_seats = 0

    # Area range assessment
    opt_min = commercial_profile.get("optimal_area_min", 15)
    opt_max = commercial_profile.get("optimal_area_max", 300)
    if opt_min <= merged_area <= opt_max:
        area_assessment = f"Merged area of {merged_area:.0f} m2 is within optimal range ({opt_min}-{opt_max} m2)"
        area_fit = "optimal"
    elif merged_area > opt_max:
        area_assessment = f"Merged area of {merged_area:.0f} m2 exceeds optimal max ({opt_max} m2) - diminishing returns likely"
        area_fit = "oversized"
    else:
        area_assessment = f"Merged area of {merged_area:.0f} m2 is below optimal min ({opt_min} m2)"
        area_fit = "undersized"

    return {
        "current_area": round(current_area, 1),
        "candidate_area": round(candidate_area, 1),
        "merged_area": round(merged_area, 1),
        "area_increase_pct": round((candidate_area / max(1, current_area)) * 100, 1),
        "area_fit": area_fit,
        "area_assessment": area_assessment,
        "revenue": {
            "current_annual": round(current_revenue),
            "additional_annual": round(additional_revenue),
            "merged_annual": round(merged_revenue),
            "revenue_uplift_pct": round((additional_revenue / max(1, current_revenue)) * 100, 1),
            "marginal_rate": round(rev_rate * uplift_factor),
            "explanation": (
                f"Additional m2 generates {uplift_factor * 100:.0f}% of average "
                f"revenue rate (EUR {rev_rate:,}/m2/yr) due to marginal "
                f"diminishing returns on expanded footprint"
            ),
        },
        "operating_cost": {
            "current_annual": round(current_opex),
            "merged_annual": round(merged_opex),
            "delta": round(merged_opex - current_opex),
        },
        "net_annual_gain": round(additional_revenue - (merged_opex - current_opex)),
        "seating": {
            "current": current_seats,
            "merged": merged_seats,
            "additional": additional_seats,
        } if seat_density > 0 else None,
    }


# ══════════════════════════════════════════════════════════════════════
# Financial Modelling (Layer 4)
# ══════════════════════════════════════════════════════════════════════

def _compute_expansion_costs(
    candidate_area: float,
    wall_class: dict,
    mep_impact: dict,
    service_plan: dict,
    construction_seq: dict,
    merged_projection: dict,
) -> dict:
    """Compute full cost breakdown for an expansion candidate."""

    wall_type = wall_class.get("classification", "partition_masonry")
    total_weeks = construction_seq["total_weeks"]

    # A. Wall modification cost
    # Estimate shared wall length from candidate area (sqrt approximation)
    estimated_wall_length = math.sqrt(candidate_area) * 0.6  # metres
    wall_mod_cost = round(
        wall_class.get("cost_to_modify", 3500) * max(1, estimated_wall_length)
    )
    if wall_class.get("shoring_required"):
        shoring_cost = round(wall_mod_cost * 0.35)
    else:
        shoring_cost = 0

    wall_costs = {
        "wall_modification": {
            "amount": wall_mod_cost,
            "explanation": (
                f"{wall_class.get('label', 'Partition')} wall removal/modification. "
                f"Estimated {estimated_wall_length:.1f}m shared wall at "
                f"EUR {wall_class.get('cost_to_modify', 3500):,}/m"
            ),
        },
        "temporary_shoring": {
            "amount": shoring_cost,
            "explanation": (
                "Temporary structural support during wall removal"
                if shoring_cost > 0 else "Not required - non-load-bearing wall"
            ),
        },
        "subtotal": wall_mod_cost + shoring_cost,
    }

    # B. MEP rerouting costs
    mep_costs = {
        "total": mep_impact["total_reroute_cost"],
        "breakdown": [
            {
                "system": s["label"],
                "cost": s["reroute_cost"],
                "impact": s["impact"],
            }
            for s in mep_impact["affected_systems"]
        ],
        "explanation": mep_impact["complexity_narrative"],
    }

    # C. Fit-out costs (commercial grade for new area)
    fitout_per_m2 = 280  # commercial interior fit-out
    fitout_cost = round(candidate_area * fitout_per_m2)
    fitout = {
        "interior_fitout": {
            "amount": fitout_cost,
            "explanation": (
                f"{candidate_area:.0f} m2 x EUR {fitout_per_m2}/m2 "
                f"commercial-grade interior fit-out (flooring, ceiling, "
                f"paint, fixtures)"
            ),
        },
        "commercial_fixtures": {
            "amount": round(candidate_area * 120),
            "explanation": (
                f"Commercial fixtures and fittings for expanded area "
                f"(shelving, counters, display, POS infrastructure)"
            ),
        },
        "subtotal": fitout_cost + round(candidate_area * 120),
    }

    # D. Service continuity costs
    continuity_costs = {
        "relocation": {
            "amount": service_plan["candidate_impact"]["relocation_cost"],
            "explanation": service_plan["candidate_impact"]["strategy"],
        },
        "interim_provisions": {
            "amount": service_plan["interim_total_cost"],
            "explanation": (
                f"{len(service_plan['interim_provisions'])} interim provisions "
                f"during {service_plan['commercial_continuity']['downtime_weeks']}-week "
                f"construction period"
            ),
        },
        "subtotal": (
            service_plan["candidate_impact"]["relocation_cost"]
            + service_plan["interim_total_cost"]
        ),
    }

    # E. Compliance and permits
    is_cross_cat = True  # absorbing non-commercial into commercial
    compliance = {
        "building_permit": {
            "amount": 750,
            "explanation": "Building permit for structural/partition modification",
        },
        "fire_engineer": {
            "amount": 2200 if wall_type in ("fire_rated", "load_bearing") else 800,
            "explanation": (
                "Fire compartmentation review and revised drawings"
                if wall_type in ("fire_rated", "load_bearing")
                else "Standard fire safety review for internal modification"
            ),
        },
        "change_of_use": {
            "amount": 800,
            "explanation": f"Change-of-use permit for absorbed {candidate_area:.0f} m2",
        },
        "health_authority": {
            "amount": 600,
            "explanation": "Health authority notification for expanded commercial area in hospital",
        },
        "occupation_certificate": {
            "amount": 250,
            "explanation": "Final occupation certificate before reopening",
        },
    }
    compliance["subtotal"] = sum(
        v["amount"] for v in compliance.values() if isinstance(v, dict)
    )

    # F. Labour
    worker_map = {
        "partition_drywall": 2, "partition_masonry": 3,
        "wet_wall": 4, "fire_rated": 4, "load_bearing": 6,
    }
    workers = worker_map.get(wall_type, 3)
    gc_rate = 480
    gc_cost = round(workers * gc_rate * total_weeks)

    specialist_cost = 0
    if mep_impact["complexity"] in ("medium", "high"):
        spec_weeks = round(total_weeks * 0.4)
        specialist_cost = round(2 * 580 * spec_weeks)

    pm_base = (
        wall_costs["subtotal"] + mep_costs["total"]
        + fitout["subtotal"] + compliance["subtotal"]
    )
    pm_cost = round(pm_base * 0.05)

    hs_cost = round(420 * total_weeks) if total_weeks > 4 else 0

    labour = {
        "general_contractor": {
            "amount": gc_cost,
            "explanation": f"{workers} workers x EUR {gc_rate}/wk x {total_weeks} weeks",
        },
        "specialist_trades": {
            "amount": specialist_cost,
            "explanation": (
                "Electrician + plumber for MEP integration"
                if specialist_cost > 0 else "Not required"
            ),
        },
        "project_management": {
            "amount": pm_cost,
            "explanation": f"5% of direct costs (EUR {pm_base:,})",
        },
        "health_safety": {
            "amount": hs_cost,
            "explanation": (
                f"H&S officer for {total_weeks}-week programme"
                if hs_cost > 0 else "Not required - programme under 4 weeks"
            ),
        },
        "subtotal": gc_cost + specialist_cost + pm_cost + hs_cost,
    }

    # G. Contingency
    direct_costs = (
        wall_costs["subtotal"] + mep_costs["total"]
        + fitout["subtotal"] + compliance["subtotal"] + labour["subtotal"]
    )
    contingency_rate = 0.10 if wall_type == "load_bearing" else 0.08
    contingency = round(direct_costs * contingency_rate)

    # H. Commissioning
    commissioning = {
        "systems_testing": {"amount": 1200, "explanation": "MEP and fire system testing"},
        "deep_clean": {
            "amount": round(candidate_area * 12),
            "explanation": f"Commercial-grade clean at EUR 12/m2",
        },
        "as_built_docs": {"amount": 400, "explanation": "Updated floor plans and BIM model"},
        "subtotal": 1200 + round(candidate_area * 12) + 400,
    }

    # Total
    total_project_cost = (
        wall_costs["subtotal"] + mep_costs["total"]
        + fitout["subtotal"] + continuity_costs["subtotal"]
        + compliance["subtotal"] + labour["subtotal"]
        + contingency + commissioning["subtotal"]
    )

    return {
        "wall_modification": wall_costs,
        "mep_rerouting": mep_costs,
        "fitout": fitout,
        "service_continuity": continuity_costs,
        "compliance": compliance,
        "labour": labour,
        "contingency": {
            "rate": contingency_rate,
            "amount": contingency,
            "explanation": f"{contingency_rate * 100:.0f}% of direct costs for construction risk",
        },
        "commissioning": commissioning,
        "total_project_cost": total_project_cost,
        "cost_per_m2_gained": round(total_project_cost / max(1, candidate_area)),
    }


def _compute_expansion_roi(
    costs: dict,
    merged_projection: dict,
    construction_seq: dict,
) -> dict:
    """Compute ROI for the expansion."""
    total_investment = costs["total_project_cost"]
    net_annual_gain = merged_projection["net_annual_gain"]
    additional_revenue = merged_projection["revenue"]["additional_annual"]
    opex_delta = merged_projection["operating_cost"]["delta"]
    total_weeks = construction_seq["total_weeks"]

    # Downtime revenue loss during construction
    current_revenue = merged_projection["revenue"]["current_annual"]
    daily_loss = current_revenue / 365
    downtime_days = total_weeks * 7
    downtime_cost = round(daily_loss * downtime_days * 0.5)  # 50% if partial operation

    # Payback
    if net_annual_gain > 0:
        monthly_gain = net_annual_gain / 12
        payback_months = round((total_investment + downtime_cost) / max(1, monthly_gain))
    else:
        payback_months = None

    # 5-year ROI
    five_year_net = (net_annual_gain * 5) - total_investment - downtime_cost
    roi_5yr_pct = round(five_year_net / max(1, total_investment) * 100)

    # Narrative
    if net_annual_gain > 0 and payback_months and payback_months <= 60:
        narrative = (
            f"Expansion generates EUR {net_annual_gain:,}/yr net gain. "
            f"Total investment of EUR {total_investment:,} pays back in "
            f"{payback_months} months with a 5-year ROI of {roi_5yr_pct}%."
        )
    elif net_annual_gain > 0:
        narrative = (
            f"Expansion generates EUR {net_annual_gain:,}/yr net gain. "
            f"Extended payback period of {payback_months} months. "
            f"5-year ROI: {roi_5yr_pct}%."
        )
    else:
        narrative = (
            f"This expansion does not generate positive net revenue. "
            f"Consider strategic value beyond financial return."
        )

    return {
        "total_investment": total_investment,
        "additional_revenue": round(additional_revenue),
        "opex_delta": round(opex_delta),
        "net_annual_gain": round(net_annual_gain),
        "downtime_cost": downtime_cost,
        "payback_months": payback_months,
        "roi_5yr_pct": roi_5yr_pct,
        "roi_narrative": narrative,
        "explanations": {
            "additional_revenue": (
                f"EUR {additional_revenue:,.0f}/yr from {merged_projection['candidate_area']:.0f} m2 "
                f"at marginal rate EUR {merged_projection['revenue']['marginal_rate']:,}/m2/yr"
            ),
            "opex_delta": (
                f"EUR {opex_delta:,.0f}/yr additional operating costs for expanded area"
            ),
            "net_gain": (
                f"Revenue uplift EUR {additional_revenue:,.0f} minus OPEX increase EUR {opex_delta:,.0f}"
            ),
            "payback": (
                f"EUR {total_investment + downtime_cost:,} total outlay / "
                f"EUR {round(net_annual_gain / 12):,} monthly gain"
                if payback_months else "N/A"
            ),
            "roi_5yr": (
                f"(EUR {net_annual_gain:,}/yr x 5 - EUR {total_investment:,}) / EUR {total_investment:,} x 100"
            ),
        },
    }


# ══════════════════════════════════════════════════════════════════════
# Regulatory & Compliance (Layer 6)
# ══════════════════════════════════════════════════════════════════════

def _assess_regulatory(
    candidate_fn: str,
    wall_class: dict,
    merged_area: float,
) -> dict:
    """Assess regulatory and compliance requirements for the expansion."""
    candidate_profile = FUNCTION_PROFILES.get(candidate_fn, {})
    candidate_cat = candidate_profile.get("category", "support")
    wall_type = wall_class.get("classification", "partition_masonry")

    requirements = []

    # Building permit
    requirements.append({
        "requirement": "Building Permit",
        "authority": "Commune/Municipality",
        "required": True,
        "processing_weeks": 4 if wall_type not in ("load_bearing",) else 8,
        "description": "Standard building permit for internal modification",
        "status": "required",
    })

    # Structural engineer
    if wall_type == "load_bearing":
        requirements.append({
            "requirement": "Structural Engineer Report",
            "authority": "Accredited structural engineer",
            "required": True,
            "processing_weeks": 3,
            "description": "Load-bearing wall removal requires structural calculations and beam design",
            "status": "critical",
        })

    # Fire safety
    requirements.append({
        "requirement": "Fire Safety Certificate",
        "authority": "Fire Department / SIAMU",
        "required": True,
        "processing_weeks": 4 if wall_type == "fire_rated" else 2,
        "description": (
            "Fire compartmentation review for wall removal"
            if wall_type == "fire_rated"
            else "Standard fire safety review for internal changes"
        ),
        "status": "required",
    })

    # Change of use
    if candidate_cat != "revenue":
        requirements.append({
            "requirement": "Change of Use Permit",
            "authority": "Regional Planning Authority",
            "required": True,
            "processing_weeks": 8,
            "description": f"Converting {candidate_cat} space to commercial use",
            "status": "required",
        })

    # Health authority
    requirements.append({
        "requirement": "Health Authority Notification",
        "authority": "AVIQ / COCOM",
        "required": True,
        "processing_weeks": 6,
        "description": "Hospital commercial space expansion notification",
        "status": "required",
    })

    # ICRA
    requirements.append({
        "requirement": "Infection Control Risk Assessment",
        "authority": "Hospital ICRA Committee",
        "required": True,
        "processing_weeks": 2,
        "description": "Construction in operational hospital requires ICRA approval before works begin",
        "status": "required",
    })

    # Accessibility
    if merged_area > 50:
        requirements.append({
            "requirement": "Accessibility Audit",
            "authority": "CAWaB / AccessPlus",
            "required": True,
            "processing_weeks": 3,
            "description": "Expanded commercial area must meet accessibility standards",
            "status": "required",
        })

    # Occupation certificate
    requirements.append({
        "requirement": "Occupation Certificate",
        "authority": "Commune/Municipality",
        "required": True,
        "processing_weeks": 2,
        "description": "Final certificate before reopening expanded space to public",
        "status": "required",
    })

    # Critical path: longest processing chain
    max_weeks = max(r["processing_weeks"] for r in requirements)

    return {
        "requirements": requirements,
        "total_requirements": len(requirements),
        "critical_path_weeks": max_weeks,
        "summary": (
            f"{len(requirements)} regulatory requirements. "
            f"Longest lead item: {max_weeks} weeks. "
            f"{'Structural engineer report is critical path.' if wall_type == 'load_bearing' else 'Change-of-use permit is likely critical path.' if candidate_cat != 'revenue' else 'Standard permit timeline.'}"
        ),
    }


# ══════════════════════════════════════════════════════════════════════
# Main expansion analysis function
# ══════════════════════════════════════════════════════════════════════

def compute_expansion_options(
    commercial_space: dict,
    floor_spatial: dict,
    polygon_map: dict,
    intelligence_map: dict,
    floor_fn_counts: dict,
    floor_total: int,
) -> list[dict]:
    """Compute expansion analysis for a commercial space.

    Args:
        commercial_space: intelligence dict for the selected commercial room
        floor_spatial: pre-computed floor spatial data (from geometry engine)
        polygon_map: {ifc_guid: polygon_dict} for this floor
        intelligence_map: {ifc_guid: intelligence_dict} for this floor
        floor_fn_counts: {function: count} for this floor
        floor_total: total rooms on this floor

    Returns:
        List of expansion candidate dicts, sorted by score descending.
        Each contains all 7 layers of analysis.
    """
    guid = commercial_space.get("ifc_guid", "")
    fn = commercial_space.get("primary_function", "")
    area = commercial_space.get("area_m2", 0) or 0

    if not guid or area < 3:
        return []

    commercial_profile = _get_commercial_profile(fn)

    # Layer 1: Adjacency Detection
    adjacent_guids = floor_spatial.get("adjacency", {}).get(guid, [])
    if not adjacent_guids:
        return []

    candidates = []

    for adj_guid in adjacent_guids:
        adj_intel = intelligence_map.get(adj_guid)
        if not adj_intel:
            continue

        adj_fn = adj_intel.get("primary_function", "")
        adj_area = adj_intel.get("area_m2", 0) or 0
        adj_name = adj_intel.get("space_name", adj_fn)

        # Skip infrastructure that can never be absorbed
        if adj_fn in NON_REPURPOSABLE_FUNCTIONS:
            continue

        # Skip very small or very large rooms
        if adj_area < 3 or adj_area > 500:
            continue

        # Layer 5: Construction Intelligence
        wall_class = _classify_shared_wall(fn, adj_fn, adj_name)
        mep_impact = _assess_mep_impact(adj_fn, adj_area, wall_class)
        service_plan = _plan_service_continuity(
            fn, area, adj_fn, adj_area, floor_fn_counts, wall_class,
        )
        construction_seq = _build_construction_sequence(
            adj_area, wall_class, mep_impact, service_plan,
        )
        risk_assessment = _assess_expansion_risks(
            wall_class, mep_impact, service_plan,
            adj_fn, adj_area, construction_seq,
        )

        # Layer 2: Candidate Scoring
        scoring = _score_candidate(
            adj_intel, commercial_space, wall_class, mep_impact,
            service_plan, floor_fn_counts, floor_total,
        )

        # Layer 3: Merged-Space Projection
        merged = _project_merged_space(commercial_space, adj_intel, commercial_profile)

        # Layer 4: Financial Modelling
        costs = _compute_expansion_costs(
            adj_area, wall_class, mep_impact,
            service_plan, construction_seq, merged,
        )
        roi = _compute_expansion_roi(costs, merged, construction_seq)

        # Layer 6: Regulatory
        regulatory = _assess_regulatory(adj_fn, wall_class, merged["merged_area"])

        candidates.append({
            "candidate_guid": adj_guid,
            "candidate_name": adj_name,
            "candidate_function": adj_fn,
            "candidate_area": round(adj_area, 1),

            # Layer 2
            "score": scoring["total_score"],
            "scoring": scoring,

            # Layer 3
            "merged_projection": merged,

            # Layer 4
            "costs": costs,
            "roi": roi,

            # Layer 5 - Construction Intelligence
            "construction": {
                "wall_classification": wall_class,
                "mep_impact": mep_impact,
                "service_continuity": service_plan,
                "construction_sequence": construction_seq,
                "risk_assessment": risk_assessment,
            },

            # Layer 6
            "regulatory": regulatory,
        })

    # Sort by score descending
    candidates.sort(key=lambda c: c["score"], reverse=True)

    return candidates

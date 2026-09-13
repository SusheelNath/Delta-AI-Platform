"""
Suitability Scoring & Disambiguation for Delta Intelligence Platform.

Provides:
  - analyze_query_intent(): deterministic keyword extraction from user message
  - compute_suitability_score(): weighted multi-dimensional scoring per space
  - detect_ambiguity(): heuristic detection of ambiguous search results
  - format_disambiguation_hint(): LLM context injection for disambiguation
"""

import re
from dataclasses import dataclass, field


# ══════════════════════════════════════════════════════════════════════
# Query Intent Analysis
# ══════════════════════════════════════════════════════════════════════

# Base weights (sum = 1.0)
BASE_WEIGHTS = {
    "capacity": 0.30,
    "function": 0.25,
    "facilities": 0.15,
    "access": 0.15,
    "location": 0.10,
    "flexibility": 0.05,
}

# Floor alias → floor_id mapping (same as chat.py)
_FLOOR_ALIASES = {
    "basement 3": "H003", "b3": "H003", "level -3": "H003",
    "basement 2": "H002", "b2": "H002", "level -2": "H002",
    "basement 1": "H001", "b1": "H001", "level -1": "H001",
    "ground floor": "H000", "ground": "H000", "level 0": "H000",
    "floor 1": "H010", "first floor": "H010", "level 1": "H010", "floor one": "H010",
    "floor 2": "H020", "second floor": "H020", "level 2": "H020", "floor two": "H020",
    "floor 3": "H030", "third floor": "H030", "level 3": "H030", "floor three": "H030",
    "floor 4": "H040", "fourth floor": "H040", "level 4": "H040", "floor four": "H040",
    "floor 5": "H050", "fifth floor": "H050", "level 5": "H050", "floor five": "H050",
}

# Intent keyword sets
_CAPACITY_KEYWORDS = {
    "large", "big", "seat", "seats", "people", "capacity",
    "accommodate", "fit", "spacious", "person", "persons",
}
_PRIVACY_KEYWORDS = {
    "private", "confidential", "quiet", "sensitive", "discreet",
    "secluded", "isolated", "privacy",
}
_ACCESSIBILITY_KEYWORDS = {
    "wheelchair", "accessible", "step-free", "disabled",
    "mobility", "handicap", "barrier-free",
}
_BOOKABLE_KEYWORDS = {"bookable", "book", "reserve", "reservable", "available"}
_LOCATION_KEYWORDS = {"near", "close", "next to", "adjacent", "nearby", "proximity"}
_FACILITY_KEYWORDS = {
    "bed", "beds", "monitor", "monitors", "projector", "whiteboard",
    "gas outlet", "surgical table", "ventilator", "defibrillator",
    "incubator", "dialysis machine", "examination table", "desk",
    "chair", "chairs", "screen", "display", "computer", "sink",
    "oxygen", "suction", "phone", "fridge", "wardrobe", "cabinet",
    "trolley", "stretcher",
}
# Function keywords from classifier rules (lowercase)
_FUNCTION_KEYWORDS = {
    "consultation", "examination", "operating", "surgery", "surgical",
    "icu", "intensive care", "intensive-care", "patient room", "patient care",
    "ward", "office", "lab", "laboratory", "meeting", "conference",
    "waiting", "reception", "emergency", "radiology", "imaging",
    "physiotherapy", "rehabilitation", "dialysis", "neonatal", "nicu",
    "birthing", "delivery", "recovery", "nursing station", "staff room",
    "storage", "pharmacy", "restaurant", "cafeteria", "locker",
    "changing", "toilet", "wc", "shower", "corridor", "elevator",
    "lift", "staircase", "parking", "technical", "morgue",
    "sterilisation", "clean utility", "dirty utility", "pantry",
    "preparation room", "scrub", "triage", "endoscopy",
}

# Regex for "for N people/persons/staff"
_RE_CAPACITY = re.compile(
    r"\bfor\s+(\d+)\s*(?:people|persons?|staff|patient|patients|seat|seats)?\b",
    re.IGNORECASE,
)
# Regex for floor number mentions ("floor 3", "3rd floor")
_RE_FLOOR_NUM = re.compile(
    r"\bfloor\s+(\d)\b|\b(\d)(?:st|nd|rd|th)\s+floor\b",
    re.IGNORECASE,
)


@dataclass
class QueryIntent:
    """Parsed intent from a user query, used to adjust scoring weights."""
    weights: dict = field(default_factory=lambda: dict(BASE_WEIGHTS))
    target_capacity: int | None = None
    target_function: str | None = None
    target_floor: str | None = None
    required_accessible: bool = False
    required_bookable: bool = False
    required_facilities: list = field(default_factory=list)
    has_privacy_emphasis: bool = False


def analyze_query_intent(user_message: str) -> QueryIntent:
    """Extract scoring intent from a user message using keyword matching.

    Adjusts base weights based on detected emphasis areas.
    Returns a QueryIntent with adjusted weights and extracted targets.
    """
    msg = user_message.lower().strip()
    intent = QueryIntent()
    adjustments = {k: 0.0 for k in BASE_WEIGHTS}

    # ── Capacity emphasis ──
    cap_match = _RE_CAPACITY.search(msg)
    if cap_match:
        intent.target_capacity = int(cap_match.group(1))
        adjustments["capacity"] += 0.15
        adjustments["function"] -= 0.05
        adjustments["facilities"] -= 0.05
        adjustments["flexibility"] -= 0.05
    elif any(kw in msg for kw in _CAPACITY_KEYWORDS):
        adjustments["capacity"] += 0.10
        adjustments["flexibility"] -= 0.05
        adjustments["facilities"] -= 0.05

    # ── Privacy emphasis ──
    if any(kw in msg for kw in _PRIVACY_KEYWORDS):
        intent.has_privacy_emphasis = True
        adjustments["access"] += 0.15
        adjustments["function"] -= 0.05
        adjustments["capacity"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Accessibility emphasis ──
    if any(kw in msg for kw in _ACCESSIBILITY_KEYWORDS):
        intent.required_accessible = True
        adjustments["access"] += 0.15
        adjustments["capacity"] -= 0.05
        adjustments["facilities"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Bookable emphasis ──
    if any(kw in msg for kw in _BOOKABLE_KEYWORDS):
        intent.required_bookable = True
        adjustments["access"] += 0.10
        adjustments["capacity"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Function emphasis ──
    # Find the longest matching function keyword
    best_func = None
    best_len = 0
    for kw in _FUNCTION_KEYWORDS:
        if kw in msg and len(kw) > best_len:
            best_func = kw
            best_len = len(kw)
    if best_func:
        intent.target_function = best_func
        adjustments["function"] += 0.10
        adjustments["capacity"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Location emphasis ──
    # Check floor aliases (longest first, word-boundary matching)
    for alias, fid in sorted(_FLOOR_ALIASES.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(alias) + r'\b', msg):
            intent.target_floor = fid
            adjustments["location"] += 0.15
            adjustments["capacity"] -= 0.05
            adjustments["function"] -= 0.05
            adjustments["flexibility"] -= 0.05
            break
    if not intent.target_floor:
        floor_match = _RE_FLOOR_NUM.search(msg)
        if floor_match:
            num = int(floor_match.group(1) or floor_match.group(2))
            fid_map = {0: "H000", 1: "H010", 2: "H020", 3: "H030", 4: "H040", 5: "H050"}
            intent.target_floor = fid_map.get(num)
            if intent.target_floor:
                adjustments["location"] += 0.15
                adjustments["capacity"] -= 0.05
                adjustments["function"] -= 0.05
                adjustments["flexibility"] -= 0.05
    if not intent.target_floor and any(kw in msg for kw in _LOCATION_KEYWORDS):
        adjustments["location"] += 0.10
        adjustments["capacity"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Facilities emphasis ──
    found_facilities = [kw for kw in _FACILITY_KEYWORDS if kw in msg]
    if found_facilities:
        intent.required_facilities = found_facilities
        adjustments["facilities"] += 0.15
        adjustments["capacity"] -= 0.05
        adjustments["function"] -= 0.05
        adjustments["flexibility"] -= 0.05

    # ── Apply adjustments and normalize ──
    weights = {}
    for dim in BASE_WEIGHTS:
        w = BASE_WEIGHTS[dim] + adjustments[dim]
        weights[dim] = max(0.0, min(0.60, w))  # clamp

    # Renormalize to sum=1.0
    total = sum(weights.values())
    if total > 0:
        weights = {k: v / total for k, v in weights.items()}
    else:
        weights = dict(BASE_WEIGHTS)

    intent.weights = weights
    return intent


# ══════════════════════════════════════════════════════════════════════
# Suitability Scoring
# ══════════════════════════════════════════════════════════════════════

# Ordinal value maps
_FLEXIBILITY_MAP = {"high": 1.0, "medium": 0.7, "low": 0.4, "very low": 0.2, "none": 0.0}
_PRIVACY_MAP = {"very high": 1.0, "high": 0.8, "medium": 0.5, "low": 0.2, "none": 0.0}
_ACCESS_LEVEL_MAP = {"public": 1.0, "staff": 0.7, "controlled": 0.4, "restricted": 0.2}


def compute_suitability_score(
    space: dict,
    intent: QueryIntent,
    learnings: list[dict] | None = None,
) -> float:
    """Score a space (0-100) against a query intent.

    Args:
        space: enriched space intelligence dict from compute_space_intelligence()
        intent: parsed query intent from analyze_query_intent()
        learnings: optional list of UserLearning dicts for preference boost
    """
    scores = {}

    # ── Capacity ──
    max_occ = space.get("max_occupancy") or 0
    normal_occ = space.get("normal_occupancy") or 0
    if intent.target_capacity:
        target = intent.target_capacity
        effective = max_occ or normal_occ
        if effective == 0:
            scores["capacity"] = 0.0
        elif effective >= target:
            # Slight penalty for oversized (prefer right-sized)
            overshoot = (effective - target) / max(target, 1)
            scores["capacity"] = max(0.3, 1.0 - 0.1 * min(overshoot, 3.0))
        else:
            # Linear deficit penalty
            scores["capacity"] = max(0.0, effective / target)
    else:
        occupiable = space.get("occupiable", False)
        scores["capacity"] = 0.7 if occupiable else (0.3 if max_occ > 0 else 0.5)

    # ── Function ──
    if intent.target_function:
        target_fn = intent.target_function.lower()
        pf = (space.get("primary_function") or "").lower()
        fz = (space.get("functional_zone") or "").lower()
        sf = (space.get("secondary_functions") or "").lower()
        sc = (space.get("space_class") or "").lower()

        if target_fn in pf:
            scores["function"] = 1.0
        elif target_fn in fz:
            scores["function"] = 0.7
        elif target_fn in sf:
            scores["function"] = 0.5
        elif target_fn in sc:
            scores["function"] = 0.3
        else:
            scores["function"] = 0.0
    else:
        scores["function"] = 0.5

    # ── Facilities ──
    facilities_str = (space.get("facilities_available") or "").lower()
    if intent.required_facilities:
        matched = sum(1 for f in intent.required_facilities if f in facilities_str)
        scores["facilities"] = matched / len(intent.required_facilities)
    else:
        scores["facilities"] = 0.5 if facilities_str else 0.3

    # ── Access (composite: accessibility + privacy + bookability) ──
    access_subs = []

    # Accessibility sub-score
    accessible = (space.get("accessible") or "Unknown").lower()
    if intent.required_accessible:
        access_subs.append({"yes": 1.0, "controlled": 0.5}.get(accessible, 0.0))
    else:
        access_subs.append({"yes": 0.7, "controlled": 0.5, "unknown": 0.4, "no": 0.3}.get(accessible, 0.4))

    # Privacy sub-score
    privacy = (space.get("privacy_level") or "Low").lower()
    if intent.has_privacy_emphasis:
        access_subs.append(_PRIVACY_MAP.get(privacy, 0.3))
    else:
        access_subs.append(0.5)

    # Bookability sub-score
    bookable = (space.get("bookable") or "No").lower()
    if intent.required_bookable:
        access_subs.append(1.0 if bookable == "yes" else 0.0)
    else:
        access_subs.append(0.5)

    scores["access"] = sum(access_subs) / len(access_subs)

    # ── Location ──
    if intent.target_floor:
        floor_match = space.get("floor_id", "").upper() == intent.target_floor.upper()
        scores["location"] = 1.0 if floor_match else 0.2
    else:
        # Proximity score based on lift distance (lower = better)
        lift_dist = space.get("lift_distance_m")
        if lift_dist is not None:
            scores["location"] = max(0.1, 1.0 - lift_dist / 150.0)
        else:
            scores["location"] = 0.5

    # ── Flexibility ──
    flex = (space.get("flexibility") or "Medium").lower()
    scores["flexibility"] = _FLEXIBILITY_MAP.get(flex, 0.5)

    # ── Weighted sum ──
    score = sum(intent.weights[dim] * scores[dim] for dim in intent.weights) * 100

    # ── Learning boost (capped at +5) ──
    if learnings:
        boost = 0.0
        pf_lower = (space.get("primary_function") or "").lower()
        fz_lower = (space.get("functional_zone") or "").lower()
        floor_id = (space.get("floor_id") or "").upper()

        for lr in learnings:
            lr_type = lr.get("learning_type", "")
            lr_content = (lr.get("content") or "").lower()
            confidence = lr.get("confidence", 0.5)

            if lr_type == "function_interest":
                if any(w in pf_lower or w in fz_lower for w in lr_content.split() if len(w) > 3):
                    boost += 2.0 * confidence
            elif lr_type == "floor_preference":
                # Check if floor name appears in learning content
                floor_name = (space.get("floor_name") or "").lower()
                if floor_name and floor_name in lr_content:
                    boost += 2.0 * confidence
                elif floor_id.lower() in lr_content:
                    boost += 2.0 * confidence
            elif lr_type == "facility_need":
                if facilities_str and any(w in facilities_str for w in lr_content.split() if len(w) > 3):
                    boost += 1.0 * confidence

        score += min(boost, 5.0)

    return round(min(score, 100.0), 1)


# ══════════════════════════════════════════════════════════════════════
# Disambiguation
# ══════════════════════════════════════════════════════════════════════

def detect_ambiguity(
    results: list[dict],
    intent: QueryIntent,
    learnings: list[dict] | None = None,
) -> dict | None:
    """Detect if search results are ambiguous and need user clarification.

    Returns a descriptor dict if ambiguous, None if results are clear.
    """
    if len(results) <= 1:
        return None

    # ── Vague query: no specific targets at all ──
    if (not intent.target_capacity and not intent.target_function
            and not intent.target_floor and not intent.required_accessible
            and not intent.required_bookable and not intent.required_facilities):
        missing = ["function type", "capacity/number of people", "floor preference"]
        return {
            "type": "vague_query",
            "missing": missing,
            "count": len(results),
        }

    scored = [r for r in results if "suitability_score" in r]
    if len(scored) < 2:
        return None

    # ── Multi-floor: same function on 3+ floors, top 2 scores within 5 pts ──
    # Check if user has a floor preference learning (suppress if so)
    has_floor_pref = False
    if learnings:
        has_floor_pref = any(lr.get("learning_type") == "floor_preference" for lr in learnings)

    if not has_floor_pref and intent.target_function:
        top_func = intent.target_function.lower()
        func_matches = [r for r in scored if top_func in (r.get("primary_function") or "").lower()]
        if len(func_matches) >= 3:
            floors = set(r.get("floor_name", r.get("floor_id", "?")) for r in func_matches[:10])
            if len(floors) >= 3:
                top_scores = sorted([r["suitability_score"] for r in func_matches], reverse=True)
                if len(top_scores) >= 2 and abs(top_scores[0] - top_scores[1]) <= 5:
                    return {
                        "type": "multi_floor",
                        "function": intent.target_function,
                        "floors": sorted(floors),
                        "count": len(func_matches),
                    }

    # ── Similar names: top 5 share a common prefix ──
    if len(scored) >= 3:
        names = [r.get("space_name", "") for r in scored[:5]]
        names = [n for n in names if n]
        if len(names) >= 3:
            # Find common prefix (word-level)
            words_lists = [n.split() for n in names]
            min_len = min(len(w) for w in words_lists)
            common_words = []
            for i in range(min_len):
                if all(w[i].lower() == words_lists[0][i].lower() for w in words_lists):
                    common_words.append(words_lists[0][i])
                else:
                    break
            if len(common_words) >= 2:
                prefix = " ".join(common_words)
                variants = [n[len(prefix):].strip(" -—") for n in names if n.startswith(prefix)]
                variants = [v for v in variants if v]
                if len(variants) >= 2:
                    return {
                        "type": "similar_names",
                        "common_prefix": prefix,
                        "variants": variants[:5],
                        "count": len(names),
                    }

    # ── Score cluster: top 10 all within 10 pts ──
    if len(scored) >= 5:
        top_scores = [r["suitability_score"] for r in scored[:10]]
        score_range = max(top_scores) - min(top_scores)
        if score_range <= 10:
            return {
                "type": "score_cluster",
                "score_range": [min(top_scores), max(top_scores)],
                "count": len(top_scores),
            }

    return None


def format_disambiguation_hint(ambiguity: dict) -> str:
    """Format an ambiguity descriptor into a context string for the LLM."""
    t = ambiguity["type"]

    if t == "vague_query":
        missing = ", ".join(ambiguity["missing"])
        return (
            f"\n[DISAMBIGUATION NEEDED] The query is broad ({ambiguity['count']} matches). "
            f"Present the top 3 results but ask the user to specify: {missing}."
        )

    if t == "multi_floor":
        floors = ", ".join(ambiguity["floors"])
        return (
            f"\n[DISAMBIGUATION NEEDED] {ambiguity['count']} {ambiguity['function']} spaces "
            f"found across {floors} with similar suitability. "
            f"Ask the user which floor they prefer or if they have a department preference."
        )

    if t == "similar_names":
        variants = ", ".join(ambiguity["variants"][:4])
        return (
            f"\n[DISAMBIGUATION NEEDED] Multiple similar spaces found: "
            f"{ambiguity['common_prefix']} variants ({variants}). "
            f"Ask which specific type or configuration the user needs."
        )

    if t == "score_cluster":
        lo, hi = ambiguity["score_range"]
        return (
            f"\n[DISAMBIGUATION NEEDED] {ambiguity['count']} spaces match equally well "
            f"(scores {lo}–{hi}). Ask for additional criteria: floor preference, "
            f"capacity needs, or specific equipment requirements."
        )

    return ""


# ══════════════════════════════════════════════════════════════════════
# Capacity Planning
# ══════════════════════════════════════════════════════════════════════

# Conference-style furnishing template (per-person estimates)
_CONFERENCE_FURNISHINGS = [
    ("desk_chair", 1.0),       # 1 chair per person
    ("table", 0.1),            # 1 table per 10 people
    ("monitor", 0.05),         # 1 screen per 20 people
]

# Minimum m² per person for different room types
_M2_PER_PERSON = {
    "conference": 1.8,
    "meeting": 2.0,
    "lecture": 1.2,
    "seminar": 1.5,
    "training": 2.0,
    "workshop": 2.5,
    "assembly": 1.0,
    "auditorium": 0.8,
    "event": 1.5,
}


def compute_capacity_plan(
    spaces: list[dict],
    target_capacity: int,
    target_function: str | None = None,
) -> list[dict]:
    """Find and rank spaces that could accommodate target_capacity people.

    Args:
        spaces: list of enriched space intelligence dicts
        target_capacity: number of people to accommodate
        target_function: optional function type (e.g. "conference", "lecture")

    Returns:
        Ranked list of viable spaces with viability_score and furnishing_gap.
    """
    m2_per_person = _M2_PER_PERSON.get(target_function, 1.5)
    min_area = target_capacity * m2_per_person * 0.7  # 30% tolerance

    results = []
    for s in spaces:
        area = s.get("area_m2") or 0
        if area < min_area:
            continue

        free_area = s.get("free_area_m2") or area
        abs_occ = s.get("absolute_occupancy") or 0
        max_occ = s.get("max_occupancy") or 0
        fn = (s.get("primary_function") or "").lower()

        # Viability score (0-100)
        score = 0.0

        # Area fit (40 pts): enough area for the target
        needed_area = target_capacity * m2_per_person
        if area >= needed_area:
            # Slight penalty for oversized rooms (prefer right-sized)
            overshoot = (area - needed_area) / max(needed_area, 1)
            score += max(20, 40 - 5 * min(overshoot, 4))
        else:
            score += 40 * (area / needed_area)

        # Existing capacity (30 pts): already has occupancy infrastructure
        existing_cap = max(abs_occ, max_occ)
        if existing_cap >= target_capacity:
            score += 30
        elif existing_cap > 0:
            score += 30 * (existing_cap / target_capacity)

        # Function match (20 pts)
        if target_function:
            if target_function in fn:
                score += 20
            elif any(kw in fn for kw in ["meeting", "conference", "office", "multi"]):
                score += 10

        # Free area available (10 pts)
        if free_area >= needed_area * 0.5:
            score += 10
        elif free_area > 0:
            score += 10 * (free_area / (needed_area * 0.5))

        # Compute furnishing gap
        furnishing_gap = []
        for item_type, per_person in _CONFERENCE_FURNISHINGS:
            needed = max(1, round(target_capacity * per_person))
            # Count existing furnishings of this type from facilities string
            existing = 0
            facilities = (s.get("facilities_available") or "").lower()
            if item_type.replace("_", " ") in facilities or item_type in facilities:
                # Try to extract count from "3x Chair" style strings
                import re as _re
                m = _re.search(r'(\d+)x?\s*' + _re.escape(item_type.replace("_", " ")), facilities)
                existing = int(m.group(1)) if m else 1

            if needed > existing:
                furnishing_gap.append({
                    "item": item_type.replace("_", " ").title(),
                    "needed": needed,
                    "existing": existing,
                })

        results.append({
            "space_name": s.get("space_name", "Unknown"),
            "floor_name": s.get("floor_name", s.get("floor_id", "?")),
            "area_m2": round(area, 1),
            "free_area_m2": round(free_area, 1) if free_area else 0,
            "absolute_occupancy": abs_occ,
            "max_occupancy": max_occ,
            "viability_score": round(score, 1),
            "furnishing_gap": furnishing_gap,
        })

    results.sort(key=lambda x: x["viability_score"], reverse=True)
    return results[:10]

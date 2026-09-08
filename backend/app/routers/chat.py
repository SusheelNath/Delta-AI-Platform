"""
Chat endpoint — streams Ollama responses via Server-Sent Events.

All data derives from polygons.json + computed polygon intelligence.
No DB Space table queries.

Actions are resolved deterministically (regex-based intent detection)
before the LLM streams its text narration. This guarantees that platform
actions (routing, floor navigation, space selection) execute instantly
without depending on LLM tool-calling behaviour.
"""

import json
import re
from collections import defaultdict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.polygon_intelligence import (
    read_all_polygons,
    compute_space_intelligence,
    get_floor_polygons,
    FLOOR_NAMES,
)
from app.services.ollama import stream_chat

router = APIRouter(tags=["chat"])


# ══════════════════════════════════════════════════════════════════════
# Deterministic action detection
# ══════════════════════════════════════════════════════════════════════

# Floor aliases → floor IDs
_FLOOR_MAP = {
    "basement 3": "H003", "basement3": "H003", "b3": "H003", "level -3": "H003",
    "basement 2": "H002", "basement2": "H002", "b2": "H002", "level -2": "H002",
    "basement 1": "H001", "basement1": "H001", "b1": "H001", "level -1": "H001",
    "ground floor": "H000", "ground": "H000", "level 0": "H000", "g": "H000",
    "floor 1": "H010", "floor1": "H010", "first floor": "H010", "level 1": "H010", "1st floor": "H010",
    "floor 2": "H020", "floor2": "H020", "second floor": "H020", "level 2": "H020", "2nd floor": "H020",
    "floor 3": "H030", "floor3": "H030", "third floor": "H030", "level 3": "H030", "3rd floor": "H030",
    "floor 4": "H040", "floor4": "H040", "fourth floor": "H040", "level 4": "H040", "4th floor": "H040",
    "floor 5": "H050", "floor5": "H050", "fifth floor": "H050", "level 5": "H050", "5th floor": "H050",
}

# Heatmap mode aliases
_HEATMAP_MODES = {
    "function": "function", "type": "function", "category": "function", "color by function": "function",
    "area": "area", "size": "area", "color by area": "area", "color by size": "area",
    "utilization": "utilization", "usage": "utilization", "used": "utilization",
    "status": "status", "operational": "status",
    "area per bed": "area_per_bed", "bed ratio": "area_per_bed", "area_per_bed": "area_per_bed",
}

# Category names for function filter
_CATEGORY_INDICES = {
    "medical": 0, "circulation": 1, "office": 2, "lab": 3,
    "support": 4, "storage": 5, "unassigned": 6,
}

# Compiled patterns
_RE_ELEVATOR = re.compile(
    r"\b(evacuat\w*\s+(to\s+)?(nearest\s+)?elevator|"
    r"nearest\s+elevator|route\s+to\s+elevator|"
    r"path\s+to\s+(the\s+)?elevator|"
    r"show\s+(me\s+)?(the\s+)?elevator\s+route|"
    r"closest\s+elevator|find\s+(me\s+)?(a\s+)?elevator|"
    r"bring\s+me\s+to\s+(the\s+)?elevator|"
    r"point\s+(me\s+)?to\s+(the\s+)?elevator|"
    r"nearest\s+lift|route\s+to\s+lift|evacuat\w*\s+(to\s+)?(nearest\s+)?lift|"
    r"elevator\s+evacuat\w*)\b",
    re.IGNORECASE,
)

_RE_STAIRCASE = re.compile(
    r"\b(evacuat\w*\s+(to\s+)?(nearest\s+)?stair\w*|"
    r"nearest\s+stair\w*|route\s+to\s+stair\w*|"
    r"path\s+to\s+(the\s+)?stair\w*|"
    r"show\s+(me\s+)?(the\s+)?stair\w*\s+route|"
    r"closest\s+stair\w*|find\s+(me\s+)?(a\s+)?stair\w*|"
    r"bring\s+me\s+to\s+(the\s+)?stair\w*|"
    r"point\s+(me\s+)?to\s+(the\s+)?stair\w*|"
    r"stair\w*\s+evacuat\w*)\b",
    re.IGNORECASE,
)

_RE_SHOW_ALL_FLOORS = re.compile(
    r"\b(show\s+all\s+floors|all\s+floors|whole\s+building|entire\s+building|full\s+building)\b",
    re.IGNORECASE,
)

_RE_CLEAR_ROUTE = re.compile(
    r"\b(clear\s+(the\s+)?route|hide\s+(the\s+)?route|remove\s+(the\s+)?route|"
    r"hide\s+(the\s+)?path|clear\s+(the\s+)?path)\b",
    re.IGNORECASE,
)

_RE_CLEAR_SELECTION = re.compile(
    r"\b(clear\s+selection|deselect|clear\s+selected|unselect)\b",
    re.IGNORECASE,
)

_RE_SET_FLOOR = re.compile(
    r"\b(go\s+to|navigate\s+to|show\s+me|show|switch\s+to|take\s+me\s+to|fly\s+to)\s+"
    r"(the\s+)?"
    r"(basement\s*\d|ground\s*floor|ground|floor\s*\d|first\s+floor|second\s+floor|"
    r"third\s+floor|fourth\s+floor|fifth\s+floor|\d+(?:st|nd|rd|th)\s+floor|"
    r"level\s+[-\d]+|b[123]|g)\b",
    re.IGNORECASE,
)

_RE_HEATMAP = re.compile(
    r"\b(heatmap|heat\s+map|color\s+by|colour\s+by)\s*(.*)",
    re.IGNORECASE,
)

_RE_SELECT_SPACE = re.compile(
    r"\b(go\s+to|navigate\s+to|show\s+me|select|inspect|zoom\s+(to|in\s+on)|"
    r"fly\s+to|take\s+me\s+to|bring\s+me\s+to|point\s+(me\s+)?to)\s+"
    r"(the\s+)?(.+)",
    re.IGNORECASE,
)

_RE_EXPAND_GROUP = re.compile(
    r"\b(open|expand|show)\s+(the\s+)?(.+?)\s+(dropdown|directory|list|group|category)\b",
    re.IGNORECASE,
)

_RE_SELECT_ROOM = re.compile(
    r"\b(?:select|show|pick|choose)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(?:room|space|unit)\s+(?:in|from|of)\s+(?:the\s+)?(.+?)(?:\s+(?:dropdown|directory|list|group|category))?\s*$",
    re.IGNORECASE,
)

_RE_TOGGLE_FILTER = re.compile(
    r"\b(show|hide|toggle|filter)\s+(the\s+)?"
    r"(medical|circulation|office|lab|support|storage|unassigned)\s*(spaces|rooms|category)?\b",
    re.IGNORECASE,
)


def _find_polygon_by_name(name: str, polygons: list[dict]) -> dict | None:
    """Find a polygon by name (exact then contains match)."""
    search = name.lower().strip()
    if not search:
        return None
    # Exact match
    for p in polygons:
        if (p.get("space_name") or "").lower() == search:
            return p
    # Contains match
    for p in polygons:
        if search in (p.get("space_name") or "").lower():
            return p
    # Function match
    for p in polygons:
        if search in (p.get("primary_function") or "").lower():
            return p
    return None


def _resolve_floor_id(text: str) -> str | None:
    """Extract a floor ID from natural language text."""
    text_lower = text.lower().strip()
    for alias, fid in _FLOOR_MAP.items():
        if alias in text_lower:
            return fid
    return None


def detect_actions(
    user_message: str,
    selected_space: dict | None,
    polygons: list[dict] | None = None,
) -> list[tuple[dict, str]]:
    """Detect deterministic actions from the user message.

    Returns a list of (action_dict, confirmation_text) tuples.
    Actions are fired in order before LLM streaming begins.
    """
    msg = user_message.strip()
    if not msg:
        return []

    actions = []

    # ── Route to elevator ──
    if _RE_ELEVATOR.search(msg):
        space_name = (selected_space or {}).get("space_name", "")
        if space_name:
            actions.append((
                {"type": "route_to_elevator", "space_name": space_name},
                f"Routing to nearest elevator from **{space_name}**...",
            ))
            return actions  # route is exclusive

    # ── Route to staircase ──
    if _RE_STAIRCASE.search(msg):
        space_name = (selected_space or {}).get("space_name", "")
        if space_name:
            actions.append((
                {"type": "route_to_staircase", "space_name": space_name},
                f"Routing to nearest staircase from **{space_name}**...",
            ))
            return actions

    # ── Clear route ──
    if _RE_CLEAR_ROUTE.search(msg):
        actions.append(({"type": "clear_route"}, "Clearing route."))
        return actions

    # ── Clear selection ──
    if _RE_CLEAR_SELECTION.search(msg):
        actions.append(({"type": "clear_selection"}, "Clearing selection."))
        return actions

    # ── Show all floors ──
    if _RE_SHOW_ALL_FLOORS.search(msg):
        actions.append(({"type": "show_all_floors"}, "Showing all floors."))
        return actions

    # ── Set floor ──
    if _RE_SET_FLOOR.search(msg):
        fid = _resolve_floor_id(msg)
        if fid:
            fname = FLOOR_NAMES.get(fid, fid)
            actions.append((
                {"type": "set_floor", "floor_id": fid},
                f"Navigating to **{fname}**...",
            ))
            return actions

    # ── Heatmap ──
    m = _RE_HEATMAP.search(msg)
    if m:
        mode_text = (m.group(2) or "").strip().lower()
        # Also check the full message for mode keywords
        if not mode_text:
            mode_text = msg.lower()
        for alias, mode in _HEATMAP_MODES.items():
            if alias in mode_text or alias in msg.lower():
                actions.append((
                    {"type": "set_heatmap", "mode": mode},
                    f"Switching to **{mode}** heatmap.",
                ))
                return actions

    # ── Toggle function filter ──
    m = _RE_TOGGLE_FILTER.search(msg)
    if m:
        cat = m.group(3).lower()
        idx = _CATEGORY_INDICES.get(cat, -1)
        if idx >= 0:
            actions.append((
                {"type": "toggle_function_filter", "category_index": idx, "category": cat.title()},
                f"Toggling **{cat.title()}** spaces.",
            ))
            return actions

    # ── Select room in group ──
    m = _RE_SELECT_ROOM.search(msg)
    if m:
        room_index = int(m.group(1))
        fn_name = m.group(2).strip()
        actions.append((
            {"type": "select_room_in_group", "function_name": fn_name, "room_index": room_index},
            f"Selecting the **{room_index}{'st' if room_index == 1 else 'nd' if room_index == 2 else 'rd' if room_index == 3 else 'th'}** room in **{fn_name}**...",
        ))
        return actions

    # ── Expand directory group ──
    m = _RE_EXPAND_GROUP.search(msg)
    if m:
        fn_name = m.group(3).strip()
        actions.append((
            {"type": "expand_directory_group", "function_name": fn_name},
            f"Opening **{fn_name}** directory...",
        ))
        return actions

    # ── Select space (must be last — broad pattern) ──
    m = _RE_SELECT_SPACE.search(msg)
    if m:
        space_text = m.group(5).strip().rstrip("?.!")
        # Don't match if it looks like a floor navigation (already handled above)
        if not _resolve_floor_id(space_text) and len(space_text) > 2:
            if polygons is None:
                polygons = read_all_polygons()
            poly = _find_polygon_by_name(space_text, polygons)
            if poly:
                actions.append((
                    {"type": "select_space", "space_name": poly.get("space_name", space_text)},
                    f"Selecting **{poly.get('space_name', space_text)}**...",
                ))
                return actions

    return actions


class ChatMessage(BaseModel):
    role: str  # "user" or "delta"
    text: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    selected_space_id: str | None = None


def _build_floor_summaries() -> str:
    """Build aggregate floor summaries from polygon data."""
    polygons = read_all_polygons()
    if not polygons:
        return ""

    floors = defaultdict(lambda: {"count": 0, "area": 0.0, "funcs": defaultdict(lambda: {"n": 0, "a": 0.0})})

    for p in polygons:
        fid = p.get("floor_id", "?")
        area = p.get("area_m2") or 0
        fn = p.get("primary_function") or "Unknown"
        floors[fid]["count"] += 1
        floors[fid]["area"] += area
        floors[fid]["funcs"][fn]["n"] += 1
        floors[fid]["funcs"][fn]["a"] += area

    total_spaces = sum(f["count"] for f in floors.values())
    total_area = sum(f["area"] for f in floors.values())

    lines = [f"\n[Hospital spatial summary — {total_spaces} mapped spaces, {total_area:.0f} m² across {len(floors)} floors]"]
    for fid in sorted(floors.keys()):
        fd = floors[fid]
        fname = FLOOR_NAMES.get(fid, fid)
        lines.append(f"\n{fname} ({fid}): {fd['count']} spaces, {fd['area']:.0f} m²")
        ranked = sorted(fd["funcs"].items(), key=lambda x: -x[1]["a"])[:6]
        for fn, data in ranked:
            pct = (data["a"] / fd["area"] * 100) if fd["area"] > 0 else 0
            lines.append(f"  {fn}: {data['n']} spaces, {data['a']:.0f} m² ({pct:.0f}%)")

    return "\n".join(lines)


def _resolve_selected_space(space_id: str, db: Session) -> dict | None:
    """Resolve selected space from polygon data + computed intelligence."""
    polygons = read_all_polygons()
    poly = next((p for p in polygons if p.get("ifc_guid") == space_id), None)

    if not poly:
        return None

    floor_id = poly.get("floor_id", "")
    floor_polygons = get_floor_polygons(floor_id, polygons)
    return compute_space_intelligence(poly, floor_polygons, db)


def _auto_search(user_message: str, db: Session) -> list[dict]:
    """Search polygons using full intelligence fields.

    Extracts search terms from the user message, computes intelligence for
    all polygons on relevant floors (or all floors), then matches against
    every enriched field: space_name, primary_function, functional_zone,
    space_class, occupancy_class, facilities, access_level, privacy_level,
    visitor_access, noise_sensitivity, flexibility, secondary_functions, etc.
    """
    msg_lower = user_message.lower()

    # Extract meaningful search tokens (skip stop words)
    STOP_WORDS = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "shall",
        "should", "may", "might", "must", "can", "could", "i", "me", "my",
        "we", "our", "you", "your", "it", "its", "they", "them", "their",
        "this", "that", "these", "those", "what", "which", "who", "whom",
        "how", "where", "when", "why", "if", "or", "and", "but", "not",
        "no", "so", "than", "too", "very", "just", "about", "above",
        "after", "before", "between", "from", "in", "into", "of", "on",
        "out", "to", "up", "with", "for", "at", "by", "as", "all", "any",
        "each", "every", "both", "few", "more", "most", "other", "some",
        "such", "only", "own", "same", "tell", "show", "find", "list",
        "give", "get", "many", "much", "also", "there", "here", "then",
        "delta", "hospital", "spaces", "rooms", "room", "space", "please",
    }
    words = re.findall(r'[a-z]+', msg_lower)
    tokens = [w for w in words if w not in STOP_WORDS and len(w) > 1]
    if not tokens:
        return []

    # Also check for multi-word phrases
    phrases = []
    MULTI_WORD = [
        "patient room", "patient care", "operating room", "operating theatre",
        "single patient", "double patient", "waiting room", "staff office",
        "high privacy", "very high privacy", "low privacy",
        "no access", "step free", "inpatient care", "outpatient",
        "surgical table", "patient monitor", "gas outlet",
    ]
    for phrase in MULTI_WORD:
        if phrase in msg_lower:
            phrases.append(phrase)

    search_terms = tokens + phrases

    # Build full intelligence index for all polygons
    polygons = read_all_polygons()
    results = []

    # Group polygons by floor for efficient spatial computation
    from app.services.geometry import compute_floor_spatial
    floor_groups = defaultdict(list)
    for p in polygons:
        floor_groups[p.get("floor_id", "")].append(p)

    floor_spatials = {}
    for fid, fps in floor_groups.items():
        floor_spatials[fid] = compute_floor_spatial(fps)

    for p in polygons:
        fid = p.get("floor_id", "")
        floor_polys = floor_groups.get(fid, [])
        intel = compute_space_intelligence(p, floor_polys, db, floor_spatials.get(fid))

        # Build a searchable text blob from all intelligence fields
        searchable_parts = [
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
        blob = " ".join(searchable_parts).lower()

        # Match: any search term must appear in the blob
        if any(term in blob for term in search_terms):
            results.append(intel)
            if len(results) >= 30:
                break

    return results


@router.post("/chat")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    # Resolve selected space (polygon-only)
    selected_space = None
    if body.selected_space_id:
        selected_space = _resolve_selected_space(body.selected_space_id, db)

    # Auto-search for relevant spaces based on the latest user message
    search_results = []
    user_messages = [m for m in body.messages if m.role == "user"]
    latest_user_text = user_messages[-1].text if user_messages else ""
    if latest_user_text:
        search_results = _auto_search(latest_user_text, db)

    # Deterministic action detection — fires before LLM
    detected_actions = detect_actions(latest_user_text, selected_space)

    # Build floor summaries from polygon data
    floor_summaries = _build_floor_summaries()

    conversation = [{"role": m.role, "text": m.text} for m in body.messages]

    async def generate():
        try:
            # Emit deterministic actions first (instant, no LLM wait)
            for action, confirmation in detected_actions:
                yield f"data: [ACTION]{json.dumps(action)}\n\n"
                safe_confirm = confirmation.replace("\n", "\\n")
                yield f"data: {safe_confirm}\n\n"

            # Stream LLM narration (no tools — actions already handled)
            async for token in stream_chat(conversation, selected_space, search_results, floor_summaries):
                safe = token.replace("\n", "\\n")
                yield f"data: {safe}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

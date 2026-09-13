"""
Chat endpoint — streams Ollama responses via Server-Sent Events.

All data derives from polygons.json + computed polygon intelligence.
No DB Space table queries.

Actions are resolved deterministically (intent parser) before the LLM
streams its text narration. This guarantees that platform actions
(routing, floor navigation, space selection, heatmaps) execute instantly
without depending on LLM tool-calling behaviour.
"""

import json
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.intelligence_cache import (
    get_cached_intelligence,
    get_all_intelligence,
    get_search_blobs,
    get_floor_summaries,
    get_rooms_by_function,
    get_floor_group_summary,
)
from app.services.ollama import stream_chat
from app.services.response_templates import try_render_template
from app.services.scoring import (
    analyze_query_intent,
    compute_suitability_score,
    detect_ambiguity,
    format_disambiguation_hint,
)
from app.services.intent_parser import parse_intents, intents_to_actions

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: str  # "user" or "delta"
    text: str


class IntentRequest(BaseModel):
    message: str
    selected_space_id: str | None = None
    active_floor_id: str | None = None
    expanded_group: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    selected_space_id: str | None = None
    active_floor_id: str | None = None
    expanded_group: str | None = None
    skip_actions: bool = False


def _build_floor_summaries() -> str:
    """Return pre-built floor summaries from cache."""
    return get_floor_summaries()


def _build_action_context(
    detected_actions: list[tuple[dict, str]],
    active_floor_id: str | None = None,
) -> str | None:
    """Build hierarchical context for the LLM based on executed actions.

    Decision tree — each tier injects the COMPLETE data for that level so the
    LLM only narrates facts, never searches or invents:
      Tier 1  set_floor            → floor group summary (all groups + counts)
      Tier 2  expand_directory     → room list for that group (index, name, area, occ)
      Tier 3  select_room / space  → full room intelligence
      Tier 4  route / adjacency    → resolved spatial targets + distances
    """
    from app.services.polygon_intelligence import FLOOR_NAMES

    parts = []

    # Resolve effective floor — use navigated floor if set_floor in this batch
    effective_fid = active_floor_id
    for a, _ in detected_actions:
        if a.get("type") == "set_floor":
            effective_fid = a.get("floor_id", effective_fid)

    for action, confirmation in detected_actions:
        atype = action.get("type")

        # ── TIER 1: Floor navigation ──
        if atype == "set_floor":
            fid = action.get("floor_id", "")
            fname = FLOOR_NAMES.get(fid, fid)
            groups = get_floor_group_summary(fid)
            total_rooms = sum(g["count"] for g in groups)
            total_area = sum(g["total_area"] for g in groups)
            lines = [f"NAVIGATED TO: {fname} — {total_rooms} spaces, {total_area:,.0f} m²."]
            lines.append("Function groups on this floor (use ONLY these names and counts):")
            for g in groups:
                area_str = f"{g['total_area']:,.0f} m²"
                occ_str = f", total max occupancy {g['max_occupancy']}" if g["max_occupancy"] else ""
                lines.append(f"- {g['function']}: {g['count']} rooms, {area_str}{occ_str}")
            parts.append("\n".join(lines))

        # ── TIER 2: Directory group opened ──
        elif atype == "expand_directory_group":
            fn_name = action.get("function_name", "")
            search_fid = effective_fid
            # Fallback: if no active floor, search all floors for this function
            if not search_fid:
                for fid in FLOOR_NAMES:
                    if get_rooms_by_function(fid, fn_name):
                        search_fid = fid
                        break
            if search_fid:
                rooms = get_rooms_by_function(search_fid, fn_name)
                fname = FLOOR_NAMES.get(search_fid, search_fid)
                if rooms:
                    lines = [f"DIRECTORY OPENED: **{fn_name}** on {fname} — {len(rooms)} rooms."]
                    lines.append("List ONLY these rooms with their EXACT data. Do NOT invent rooms or values:")
                    for idx, r in enumerate(rooms, 1):
                        entry = f"- [{idx}] {r.get('space_name', '?')}"
                        area = r.get("area_m2")
                        if area:
                            entry += f", {round(area, 1)} m²"
                        max_occ = r.get("max_occupancy")
                        if max_occ:
                            entry += f", max occupancy {max_occ}"
                        fac = r.get("facilities_available")
                        if fac:
                            entry += f", furnishings: {fac}"
                        lines.append(entry)
                    parts.append("\n".join(lines))
                else:
                    parts.append(f"DIRECTORY OPENED: **{fn_name}** — no matching rooms found on this floor.")
            else:
                parts.append(f"DIRECTORY OPENED: **{fn_name}** — no floor is currently active. Navigate to a floor first.")

        # ── TIER 3: Room selected (from group ordinal or direct) ──
        elif atype == "select_room_in_group":
            fn_name = action.get("function_name", "")
            room_idx = action.get("room_index", 1)
            search_fid = effective_fid
            if not search_fid:
                for fid in FLOOR_NAMES:
                    if get_rooms_by_function(fid, fn_name):
                        search_fid = fid
                        break
            if search_fid:
                rooms = get_rooms_by_function(search_fid, fn_name)
                idx_0 = min(room_idx - 1, len(rooms) - 1) if rooms else -1
                if idx_0 >= 0:
                    r = rooms[idx_0]
                    guid = r.get("ifc_guid", "")
                    intel = get_cached_intelligence(guid)
                    if intel:
                        parts.append(_format_room_context(intel, idx_0 + 1, fn_name))

        elif atype == "select_space":
            intel = action.get("_resolved_intel")
            if intel:
                parts.append(_format_room_context(intel))

        # ── TIER 4: Routing / spatial actions ──
        elif atype in ("route_to_elevator", "route_to_staircase"):
            target_type = "elevator" if "elevator" in atype else "staircase"
            space_name = action.get("space_name", "")
            # The room's intelligence has the nearest lift/stair precomputed
            if space_name and effective_fid:
                # Find the source room's intelligence
                for guid, intel in get_all_intelligence().items():
                    if intel.get("space_name") == space_name and intel.get("floor_id") == effective_fid:
                        if target_type == "elevator":
                            target = intel.get("nearest_lift", "Unknown")
                            dist = intel.get("lift_distance_m", "?")
                        else:
                            target = intel.get("nearest_stair", "Unknown")
                            dist = intel.get("stair_distance_m", "?")
                        step_free = intel.get("step_free_access", "Unknown")
                        lines = [f"ROUTING from **{space_name}** to nearest {target_type}:"]
                        lines.append(f"- Target: {target}")
                        lines.append(f"- Distance: {dist}m")
                        lines.append(f"- Step-free access: {step_free}")
                        parts.append("\n".join(lines))
                        break

        elif atype == "highlight_adjacent":
            space_name = action.get("space_name", "")
            if space_name and effective_fid:
                for guid, intel in get_all_intelligence().items():
                    if intel.get("space_name") == space_name and intel.get("floor_id") == effective_fid:
                        adj_str = intel.get("adjacent_spaces", "")
                        if adj_str:
                            adj_names = [a.strip() for a in adj_str.split(",")]
                            lines = [f"ADJACENT SPACES to **{space_name}** ({len(adj_names)} found):"]
                            for an in adj_names:
                                # Resolve to real intelligence if possible
                                adj_intel = None
                                for ag, ai in get_all_intelligence().items():
                                    if ai.get("space_name", "").lower() == an.lower() and ai.get("floor_id") == effective_fid:
                                        adj_intel = ai
                                        break
                                if adj_intel:
                                    area = adj_intel.get("area_m2")
                                    fn = adj_intel.get("primary_function", "")
                                    area_str = f", {round(area, 1)} m²" if area else ""
                                    lines.append(f"- {an} ({fn}{area_str})")
                                else:
                                    lines.append(f"- {an}")
                            parts.append("\n".join(lines))
                        break

    if not parts:
        return None
    return "ACTIONS EXECUTED:\n" + "\n".join(parts)


def _format_room_context(intel: dict, index: int | None = None, group: str | None = None) -> str:
    """Format full room intelligence for Tier 3 action context.

    Includes all polygon-derived fields. The LLM must use ONLY this data.
    """
    from app.services.polygon_intelligence import FLOOR_NAMES

    header = "SELECTED ROOM"
    if index and group:
        header = f"SELECTED ROOM #{index} from {group}"
    name = intel.get("space_name", "Unknown")
    fname = FLOOR_NAMES.get(intel.get("floor_id", ""), intel.get("floor_id", ""))

    lines = [f"{header}: **{name}** on {fname}"]
    lines.append("Describe THIS room using ONLY the data below. Do NOT invent values:")

    # Identity
    if intel.get("primary_function"):
        lines.append(f"- Function: {intel['primary_function']}")
    if intel.get("secondary_functions"):
        lines.append(f"- Secondary functions: {intel['secondary_functions']}")
    if intel.get("functional_zone"):
        lines.append(f"- Zone: {intel['functional_zone']}")

    # Physical
    area = intel.get("area_m2")
    if area:
        lines.append(f"- Area: {round(area, 1)} m²")
    if intel.get("perimeter_cm"):
        lines.append(f"- Perimeter: {intel['perimeter_cm']} cm")

    # Occupancy
    if intel.get("normal_occupancy"):
        lines.append(f"- Normal occupancy: {intel['normal_occupancy']}")
    if intel.get("max_occupancy"):
        lines.append(f"- Max occupancy: {intel['max_occupancy']}")
    if intel.get("absolute_occupancy"):
        lines.append(f"- Absolute occupancy: {intel['absolute_occupancy']}")
    if intel.get("patient_capacity"):
        lines.append(f"- Patient capacity: {intel['patient_capacity']}")

    # Access & privacy
    if intel.get("access_level"):
        lines.append(f"- Access: {intel['access_level']}")
    if intel.get("privacy_level"):
        lines.append(f"- Privacy: {intel['privacy_level']}")
    if intel.get("accessible"):
        lines.append(f"- Accessible: {intel['accessible']}")
    if intel.get("bookable") and intel["bookable"] != "No":
        lines.append(f"- Bookable: {intel['bookable']}")
    if intel.get("visitor_access"):
        lines.append(f"- Visitor access: {intel['visitor_access']}")

    # Spatial
    if intel.get("nearest_lift"):
        dist = f" ({intel['lift_distance_m']}m)" if intel.get("lift_distance_m") else ""
        lines.append(f"- Nearest elevator: {intel['nearest_lift']}{dist}")
    if intel.get("nearest_stair"):
        dist = f" ({intel['stair_distance_m']}m)" if intel.get("stair_distance_m") else ""
        lines.append(f"- Nearest staircase: {intel['nearest_stair']}{dist}")
    if intel.get("step_free_access"):
        lines.append(f"- Step-free access: {intel['step_free_access']}")
    if intel.get("adjacent_spaces"):
        lines.append(f"- Adjacent: {intel['adjacent_spaces']}")

    # Furnishings
    if intel.get("facilities_available"):
        lines.append(f"- Furnishings: {intel['facilities_available']}")

    # Flexibility
    if intel.get("flexibility"):
        lines.append(f"- Flexibility: {intel['flexibility']}")
    if intel.get("convertible_functions"):
        lines.append(f"- Convertible to: {intel['convertible_functions']}")
    if intel.get("noise_sensitivity"):
        lines.append(f"- Noise sensitivity: {intel['noise_sensitivity']}")

    return "\n".join(lines)


def _resolve_selected_space(space_id: str, db: Session) -> dict | None:
    """Look up selected space from cache. O(1)."""
    return get_cached_intelligence(space_id)


def _enrich_room_selection(
    detected_actions: list[tuple[dict, str]],
    active_floor_id: str | None,
    selected_space_id: str | None = None,
) -> list[tuple[dict, str]]:
    """Resolve select_room_in_group and select_room_relative actions into
    concrete select_space + toggle_drawer actions.

    Handles: chained floor navigation, no-floor warnings, ordinal overflow,
    last-room sentinel (-1), and next/previous relative navigation.
    """
    # Pre-scan: if a set_floor action appears anywhere in the list, use that
    # floor for room resolution (handles "go to floor 2 + select 3rd office"
    # regardless of action ordering).
    effective_floor_id = active_floor_id
    for action, _ in detected_actions:
        if action.get("type") == "set_floor":
            effective_floor_id = action.get("floor_id", effective_floor_id)

    enriched: list[tuple[dict, str]] = []

    for action, confirmation in detected_actions:
        atype = action.get("type")

        # Pass through floor navigation unchanged
        if atype == "set_floor":
            enriched.append((action, confirmation))
            continue

        if atype == "select_room_in_group":
            if not effective_floor_id:
                enriched.append((
                    {"type": "no_selection_hint", "intent": "floor_required"},
                    "Please navigate to a floor first so I can find rooms.",
                ))
                continue

            fn_name = action.get("function_name", "")
            room_idx = action.get("room_index", 1)  # 1-based, or -1 for "last"
            rooms = get_rooms_by_function(effective_floor_id, fn_name)

            if not rooms:
                enriched.append((
                    {"type": "no_selection_hint", "intent": "no_rooms"},
                    f"No **{fn_name}** rooms found on this floor.",
                ))
                continue

            # Resolve index: -1 = last, >count = clamp with warning
            if room_idx == -1:
                actual_idx = len(rooms) - 1
            elif room_idx > len(rooms):
                actual_idx = len(rooms) - 1
                confirmation = (
                    f"There are only **{len(rooms)}** {fn_name} rooms "
                    f"— selecting **#{len(rooms)}**."
                )
            else:
                actual_idx = room_idx - 1

            room = rooms[actual_idx]
            ifc_guid = room.get("ifc_guid")
            if not ifc_guid:
                enriched.append((action, confirmation))
                continue

            # Correct confirmation when fuzzy matching resolved a typo
            resolved_fn = room.get("primary_function") or fn_name
            if resolved_fn.lower() != fn_name.lower():
                if room_idx == -1:
                    confirmation = f"Selecting the **last** room in **{resolved_fn}**..."
                elif room_idx > len(rooms):
                    confirmation = (
                        f"There are only **{len(rooms)}** {resolved_fn} rooms "
                        f"— selecting **#{len(rooms)}**."
                    )
                else:
                    confirmation = f"Selecting room **#{room_idx}** in **{resolved_fn}**..."

            space_name = room.get("space_name") or fn_name
            enriched.append((action, confirmation))
            enriched.append((
                {
                    "type": "select_space",
                    "space_id": ifc_guid,
                    "_resolved_intel": room,
                },
                f"Selecting **{space_name}**...",
            ))
            enriched.append((
                {"type": "toggle_drawer", "action": "open"},
                "Opening space details...",
            ))
            continue

        if atype == "select_room_relative":
            if not effective_floor_id:
                enriched.append((
                    {"type": "no_selection_hint", "intent": "floor_required"},
                    "Please navigate to a floor first.",
                ))
                continue

            fn_name = action.get("function_name", "")
            direction = action.get("direction", "next")

            if not fn_name:
                enriched.append((
                    {"type": "no_selection_hint", "intent": "no_group"},
                    "Please expand a room group first, then ask for the next or previous room.",
                ))
                continue

            rooms = get_rooms_by_function(effective_floor_id, fn_name)
            if not rooms:
                enriched.append((
                    {"type": "no_selection_hint", "intent": "no_rooms"},
                    f"No **{fn_name}** rooms found on this floor.",
                ))
                continue

            # Find current room's position in the group
            current_idx = -1
            if selected_space_id:
                for i, r in enumerate(rooms):
                    if r.get("ifc_guid") == selected_space_id:
                        current_idx = i
                        break

            if current_idx == -1:
                # Not on any room in this group — pick first or last
                new_idx = 0 if direction == "next" else len(rooms) - 1
            elif direction == "next":
                new_idx = current_idx + 1
                if new_idx >= len(rooms):
                    enriched.append((
                        {"type": "no_selection_hint", "intent": "group_boundary"},
                        f"Already at the last **{fn_name}** room ({len(rooms)} total).",
                    ))
                    continue
            else:
                new_idx = current_idx - 1
                if new_idx < 0:
                    enriched.append((
                        {"type": "no_selection_hint", "intent": "group_boundary"},
                        f"Already at the first **{fn_name}** room.",
                    ))
                    continue

            room = rooms[new_idx]
            ifc_guid = room.get("ifc_guid")
            if not ifc_guid:
                enriched.append((action, confirmation))
                continue

            space_name = room.get("space_name") or fn_name
            enriched.append((
                {
                    "type": "select_space",
                    "space_id": ifc_guid,
                    "_resolved_intel": room,
                },
                f"Selecting **{space_name}** (#{new_idx + 1} of {len(rooms)})...",
            ))
            enriched.append((
                {"type": "toggle_drawer", "action": "open"},
                "Opening space details...",
            ))
            continue

        # Pass through all other actions unchanged
        enriched.append((action, confirmation))

    return enriched


_STOP_WORDS = {
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

_MULTI_WORD = [
    "patient room", "patient care", "operating room", "operating theatre",
    "single patient", "double patient", "waiting room", "staff office",
    "high privacy", "very high privacy", "low privacy",
    "no access", "step free", "inpatient care", "outpatient",
    "surgical table", "patient monitor", "gas outlet",
]


def _auto_search(
    user_message: str,
    db: Session,
    learnings: list[dict] | None = None,
) -> tuple[list[dict], "QueryIntent | None", dict | None]:
    """Search cached intelligence blobs, score, and detect ambiguity.

    Returns (scored_results, intent, ambiguity_hint).
    Results are sorted by suitability score descending, capped at 20.
    """
    msg_lower = user_message.lower()

    words = re.findall(r'[a-z]+', msg_lower)
    tokens = [w for w in words if w not in _STOP_WORDS and len(w) > 1]
    if not tokens:
        return [], None, None

    phrases = [p for p in _MULTI_WORD if p in msg_lower]
    search_terms = tokens + phrases

    # Search cached blobs — no disk I/O, no DB queries
    intelligence = get_all_intelligence()
    search_blobs = get_search_blobs()
    matches = []

    for ifc_guid, blob in search_blobs.items():
        if any(term in blob for term in search_terms):
            # Shallow copy: scoring adds suitability_score, must not mutate cache
            matches.append(dict(intelligence[ifc_guid]))

    if not matches:
        return [], None, None

    # Score and sort by suitability
    intent = analyze_query_intent(user_message)
    for m in matches:
        m["suitability_score"] = compute_suitability_score(m, intent, learnings)

    matches.sort(key=lambda x: x["suitability_score"], reverse=True)
    results = matches[:20]

    ambiguity = detect_ambiguity(results, intent, learnings)
    return results, intent, ambiguity


@router.post("/intents")
def detect_intents(body: IntentRequest):
    """Lightweight intent detection — returns actions as JSON, no LLM call.

    Returns actions, confirmations, and optionally rich markdown content.
    When content is non-null, the frontend can display it directly and
    skip the /chat endpoint entirely (Phase 1-only resolution).
    """
    selected_space = None
    if body.selected_space_id:
        selected_space = get_cached_intelligence(body.selected_space_id)

    parsed_list = parse_intents(body.message, expanded_group=body.expanded_group)
    detected_actions = intents_to_actions(parsed_list, selected_space, body.active_floor_id)

    # Enrich select_room_in_group: resolve actual room and add select_space action
    enriched = _enrich_room_selection(detected_actions, body.active_floor_id, body.selected_space_id)

    # Try to render a deterministic template response (room card, floor overview, etc.)
    # When content is non-null, the frontend can skip Phase 2 entirely.
    content = None
    _LLM_REQUIRED_INTENTS = {"query", "evacuate", "capacity_plan"}
    intent_types = {p.intent_type for p in parsed_list}
    is_deterministic = len(enriched) > 0 and not (intent_types & _LLM_REQUIRED_INTENTS)

    if is_deterministic:
        content = try_render_template(enriched, body.active_floor_id)
        # Pure UI actions (clear_all, zoom, toggle, etc.) have no template —
        # use the last confirmation as the chat response
        if content is None:
            confirmations = [c.replace("**", "") for _, c in enriched]
            content = " ".join(confirmations)

    # Strip internal keys before sending to frontend
    clean_actions = [{k: v for k, v in a.items() if not k.startswith("_")} for a, _ in enriched]
    return {
        "actions": clean_actions,
        "confirmations": [confirm for _, confirm in enriched],
        "content": content,
    }


@router.post("/chat")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    # Resolve selected space (polygon-only)
    selected_space = None
    if body.selected_space_id:
        selected_space = _resolve_selected_space(body.selected_space_id, db)

    # Fetch user learnings for scoring boost + context injection
    learnings = []
    try:
        from app.models import UserLearning
        learnings_rows = (
            db.query(UserLearning)
            .order_by(
                (UserLearning.confidence * UserLearning.observation_count).desc()
            )
            .limit(5)
            .all()
        )
        learnings = [
            {
                "learning_type": lr.learning_type,
                "content": lr.content,
                "confidence": lr.confidence,
            }
            for lr in learnings_rows
        ]
    except Exception:
        pass  # Table may not exist yet

    # Auto-search with scoring + disambiguation
    search_results = []
    disambiguation_hint = None
    user_messages = [m for m in body.messages if m.role == "user"]
    latest_user_text = user_messages[-1].text if user_messages else ""
    if latest_user_text:
        search_results, intent, ambiguity = _auto_search(latest_user_text, db, learnings)
        if ambiguity:
            disambiguation_hint = format_disambiguation_hint(ambiguity)

    # Deterministic action detection — fires before LLM (supports chained actions)
    parsed_list = parse_intents(latest_user_text, expanded_group=body.expanded_group)
    detected_actions = intents_to_actions(parsed_list, selected_space, body.active_floor_id)

    # Enrich select_room_in_group: resolve actual room and add select_space action
    detected_actions = _enrich_room_selection(detected_actions, body.active_floor_id, body.selected_space_id)

    # If a room was resolved via select_room_in_group, use it as selected_space for LLM
    for action, _ in detected_actions:
        if action.get("type") == "select_space" and action.get("_resolved_intel"):
            selected_space = action["_resolved_intel"]
            break

    # Build floor summaries from polygon data
    floor_summaries = _build_floor_summaries()

    # Evacuation / capacity planning context injection
    evacuation_context = None
    capacity_plan_context = None

    # Check parsed intents for evacuation / capacity planning context
    intent_types = {p.intent_type for p in parsed_list}

    if "evacuate" in intent_types and search_results:
        from app.services.ollama import _format_evacuation_context
        evac_candidates = [
            s for s in search_results
            if (s.get("absolute_occupancy") or 0) > 0
            and s.get("occupiable")
        ]
        if not evac_candidates:
            evac_candidates = [s for s in search_results if (s.get("absolute_occupancy") or 0) > 0]
        evac_candidates.sort(key=lambda x: x.get("absolute_occupancy", 0), reverse=True)
        evacuation_context = _format_evacuation_context(evac_candidates[:10])

    capacity_intent = next((p for p in parsed_list if p.intent_type == "capacity_plan" and p.target_capacity), None)
    if capacity_intent:
        from app.services.scoring import compute_capacity_plan
        from app.services.ollama import _format_capacity_plan_context
        candidates = search_results if search_results else []
        if not candidates:
            candidates = list(get_all_intelligence().values())
        plan = compute_capacity_plan(candidates, capacity_intent.target_capacity, capacity_intent.target_function)
        capacity_plan_context = _format_capacity_plan_context(plan, capacity_intent.target_capacity, capacity_intent.target_function)

    # Build action context so LLM knows what was just executed
    action_context = _build_action_context(detected_actions, body.active_floor_id)

    # When the decision tree provides authoritative data (floor nav, directory,
    # room selection, routing), suppress search results — the action context
    # is the single source of truth and search results would confuse the LLM.
    if action_context:
        _grounded_types = {
            "set_floor", "expand_directory_group", "select_room_in_group",
            "select_space", "route_to_elevator", "route_to_staircase",
            "highlight_adjacent",
        }
        if any(a.get("type") in _grounded_types for a, _ in detected_actions):
            search_results = []
            disambiguation_hint = None
            # The action context is the single source of truth — suppress
            # floor summaries to prevent the LLM from anchoring on other floors
            floor_summaries = None

    conversation = [{"role": m.role, "text": m.text} for m in body.messages]

    # Try deterministic template (skip LLM entirely for grounded actions)
    template_text = None
    if action_context and not evacuation_context and not capacity_plan_context:
        template_text = try_render_template(detected_actions, body.active_floor_id)

    async def generate():
        try:
            # Emit deterministic actions first (skipped when frontend pre-handled via /intents)
            if not body.skip_actions:
                for action, confirmation in detected_actions:
                    clean = {k: v for k, v in action.items() if not k.startswith("_")}
                    yield f"data: [ACTION]{json.dumps(clean)}\n\n"
                    safe_confirm = confirmation.replace("\n", "\\n")
                    yield f"data: {safe_confirm}\n\n"

            if template_text:
                # Serve pre-rendered template — no LLM call needed
                safe = template_text.replace("\n", "\\n")
                yield f"data: {safe}\n\n"
            else:
                # Stream LLM narration (no tools — actions already handled)
                async for token in stream_chat(
                    conversation, selected_space, search_results,
                    floor_summaries, learnings, disambiguation_hint,
                    evacuation_context, capacity_plan_context,
                    action_context, body.active_floor_id,
                ):
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

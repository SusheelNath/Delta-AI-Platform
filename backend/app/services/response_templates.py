"""
Pre-rendered response templates for deterministic queries.

Instead of calling the LLM to reformat data it already has, these
functions render user-facing markdown directly from the intelligence
cache.  Called from chat.py when all detected actions are grounded
(floor nav, directory, room selection, routing, adjacency).
"""

from app.services.intelligence_cache import (
    get_cached_intelligence,
    get_floor_group_summary,
    get_rooms_by_function,
)
from app.services.polygon_intelligence import FLOOR_NAMES


# ── Floor overview ───────────────────────────────────────────────

def render_floor_overview(floor_id: str) -> str | None:
    """Render markdown for 'go to floor X'."""
    fname = FLOOR_NAMES.get(floor_id)
    if not fname:
        return None

    groups = get_floor_group_summary(floor_id)
    if not groups:
        return None

    total_rooms = sum(g["count"] for g in groups)
    total_area = sum(g["total_area"] for g in groups)

    lines = [f"### {fname} Overview\n"]
    lines.append(f"{fname} has **{total_rooms} spaces** covering **{total_area:,.0f} m²**.\n")

    for g in groups:
        line = f"- **{g['function']}** — {g['count']} rooms, {g['total_area']:,.0f} m²"
        if g["max_occupancy"]:
            line += f", total max occupancy {g['max_occupancy']}"
        lines.append(line)

    lines.append("\nWould you like to explore a specific area or see details for a function group?")
    return "\n".join(lines)


# ── Directory group summary ──────────────────────────────────────

def render_group_summary(floor_id: str, function_name: str) -> str | None:
    """Render markdown for 'open X dropdown / directory'."""
    rooms = get_rooms_by_function(floor_id, function_name)
    if not rooms:
        return None

    fname = FLOOR_NAMES.get(floor_id, floor_id)
    # Use the resolved function name from the first room
    resolved_fn = rooms[0].get("primary_function", function_name)
    total_area = sum(r.get("area_m2") or 0 for r in rooms)
    total_occ = sum(r.get("max_occupancy") or 0 for r in rooms)

    lines = [f"### {resolved_fn} — {fname}\n"]
    summary = f"**{len(rooms)} rooms** · {total_area:,.0f} m² total"
    if total_occ:
        summary += f" · max occupancy {total_occ}"
    lines.append(summary + "\n")

    for idx, r in enumerate(rooms, 1):
        entry = f"{idx}. **{r.get('space_name', '?')}**"
        area = r.get("area_m2")
        if area:
            entry += f" — {round(area, 1)} m²"
        max_occ = r.get("max_occupancy")
        if max_occ:
            entry += f", max {max_occ}"
        fac = r.get("facilities_available")
        if fac:
            # Truncate long furnishing lists
            if len(fac) > 60:
                fac = fac[:57] + "..."
            entry += f" · {fac}"
        lines.append(entry)

    lines.append(f"\nSelect a room by number (e.g. *\"select the 3rd one\"*), or click one in the directory.")
    return "\n".join(lines)


# ── Room detail ──────────────────────────────────────────────────

def render_room_detail(
    ifc_guid: str,
    room_index: int | None = None,
    function_name: str | None = None,
) -> str | None:
    """Render markdown for a selected room.

    Uses double newlines between section groups (paragraph breaks) and
    trailing two-space + newline for hard line breaks within sections,
    so CommonMark renderers display each field on its own line.
    """
    intel = get_cached_intelligence(ifc_guid)
    if not intel:
        return None

    name = intel.get("space_name", "Unknown")
    fname = FLOOR_NAMES.get(intel.get("floor_id", ""), intel.get("floor_id", ""))

    # ── Header ──
    if room_index and function_name:
        resolved_fn = intel.get("primary_function", function_name)
        parts = [f"### {resolved_fn} #{room_index}"]
    else:
        parts = [f"### {name}"]

    # ── Identity block ──
    identity = f"**{name}** · {fname}"
    fn = intel.get("primary_function")
    zone = intel.get("functional_zone")
    sub = []
    if fn:
        sub.append(fn)
    if zone:
        sub.append(f"{zone} zone")
    if sub:
        identity += "  \n" + " · ".join(sub)
    sec = intel.get("secondary_functions")
    if sec:
        identity += "  \n" + sec
    parts.append(identity)

    # ── Size & occupancy ──
    size_lines = []
    area = intel.get("area_m2")
    if area:
        size_lines.append(f"**Area:** {round(area, 1)} m²")
    occ_parts = []
    if intel.get("normal_occupancy"):
        occ_parts.append(f"Normal: {intel['normal_occupancy']}")
    if intel.get("max_occupancy"):
        occ_parts.append(f"Max: {intel['max_occupancy']}")
    if intel.get("absolute_occupancy"):
        occ_parts.append(f"Absolute: {intel['absolute_occupancy']}")
    if occ_parts:
        size_lines.append(f"**Occupancy:** {' · '.join(occ_parts)}")
    if intel.get("patient_capacity"):
        size_lines.append(f"**Patient capacity:** {intel['patient_capacity']}")
    if size_lines:
        parts.append("  \n".join(size_lines))

    # ── Access & privacy ──
    access_items = []
    if intel.get("access_level"):
        access_items.append(intel["access_level"])
    if intel.get("privacy_level"):
        access_items.append(f"Privacy: {intel['privacy_level']}")
    if intel.get("accessible") and intel["accessible"] != "No":
        access_items.append(f"Accessible: {intel['accessible']}")
    if intel.get("bookable") and intel["bookable"] != "No":
        access_items.append(f"Bookable: {intel['bookable']}")
    if intel.get("visitor_access"):
        access_items.append(f"Visitors: {intel['visitor_access']}")
    if access_items:
        parts.append("**Access:** " + " · ".join(access_items))

    # ── Nearest exits ──
    exit_lines = []
    if intel.get("nearest_lift"):
        dist = f" ({intel['lift_distance_m']}m)" if intel.get("lift_distance_m") else ""
        exit_lines.append(f"- Elevator: {intel['nearest_lift']}{dist}")
    if intel.get("nearest_stair"):
        dist = f" ({intel['stair_distance_m']}m)" if intel.get("stair_distance_m") else ""
        exit_lines.append(f"- Staircase: {intel['nearest_stair']}{dist}")
    if intel.get("step_free_access"):
        exit_lines.append(f"- Step-free: {intel['step_free_access']}")
    if exit_lines:
        parts.append("**Nearest exits**\n" + "\n".join(exit_lines))

    # ── Adjacent spaces ──
    if intel.get("adjacent_spaces"):
        parts.append(f"**Adjacent:** {intel['adjacent_spaces']}")

    # ── Furnishings ──
    if intel.get("facilities_available"):
        parts.append(f"**Furnishings:** {intel['facilities_available']}")

    # ── Flexibility ──
    flex_items = []
    if intel.get("flexibility"):
        flex_items.append(f"**Flexibility:** {intel['flexibility']}")
    if intel.get("convertible_functions"):
        flex_items.append(f"Convertible to: {intel['convertible_functions']}")
    if intel.get("noise_sensitivity"):
        flex_items.append(f"Noise sensitivity: {intel['noise_sensitivity']}")
    if flex_items:
        parts.append(" · ".join(flex_items))

    parts.append("Would you like to see nearby facilities or check adjacent spaces?")
    return "\n\n".join(parts)


# ── Routing ──────────────────────────────────────────────────────

def render_route(ifc_guid: str, target_type: str) -> str | None:
    """Render markdown for 'route to elevator/staircase'."""
    intel = get_cached_intelligence(ifc_guid)
    if not intel:
        return None

    name = intel.get("space_name", "Unknown")
    fname = FLOOR_NAMES.get(intel.get("floor_id", ""), "")

    if target_type == "elevator":
        target = intel.get("nearest_lift", "Unknown")
        dist = intel.get("lift_distance_m", "?")
    else:
        target = intel.get("nearest_stair", "Unknown")
        dist = intel.get("stair_distance_m", "?")

    step_free = intel.get("step_free_access", "Unknown")

    lines = [f"### Route from {name}\n"]
    lines.append(f"**Target:** {target}")
    lines.append(f"**Distance:** {dist}m")
    lines.append(f"**Step-free access:** {step_free}")
    lines.append(f"**Floor:** {fname}")
    return "\n".join(lines)


# ── Adjacency ────────────────────────────────────────────────────

def render_adjacency(ifc_guid: str, floor_id: str) -> str | None:
    """Render markdown for 'what's adjacent to X'."""
    intel = get_cached_intelligence(ifc_guid)
    if not intel:
        return None

    name = intel.get("space_name", "Unknown")
    adj_str = intel.get("adjacent_spaces", "")
    if not adj_str:
        return f"### Adjacent to {name}\n\nNo adjacent spaces recorded."

    adj_names = [a.strip() for a in adj_str.split(",")]
    lines = [f"### Adjacent to {name}\n"]
    lines.append(f"**{len(adj_names)} adjacent spaces:**\n")

    # Try to resolve each adjacent space to get its function/area
    from app.services.intelligence_cache import get_all_intelligence
    all_intel = get_all_intelligence()

    for an in adj_names:
        adj_intel = None
        for ag, ai in all_intel.items():
            if (ai.get("space_name", "").lower() == an.lower()
                    and ai.get("floor_id") == floor_id):
                adj_intel = ai
                break
        if adj_intel:
            area = adj_intel.get("area_m2")
            fn = adj_intel.get("primary_function", "")
            area_str = f", {round(area, 1)} m²" if area else ""
            lines.append(f"- **{an}** ({fn}{area_str})")
        else:
            lines.append(f"- {an}")

    return "\n".join(lines)


# ── Floor comparison ─────────────────────────────────────────────

def render_comparison(floor_id_1: str, floor_id_2: str) -> str | None:
    """Render markdown for 'compare floor X and floor Y'."""
    fn1 = FLOOR_NAMES.get(floor_id_1)
    fn2 = FLOOR_NAMES.get(floor_id_2)
    if not fn1 or not fn2:
        return None

    g1 = get_floor_group_summary(floor_id_1)
    g2 = get_floor_group_summary(floor_id_2)

    t1_rooms = sum(g["count"] for g in g1)
    t1_area = sum(g["total_area"] for g in g1)
    t2_rooms = sum(g["count"] for g in g2)
    t2_area = sum(g["total_area"] for g in g2)

    lines = [f"### {fn1} vs {fn2}\n"]
    lines.append(f"| | **{fn1}** | **{fn2}** |")
    lines.append("|---|---|---|")
    lines.append(f"| Spaces | {t1_rooms} | {t2_rooms} |")
    lines.append(f"| Total area | {t1_area:,.0f} m² | {t2_area:,.0f} m² |")

    # Collect all functions across both floors
    fns1 = {g["function"]: g for g in g1}
    fns2 = {g["function"]: g for g in g2}
    all_fns = sorted(set(list(fns1.keys()) + list(fns2.keys())))

    for fn in all_fns:
        c1 = fns1.get(fn, {}).get("count", 0)
        c2 = fns2.get(fn, {}).get("count", 0)
        if c1 or c2:
            lines.append(f"| {fn} | {c1} | {c2} |")

    return "\n".join(lines)


# ── Master dispatcher ────────────────────────────────────────────

_GROUNDED_ACTION_TYPES = {
    "set_floor", "expand_directory_group", "select_room_in_group",
    "select_space", "route_to_elevator", "route_to_staircase",
    "highlight_adjacent", "compare_floors",
    # UI-only actions (no text response needed)
    "toggle_drawer", "set_heatmap", "reset_heatmap", "reset_filters",
    "toggle_function_filter", "clear_selection", "clear_route",
    "clear_highlights", "clear_search", "toggle_mep",
    "set_panel_mode", "zoom_view", "voice_on", "voice_off",
    "set_floor_visibility", "clear_all", "new_session",
    "no_selection_hint", "set_floor_relative", "show_all_floors",
    "open_toolkit_section", "toggle_profile", "close_card",
    "set_search",
}


def try_render_template(
    detected_actions: list[tuple[dict, str]],
    active_floor_id: str | None,
) -> str | None:
    """Attempt to render a deterministic response from templates.

    Returns the rendered markdown if ALL actions are grounded,
    or None if any action requires LLM narration.
    """
    action_types = [a.get("type") for a, _ in detected_actions]

    # If any action isn't in our grounded set, fall through to LLM
    if not all(t in _GROUNDED_ACTION_TYPES for t in action_types):
        return None

    # Resolve effective floor (a set_floor in this batch overrides)
    effective_fid = active_floor_id
    for a, _ in detected_actions:
        if a.get("type") == "set_floor":
            effective_fid = a.get("floor_id", effective_fid)

    # Build response from the highest-tier action
    # Priority: room detail > group summary > floor overview > routing > adjacency
    parts = []

    for action, _ in detected_actions:
        atype = action.get("type")

        if atype == "set_floor" and not any(
            a.get("type") in ("select_space", "select_room_in_group", "expand_directory_group")
            for a, _ in detected_actions
        ):
            text = render_floor_overview(action.get("floor_id", ""))
            if text:
                parts.append(text)

        elif atype == "expand_directory_group" and not any(
            a.get("type") in ("select_space", "select_room_in_group")
            for a, _ in detected_actions
        ):
            fn_name = action.get("function_name", "")
            fid = effective_fid
            if not fid:
                for f in FLOOR_NAMES:
                    if get_rooms_by_function(f, fn_name):
                        fid = f
                        break
            if fid:
                text = render_group_summary(fid, fn_name)
                if text:
                    parts.append(text)

        elif atype == "select_space":
            guid = action.get("space_id", "")
            # Check if this was from a select_room_in_group enrichment
            room_idx = None
            fn_name = None
            for a2, _ in detected_actions:
                if a2.get("type") == "select_room_in_group":
                    room_idx = a2.get("room_index")
                    fn_name = a2.get("function_name")
                    break
            text = render_room_detail(guid, room_idx, fn_name)
            if text:
                parts.append(text)

        elif atype == "route_to_elevator" or atype == "route_to_staircase":
            target_type = "elevator" if "elevator" in atype else "staircase"
            # Find the selected space GUID
            space_name = action.get("space_name", "")
            guid = None
            if effective_fid and space_name:
                from app.services.intelligence_cache import get_all_intelligence
                for g, intel in get_all_intelligence().items():
                    if (intel.get("space_name") == space_name
                            and intel.get("floor_id") == effective_fid):
                        guid = g
                        break
            if guid:
                text = render_route(guid, target_type)
                if text:
                    parts.append(text)

        elif atype == "highlight_adjacent":
            space_name = action.get("space_name", "")
            guid = None
            if effective_fid and space_name:
                from app.services.intelligence_cache import get_all_intelligence
                for g, intel in get_all_intelligence().items():
                    if (intel.get("space_name") == space_name
                            and intel.get("floor_id") == effective_fid):
                        guid = g
                        break
            if guid:
                text = render_adjacency(guid, effective_fid)
                if text:
                    parts.append(text)

        elif atype == "compare_floors":
            f1 = action.get("floor_id_1", "")
            f2 = action.get("floor_id_2", "")
            text = render_comparison(f1, f2)
            if text:
                parts.append(text)

    if parts:
        return "\n\n".join(parts)
    return None

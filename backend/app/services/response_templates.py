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
    get_all_intelligence,
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
        line = f"- **{g['function']}** - {g['count']} rooms, {g['total_area']:,.0f} m²"
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

    lines = [f"### {resolved_fn} - {fname}\n"]
    summary = f"**{len(rooms)} rooms** · {total_area:,.0f} m² total"
    if total_occ:
        summary += f" · max occupancy {total_occ}"
    lines.append(summary + "\n")

    for idx, r in enumerate(rooms, 1):
        entry = f"{idx}. **{r.get('space_name', '?')}**"
        area = r.get("area_m2")
        if area:
            entry += f" - {round(area, 1)} m²"
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
    frontend_space: dict | None = None,
) -> str | None:
    """Render markdown for a selected room.

    Uses double newlines between section groups (paragraph breaks) and
    trailing two-space + newline for hard line breaks within sections,
    so CommonMark renderers display each field on its own line.

    When frontend_space is provided, it takes priority over the backend
    cache - ensuring the chat text matches what the user sees.
    """
    intel = frontend_space or get_cached_intelligence(ifc_guid)
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

    # ── Adjacent spaces ──
    if intel.get("adjacent_spaces"):
        parts.append(f"**Adjacent:** {intel['adjacent_spaces']}")

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

def render_route(ifc_guid: str, target_type: str, frontend_space: dict | None = None) -> str | None:
    """Render markdown for 'route to elevator/staircase'."""
    # Always use cache for routing data (distances, nearby lifts/stairs);
    # frontend_space only carries identity fields, not routing.
    intel = get_cached_intelligence(ifc_guid)
    if not intel:
        return None

    # Prefer frontend name if available (matches what user sees)
    name = (frontend_space or {}).get("space_name") or intel.get("space_name", "Unknown")
    fname = FLOOR_NAMES.get(intel.get("floor_id", ""), "")
    step_free = intel.get("step_free_access", "Unknown")
    label = "Elevator" if target_type == "elevator" else "Staircase"

    if target_type == "elevator":
        target = intel.get("nearest_lift", "Unknown")
        dist = intel.get("lift_distance_m", "?")
        nearby = intel.get("nearby_lifts") or []
    else:
        target = intel.get("nearest_stair", "Unknown")
        dist = intel.get("stair_distance_m", "?")
        nearby = intel.get("nearby_stairs") or []

    lines = [f"### Nearest {label} from {name}\n"]
    lines.append(f"**{target}** · **{dist}m** · {fname}")
    lines.append(f"Step-free: {step_free}")

    # Show top 3 alternatives (nearest already shown above)
    alternatives = nearby[1:4]
    if alternatives:
        lines.append(f"\n**Alternatives:**")
        for i, alt in enumerate(alternatives, 1):
            d = alt.get("distance_m", "?")
            n = alt.get("space_name", "Unknown")
            parts = [f"{i}. **{n}** · **{d}m**"]
            occ = []
            if alt.get("max_occupancy"):
                occ.append(f"Max: {alt['max_occupancy']}")
            if alt.get("absolute_occupancy"):
                occ.append(f"Absolute: {alt['absolute_occupancy']}")
            if occ:
                parts.append(f" · {' · '.join(occ)}")
            lines.append("".join(parts))

    return "\n".join(lines)


# ── Adjacency ────────────────────────────────────────────────────

def render_adjacency(ifc_guid: str, floor_id: str, frontend_space: dict | None = None) -> str | None:
    """Render markdown for 'what's adjacent to X'."""
    intel = frontend_space or get_cached_intelligence(ifc_guid)
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


# ── Heatmap summary ─────────────────────────────────────────────

_HEATMAP_LABELS = {
    "occupancy": "Occupancy Capacity",
    "occupancy_density": "Occupancy Density",
    "evacuation": "Evacuation Capacity",
    "area": "Area",
    "area_per_bed": "Area per Bed",
    "utilization": "Utilization",
    "status": "Status",
}


def render_heatmap_summary(floor_id: str, mode: str) -> str | None:
    """Render narrative + hotspot summary for occupancy-related heatmap modes."""
    if mode not in ("occupancy", "occupancy_density", "evacuation"):
        return None

    fname = FLOOR_NAMES.get(floor_id)
    if not fname:
        return None

    groups = get_floor_group_summary(floor_id)
    if not groups:
        return None

    label = _HEATMAP_LABELS.get(mode, mode)

    # Collect all rooms on this floor with occupancy data
    all_intel = get_all_intelligence()
    floor_rooms = []
    for guid, intel in all_intel.items():
        if intel.get("floor_id") != floor_id:
            continue
        floor_rooms.append(intel)

    total_normal = sum(r.get("normal_occupancy") or 0 for r in floor_rooms)
    total_max = sum(r.get("max_occupancy") or 0 for r in floor_rooms)
    total_absolute = sum(r.get("absolute_occupancy") or 0 for r in floor_rooms)
    occupiable = [r for r in floor_rooms if (r.get("max_occupancy") or 0) > 0]
    total_area = sum(r.get("area_m2") or 0 for r in occupiable)

    lines = [f"### {label} - {fname}\n"]

    # Narrative (B2)
    if mode == "occupancy":
        density_str = f" ({total_max / total_area:.1f} ppl/m²)" if total_area > 0 else ""
        lines.append(
            f"{fname} has capacity for **{total_max} people** (max) across "
            f"**{len(occupiable)} occupiable spaces**{density_str}. "
            f"Normal daily occupancy is **{total_normal}**."
        )
    elif mode == "occupancy_density":
        avg_density = total_max / total_area if total_area > 0 else 0
        lines.append(
            f"{fname} averages **{avg_density:.2f} people/m²** across "
            f"**{len(occupiable)} occupiable spaces** ({total_area:,.0f} m²)."
        )
    elif mode == "evacuation":
        lines.append(
            f"{fname} has an absolute evacuation capacity of **{total_absolute} people** "
            f"across **{len(occupiable)} spaces**. "
            f"This includes standing room in furnished areas."
        )

    # Breakdown by function group
    group_stats = []
    for g in groups:
        occ = g.get("max_occupancy") or 0
        if occ > 0:
            pct = round(100 * occ / total_max) if total_max > 0 else 0
            group_stats.append((g["function"], g["count"], occ, pct))

    if group_stats:
        group_stats.sort(key=lambda x: -x[2])  # highest capacity first
        lines.append("")
        for fn, count, occ, pct in group_stats[:6]:
            lines.append(f"- **{fn}** - {count} rooms, {occ} max occ ({pct}%)")

    # Hotspots - top 5 individual rooms (B3)
    if mode in ("occupancy", "occupancy_density"):
        key = "max_occupancy"
    else:
        key = "absolute_occupancy"

    hotspots = sorted(
        [r for r in floor_rooms if (r.get(key) or 0) > 0],
        key=lambda r: -(r.get(key) or 0),
    )[:5]

    if hotspots:
        lines.append(f"\n**Top capacity spaces:**")
        for i, r in enumerate(hotspots, 1):
            name = r.get("space_name", "?")
            val = r.get(key, 0)
            area = r.get("area_m2")
            extra = f", {round(area, 1)} m²" if area else ""
            lines.append(f"{i}. **{name}** - {val} max occ{extra}")

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
    "search_largest_rooms",
    "highlight_spaces", "highlight_adjacent", "count_highlight",
}


def try_render_template(
    detected_actions: list[tuple[dict, str]],
    active_floor_id: str | None,
    selected_space: dict | None = None,
) -> str | None:
    """Attempt to render a deterministic response from templates.

    Returns the rendered markdown if ALL actions are grounded,
    or None if any action requires LLM narration.

    When selected_space is provided (from the frontend store), it is
    passed through to render_room_detail so the chat text matches the
    user's MetadataCard exactly.
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
            # Frontend-provided space is the single source of truth
            frontend = selected_space or action.get("_resolved_intel")
            text = render_room_detail(guid, room_idx, fn_name, frontend_space=frontend)
            if text:
                parts.append(text)

        elif atype == "route_to_elevator" or atype == "route_to_staircase":
            target_type = "elevator" if "elevator" in atype else "staircase"
            # Use direct GUID from action; fall back to name lookup
            guid = action.get("space_id")
            if not guid:
                space_name = action.get("space_name", "")
                if effective_fid and space_name:
                    from app.services.intelligence_cache import get_all_intelligence
                    for g, intel in get_all_intelligence().items():
                        if (intel.get("space_name") == space_name
                                and intel.get("floor_id") == effective_fid):
                            guid = g
                            break
            if guid:
                text = render_route(guid, target_type, frontend_space=selected_space)
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
                text = render_adjacency(guid, effective_fid, frontend_space=selected_space)
                if text:
                    parts.append(text)

        elif atype == "compare_floors":
            f1 = action.get("floor_id_1", "")
            f2 = action.get("floor_id_2", "")
            text = render_comparison(f1, f2)
            if text:
                parts.append(text)

        elif atype == "set_heatmap":
            mode = action.get("mode", "")
            if effective_fid and mode in ("occupancy", "occupancy_density", "evacuation"):
                text = render_heatmap_summary(effective_fid, mode)
                if text:
                    parts.append(text)

    if parts:
        return "\n\n".join(parts)
    return None

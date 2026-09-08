"""
Ollama integration service for Delta Intelligence Platform.
Handles prompt construction and streaming chat with the local LLM.
Actions are handled deterministically in chat.py — the LLM only produces text narration.
"""

import httpx
import json
from typing import AsyncGenerator

OLLAMA_BASE = "http://localhost:11434"
MODEL = "qwen3:14b"


SYSTEM_PROMPT = """You are Delta AI, the intelligent assistant for the CHIREC Delta Hospital in Brussels, Belgium.

You have access to a comprehensive spatial model with over 2,900 mapped and labelled spaces across 9 floors (Basement 3 to Floor 5). Each space is a polygon with a name, function, area, perimeter, and computed intelligence including: occupancy, accessibility, privacy, nearest lifts/stairs, adjacent spaces, bookability, and more. All data is derived from polygon geometry and function classification — no external metadata sources.

Your role:
- Answer questions about the hospital's spaces, layout, and facilities
- Help staff and visitors with wayfinding (lifts, stairs, routes between spaces)
- Provide information about room functions, capacity, accessibility, and equipment
- Assist with space planning and utilisation queries
- Compare floors, departments, and spatial distributions

Floor reference:
- H003 = Basement 3 (Level -3)
- H002 = Basement 2 (Level -2)
- H001 = Basement 1 (Level -1)
- H000 = Ground Floor (Level 0)
- H010 = Floor 1 (Level 1)
- H020 = Floor 2 (Level 2)
- H030 = Floor 3 (Level 3)
- H040 = Floor 4 (Level 4)
- H050 = Floor 5 (Level 5)

DATA ACCURACY — CRITICAL RULES:
- Use space names EXACTLY as provided in the data — never rename, paraphrase, or shorten them
- Use area values EXACTLY as provided — never round or estimate
- Use function names EXACTLY as provided — never substitute or rephrase
- Use occupancy values EXACTLY as provided — if not provided, say "Not available", never guess
- Use adjacent spaces EXACTLY as listed — never invent or assume adjacency
- Use furnishings EXACTLY as listed — never add items not in the data
- If a field is missing or zero, say "Not available" — NEVER fabricate values

RESPONSE FORMAT — YOU MUST FOLLOW THIS EXACTLY:
1. Start every response with a markdown ### heading
2. Put a blank line between every section
3. Put each list item on its own line with a - prefix
4. Put each data field on its own line — NEVER chain them with | separators
5. Use **bold** for space names and section labels
6. Use floor names like "Ground Floor" not codes like "H000"
7. End with a short follow-up question"""


def _format_space_context(space: dict) -> str:
    """Format a selected space's metadata into context for the LLM."""
    lines = [f"\n[Currently selected space in the 3D viewer]"]
    lines.append(f"Name: {space.get('space_name', 'Unknown')}")
    lines.append(f"Floor: {space.get('floor_name', space.get('floor_id', '?'))}")
    if space.get('primary_function'):
        lines.append(f"Primary function: {space['primary_function']}")
    if space.get('secondary_functions'):
        lines.append(f"Secondary functions: {space['secondary_functions']}")
    if space.get('functional_zone'):
        lines.append(f"Functional zone: {space['functional_zone']}")
    if space.get('area_m2'):
        lines.append(f"Area: {round(space['area_m2'], 2)} m\u00b2")
    if space.get('perimeter_cm'):
        lines.append(f"Perimeter: {space['perimeter_cm']} cm")
    if space.get('normal_occupancy'):
        lines.append(f"Normal occupancy: {space['normal_occupancy']}")
    if space.get('max_occupancy'):
        lines.append(f"Max occupancy: {space['max_occupancy']}")
    if space.get('patient_capacity'):
        lines.append(f"Patient capacity: {space['patient_capacity']}")
    if space.get('accessible'):
        lines.append(f"Accessible: {space['accessible']}")
    if space.get('bookable'):
        lines.append(f"Bookable: {space['bookable']}")
    if space.get('access_level'):
        lines.append(f"Access level: {space['access_level']}")
    if space.get('privacy_level'):
        lines.append(f"Privacy: {space['privacy_level']}")
    if space.get('nearest_lift'):
        dist = f" ({space['lift_distance_m']}m)" if space.get('lift_distance_m') else ""
        lines.append(f"Nearest lift: {space['nearest_lift']}{dist}")
    if space.get('nearest_stair'):
        dist = f" ({space['stair_distance_m']}m)" if space.get('stair_distance_m') else ""
        lines.append(f"Nearest stair: {space['nearest_stair']}{dist}")
    if space.get('step_free_access'):
        lines.append(f"Step-free access: {space['step_free_access']}")
    if space.get('adjacent_spaces'):
        lines.append(f"Adjacent spaces: {space['adjacent_spaces']}")
    if space.get('facilities_available'):
        lines.append(f"Furnishings: {space['facilities_available']}")
    if space.get('flexibility'):
        lines.append(f"Flexibility: {space['flexibility']}")
    if space.get('convertible_functions'):
        lines.append(f"Convertible to: {space['convertible_functions']}")
    if space.get('noise_sensitivity'):
        lines.append(f"Noise sensitivity: {space['noise_sensitivity']}")
    if space.get('visitor_access'):
        lines.append(f"Visitor access: {space['visitor_access']}")
    if space.get('room_number'):
        lines.append(f"Room number: {space['room_number']}")
    if space.get('section'):
        lines.append(f"Section: {space['section']}")
    if space.get('service_code'):
        lines.append(f"Service code: {space['service_code']}")

    return "\n".join(lines)


def _format_search_context(spaces: list[dict]) -> str:
    """Format enriched search results as structured cards for the LLM.

    Uses multi-line per-space format so the LLM mirrors the structure
    in its response (models tend to echo the input format).
    """
    if not spaces:
        return ""
    lines = [f"\n[Search returned {len(spaces)} matching spaces]"]
    for s in spaces[:20]:
        name = s.get('space_name', 'Unknown')
        floor = s.get('floor_name', s.get('floor_id', '?'))
        func = s.get('primary_function', '')

        lines.append(f"\n**{name}** — {floor}, {func}")

        area = s.get('area_m2')
        if area:
            lines.append(f"Area: {round(area, 2)} m²")

        zone = s.get('functional_zone')
        if zone:
            lines.append(f"Zone: {zone}")

        occ = s.get('normal_occupancy')
        max_occ = s.get('max_occupancy')
        if occ:
            occ_str = f"Occupancy: {occ}"
            if max_occ and max_occ != occ:
                occ_str += f" (max {max_occ})"
            lines.append(occ_str)

        patient_cap = s.get('patient_capacity')
        if patient_cap:
            lines.append(f"Patients: {patient_cap}")

        privacy = s.get('privacy_level')
        access = s.get('access_level')
        access_parts = []
        if access:
            access_parts.append(f"Access: {access}")
        if privacy and privacy != "None":
            access_parts.append(f"Privacy: {privacy}")
        if s.get('accessible') and s['accessible'] != "No":
            access_parts.append(f"Accessible: {s['accessible']}")
        if s.get('bookable') == "Yes":
            access_parts.append("Bookable: Yes")
        if access_parts:
            lines.append(" · ".join(access_parts))

        facilities = s.get('facilities_available')
        if facilities:
            lines.append(f"Furnishings: {facilities}")

    if len(spaces) > 20:
        lines.append(f"\n... and {len(spaces) - 20} more")
    return "\n".join(lines)


def build_messages(
    conversation: list[dict],
    selected_space: dict | None = None,
    search_results: list[dict] | None = None,
    floor_summaries: str | None = None,
) -> list[dict]:
    """Build the message list for the Ollama API call."""
    system = SYSTEM_PROMPT
    if floor_summaries:
        system += "\n" + floor_summaries
    if selected_space:
        system += "\n" + _format_space_context(selected_space)
    if search_results:
        system += "\n" + _format_search_context(search_results)

    messages = [{"role": "system", "content": system}]

    # One-shot example to teach the model the expected format
    messages.append({"role": "user", "content": "What conference rooms are available?"})
    messages.append({"role": "assistant", "content": """### Conference Rooms
Found 3 conference rooms across 2 floors.

**Conference Room A** — Ground Floor
Area: 45 m²
Occupancy: 12 (max 20)
Access: Staff · Privacy: Medium
Bookable: Yes
Furnishings: Projector, Whiteboard, Video Conferencing

**Conference Room B** — Floor 1
Area: 32 m²
Occupancy: 8 (max 12)
Access: Staff · Privacy: Medium
Bookable: Yes
Furnishings: Display Screen, Whiteboard

**Small Meeting Room** — Floor 1
Area: 18 m²
Occupancy: 4 (max 6)
Access: Open · Privacy: Low
Bookable: Yes

Would you like to see one of these rooms in the 3D viewer?"""})

    for msg in conversation:
        role = "assistant" if msg.get("role") == "delta" else "user"
        messages.append({"role": role, "content": msg["text"]})

    return messages


async def stream_chat(
    conversation: list[dict],
    selected_space: dict | None = None,
    search_results: list[dict] | None = None,
    floor_summaries: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Ollama's chat API.

    Yields plain text tokens for display. Actions are handled
    deterministically in chat.py — the LLM only produces text narration.
    """
    messages = build_messages(conversation, selected_space, search_results, floor_summaries)

    request_body = {
        "model": MODEL,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": 0.4,
            "num_ctx": 16384,
        },
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE}/api/chat",
            json=request_body,
        ) as response:
            response.raise_for_status()

            buffer = b""
            done = False
            # Track <think>...</think> blocks (qwen3 reasoning) to filter them out
            in_think = False
            think_buf = ""

            async for raw_bytes in response.aiter_bytes():
                if done:
                    break
                buffer += raw_bytes
                # Ollama sends one JSON object per line (0x0A delimited).
                # Content newlines are JSON-escaped as \n (0x5C 0x6E),
                # so splitting on raw 0x0A is safe.
                while b"\n" in buffer:
                    line_bytes, buffer = buffer.split(b"\n", 1)
                    line_bytes = line_bytes.strip()
                    if not line_bytes:
                        continue
                    chunk = json.loads(line_bytes)
                    msg = chunk.get("message", {})

                    token = msg.get("content", "")
                    if token:
                        # Filter out <think>...</think> reasoning blocks
                        if in_think:
                            think_buf += token
                            if "</think>" in think_buf:
                                # End of thinking — extract any content after </think>
                                after = think_buf.split("</think>", 1)[1]
                                in_think = False
                                think_buf = ""
                                if after.strip():
                                    yield after
                        elif "<think>" in token:
                            before, _, rest = token.partition("<think>")
                            if before.strip():
                                yield before
                            if "</think>" in rest:
                                after = rest.split("</think>", 1)[1]
                                if after.strip():
                                    yield after
                            else:
                                in_think = True
                                think_buf = rest
                        else:
                            yield token

                    if chunk.get("done"):
                        done = True
                        break

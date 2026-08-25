"""
Ollama integration service for Delta Intelligence Platform.
Handles prompt construction and streaming chat with the local LLM.
"""

import httpx
import json
from typing import AsyncGenerator

OLLAMA_BASE = "http://localhost:11434"
MODEL = "qwen2.5:32b"

SYSTEM_PROMPT = """You are Delta AI, the intelligent assistant for the CHIREC Delta Hospital in Brussels, Belgium.

You have access to a comprehensive Building Information Model (BIM) containing 2,913 spaces across 9 floors (Basement 3 to Floor 5). The hospital is a modern facility with surgical suites, patient rooms, diagnostic labs, administrative offices, and public areas.

Your role:
- Answer questions about the hospital's spaces, layout, and facilities
- Help staff and visitors with wayfinding (lifts, stairs, routes between spaces)
- Provide information about room functions, capacity, accessibility, and equipment
- Assist with space planning and utilisation queries
- Be concise, precise, and helpful

Formatting rules:
- Keep responses concise unless the user asks for detail
- Use short paragraphs, not walls of text
- When listing spaces, show the most relevant ones (not exhaustive lists)
- Reference rooms by name and ID when available
- Mention floor names (e.g. "Ground Floor") rather than codes (e.g. "H000")

Floor reference:
- H003 = Basement 3 (Level -3)
- H002 = Basement 2 (Level -2)
- H001 = Basement 1 (Level -1)
- H000 = Ground Floor (Level 0)
- H010 = Floor 1 (Level 1)
- H020 = Floor 2 (Level 2)
- H030 = Floor 3 (Level 3)
- H040 = Floor 4 (Level 4)
- H050 = Floor 5 (Level 5)"""


def _format_space_context(space: dict) -> str:
    """Format a selected space's metadata into context for the LLM."""
    lines = [f"\n[Currently selected space in the 3D viewer]"]
    lines.append(f"Name: {space.get('space_name', 'Unknown')}")
    lines.append(f"ID: {space.get('id', '?')}")
    lines.append(f"Floor: {space.get('floor_name', space.get('floor_id', '?'))}")

    if space.get('primary_function'):
        lines.append(f"Primary function: {space['primary_function']}")
    if space.get('secondary_functions'):
        lines.append(f"Secondary functions: {space['secondary_functions']}")
    if space.get('functional_zone'):
        lines.append(f"Functional zone: {space['functional_zone']}")
    if space.get('area_m2'):
        lines.append(f"Area: {space['area_m2']} m\u00b2")
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
        lines.append(f"Facilities: {space['facilities_available']}")
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
    """Format search results into context for the LLM."""
    if not spaces:
        return ""
    lines = [f"\n[Database query returned {len(spaces)} matching spaces]"]
    for s in spaces[:20]:
        name = s.get('space_name', 'Unknown')
        sid = s.get('id', '?')
        floor = s.get('floor_name', s.get('floor_id', '?'))
        func = s.get('primary_function', '')
        area = s.get('area_m2', '')
        area_str = f", {area} m\u00b2" if area else ""
        lines.append(f"- {name} ({sid}) \u2014 {floor}, {func}{area_str}")
    if len(spaces) > 20:
        lines.append(f"  ... and {len(spaces) - 20} more")
    return "\n".join(lines)


def build_messages(
    conversation: list[dict],
    selected_space: dict | None = None,
    search_results: list[dict] | None = None,
) -> list[dict]:
    """Build the message list for the Ollama API call."""
    system = SYSTEM_PROMPT
    if selected_space:
        system += "\n" + _format_space_context(selected_space)
    if search_results:
        system += "\n" + _format_search_context(search_results)

    messages = [{"role": "system", "content": system}]

    for msg in conversation:
        role = "assistant" if msg.get("role") == "delta" else "user"
        messages.append({"role": role, "content": msg["text"]})

    return messages


async def stream_chat(
    conversation: list[dict],
    selected_space: dict | None = None,
    search_results: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Ollama's chat API."""
    messages = build_messages(conversation, selected_space, search_results)

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE}/api/chat",
            json={
                "model": MODEL,
                "messages": messages,
                "stream": True,
                "options": {
                    "temperature": 0.4,
                    "num_ctx": 8192,
                },
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                token = chunk.get("message", {}).get("content", "")
                if token:
                    yield token
                if chunk.get("done"):
                    break

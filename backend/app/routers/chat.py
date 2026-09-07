"""
Chat endpoint — streams Ollama responses via Server-Sent Events.

All data derives from polygons.json + computed polygon intelligence.
No DB Space table queries.
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
    if user_messages:
        search_results = _auto_search(user_messages[-1].text, db)

    # Build floor summaries from polygon data
    floor_summaries = _build_floor_summaries()

    conversation = [{"role": m.role, "text": m.text} for m in body.messages]

    async def generate():
        try:
            async for token in stream_chat(conversation, selected_space, search_results, floor_summaries):
                # SSE data lines cannot contain raw newlines — they break framing.
                # Encode \n as \\n so the frontend can restore them.
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

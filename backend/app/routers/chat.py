"""
Chat endpoint — streams Ollama responses via Server-Sent Events.

All data derives from polygons.json + computed polygon intelligence.
No DB Space table queries.
"""

import json
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
    """Search polygons for spaces relevant to the user's message."""
    keywords = [
        "operating", "surgical", "surgery", "patient room", "patient care",
        "consultation", "office", "lab", "laboratory", "pharmacy", "radiology",
        "imaging", "emergency", "waiting", "reception", "cafeteria", "kitchen",
        "storage", "technical", "parking", "lift", "elevator", "stair",
        "conference", "meeting", "icu", "intensive", "neonatal", "nicu",
        "maternity", "delivery", "endoscopy", "sterilisation",
        "toilet", "corridor", "vent", "staff", "nursing",
        "accessibility", "no access", "commercial",
    ]
    msg_lower = user_message.lower()

    matched_kw = [kw for kw in keywords if kw in msg_lower]
    if not matched_kw:
        return []

    search_term = matched_kw[0].lower()

    polygons = read_all_polygons()
    results = []

    for p in polygons:
        name = (p.get("space_name") or "").lower()
        func = (p.get("primary_function") or "").lower()
        if search_term in name or search_term in func:
            # Lightweight result — just polygon fields + floor name
            entry = dict(p)
            entry["floor_name"] = FLOOR_NAMES.get(p.get("floor_id", ""), p.get("floor_id", ""))
            results.append(entry)
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
                yield f"data: {token}\n\n"
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

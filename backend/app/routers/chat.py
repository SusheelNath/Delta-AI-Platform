"""
Chat endpoint — streams Ollama responses via Server-Sent Events.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.database import get_db
from app.models import Space, Floor
from app.services.ollama import stream_chat

router = APIRouter(tags=["chat"])


class ChatMessage(BaseModel):
    role: str  # "user" or "delta"
    text: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    selected_space_id: str | None = None


def _space_to_dict(space: Space) -> dict:
    d = {c.name: getattr(space, c.name) for c in space.__table__.columns}
    d["floor_name"] = space.floor.name if space.floor else None
    return d


def _auto_search(user_message: str, db: Session) -> list[dict]:
    """Run a lightweight keyword search if the user asks about spaces."""
    keywords = [
        "operating", "surgical", "surgery", "patient room", "consultation",
        "office", "lab", "laboratory", "pharmacy", "radiology", "imaging",
        "emergency", "waiting", "reception", "cafeteria", "kitchen",
        "storage", "technical", "parking", "lift", "stair",
        "conference", "meeting", "icu", "intensive", "neonatal",
        "maternity", "delivery", "endoscopy", "sterilisation",
    ]
    msg_lower = user_message.lower()

    # Only search if the message seems to be asking about specific space types
    matched_kw = [kw for kw in keywords if kw in msg_lower]
    if not matched_kw:
        return []

    search_term = f"%{matched_kw[0]}%"
    spaces = (
        db.query(Space)
        .join(Floor)
        .filter(
            or_(
                func.lower(Space.primary_function).like(search_term),
                func.lower(Space.space_name).like(search_term),
                func.lower(Space.functional_zone).like(search_term),
            )
        )
        .order_by(Space.floor_id, Space.id)
        .limit(30)
        .all()
    )
    return [_space_to_dict(s) for s in spaces]


@router.post("/chat")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    # Resolve selected space
    selected_space = None
    if body.selected_space_id:
        space = (
            db.query(Space)
            .join(Floor)
            .filter(Space.id == body.selected_space_id)
            .first()
        )
        if space:
            selected_space = _space_to_dict(space)

    # Auto-search for relevant spaces based on the latest user message
    search_results = []
    user_messages = [m for m in body.messages if m.role == "user"]
    if user_messages:
        search_results = _auto_search(user_messages[-1].text, db)

    conversation = [{"role": m.role, "text": m.text} for m in body.messages]

    async def generate():
        try:
            async for token in stream_chat(conversation, selected_space, search_results):
                # SSE format: each token as a data event
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

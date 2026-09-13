"""
Learnings endpoint — manages AI-generated user preference learnings.

Learnings are extracted from conversation history by the local LLM and
persisted in SQLite. They accumulate across sessions and are injected
into the system prompt to personalise search ranking and responses.
"""

import json
import re
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UserLearning
from app.services.ollama import OLLAMA_BASE, MODEL

router = APIRouter(tags=["learnings"])

VALID_TYPES = {"function_interest", "floor_preference", "facility_need", "general_observation"}

MAX_LEARNINGS = 20

EXTRACTION_PROMPT = """Analyze this conversation between a hospital staff member and the Delta AI assistant.
Extract specific user preferences and interests as short, factual observations.

Categories:
- function_interest: Types of spaces the user searches for or asks about (e.g., "Frequently asks about consultation rooms")
- floor_preference: Floors or areas the user focuses on (e.g., "Focuses on Floor 2 and Ground Floor")
- facility_need: Equipment or facilities the user requires (e.g., "Needs wheelchair-accessible spaces")
- general_observation: Other patterns (e.g., "Works with surgical department", "Interested in space utilisation")

Rules:
- Only extract clear, repeated patterns — not one-off mentions
- Each observation should be a single concise sentence
- Maximum 5 observations per conversation
- Return ONLY a JSON array, no other text:
[{"type": "function_interest", "content": "...", "confidence": 0.8}, ...]
- If no clear preferences emerge, return: []

Conversation:
"""


class GenerateRequest(BaseModel):
    session_id: str
    messages: list[dict]  # [{role, text}, ...]


class LearningOut(BaseModel):
    id: int
    session_id: str
    learning_type: str
    content: str
    confidence: float
    observation_count: int
    last_observed: str
    created_at: str


@router.get("/learnings")
def get_learnings(db: Session = Depends(get_db)):
    """Return all learnings sorted by relevance (confidence * count)."""
    rows = db.query(UserLearning).all()
    rows.sort(key=lambda r: r.confidence * r.observation_count, reverse=True)
    return [
        LearningOut(
            id=r.id,
            session_id=r.session_id,
            learning_type=r.learning_type,
            content=r.content,
            confidence=r.confidence,
            observation_count=r.observation_count,
            last_observed=r.last_observed,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/learnings/generate")
async def generate_learnings(body: GenerateRequest, db: Session = Depends(get_db)):
    """Extract user preferences from conversation using the local LLM.

    Calls Ollama to analyze the conversation, then upserts learnings
    into the database with accumulation logic.
    """
    # Build conversation text for the prompt
    conv_lines = []
    for msg in body.messages:
        role = msg.get("role", "user")
        text = msg.get("text", "")
        if text and role in ("user", "delta"):
            label = "User" if role == "user" else "Delta"
            conv_lines.append(f"{label}: {text}")

    if len(conv_lines) < 2:
        return {"generated": 0, "learnings": []}

    conv_text = "\n".join(conv_lines[-20:])  # Last 20 messages max

    # Call Ollama (non-streaming)
    request_body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": EXTRACTION_PROMPT + conv_text},
            {"role": "user", "content": "Extract the user preferences as JSON."},
        ],
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            resp = await client.post(f"{OLLAMA_BASE}/api/chat", json=request_body)
            resp.raise_for_status()
            result = resp.json()
    except Exception as e:
        return {"error": f"LLM call failed: {str(e)}", "generated": 0}

    # Parse LLM response
    content = result.get("message", {}).get("content", "")

    # Strip <think>...</think> blocks if present
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

    # Extract JSON array from response
    json_match = re.search(r"\[.*\]", content, re.DOTALL)
    if not json_match:
        return {"generated": 0, "raw": content}

    try:
        extracted = json.loads(json_match.group())
    except json.JSONDecodeError:
        return {"generated": 0, "raw": content}

    if not isinstance(extracted, list):
        return {"generated": 0}

    now = datetime.now().isoformat()
    generated = []

    for item in extracted[:5]:  # Cap at 5 per generation
        lr_type = item.get("type", "")
        lr_content = item.get("content", "").strip()
        lr_confidence = float(item.get("confidence", 0.5))

        if lr_type not in VALID_TYPES or not lr_content:
            continue

        # Check for existing similar learning (same type + content overlap)
        existing = db.query(UserLearning).filter(
            UserLearning.learning_type == lr_type
        ).all()

        merged = False
        for ex in existing:
            # Simple similarity: check if key words overlap
            ex_words = set(ex.content.lower().split())
            new_words = set(lr_content.lower().split())
            # Remove common words
            common_stop = {"the", "a", "an", "in", "on", "for", "and", "or", "of", "to", "is", "are", "about", "with"}
            ex_key = ex_words - common_stop
            new_key = new_words - common_stop
            if ex_key and new_key:
                overlap = len(ex_key & new_key) / max(len(ex_key | new_key), 1)
                if overlap >= 0.4:
                    # Merge: bump confidence and count
                    ex.observation_count += 1
                    ex.confidence = min(1.0, ex.confidence + 0.1)
                    ex.last_observed = now
                    merged = True
                    generated.append({"action": "merged", "content": ex.content})
                    break

        if not merged:
            new_learning = UserLearning(
                session_id=body.session_id,
                created_at=now,
                learning_type=lr_type,
                content=lr_content,
                confidence=lr_confidence,
                observation_count=1,
                last_observed=now,
            )
            db.add(new_learning)
            generated.append({"action": "created", "content": lr_content})

    db.commit()

    # Enforce cap: keep top MAX_LEARNINGS by relevance
    all_learnings = db.query(UserLearning).all()
    if len(all_learnings) > MAX_LEARNINGS:
        all_learnings.sort(key=lambda r: r.confidence * r.observation_count, reverse=True)
        for excess in all_learnings[MAX_LEARNINGS:]:
            db.delete(excess)
        db.commit()

    return {"generated": len(generated), "learnings": generated}


@router.delete("/learnings/{learning_id}")
def delete_learning(learning_id: int, db: Session = Depends(get_db)):
    """Delete a specific learning."""
    lr = db.query(UserLearning).filter(UserLearning.id == learning_id).first()
    if not lr:
        return {"deleted": False, "error": "Not found"}
    db.delete(lr)
    db.commit()
    return {"deleted": True}


@router.delete("/learnings")
def clear_learnings(db: Session = Depends(get_db)):
    """Clear all learnings."""
    count = db.query(UserLearning).delete()
    db.commit()
    return {"deleted": count}

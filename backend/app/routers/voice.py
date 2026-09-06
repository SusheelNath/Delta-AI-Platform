"""
Voice endpoints — Whisper STT transcription and Edge TTS synthesis.

POST /api/voice/transcribe  — upload audio → get text
POST /api/voice/speak       — send text    → get MP3 audio
GET  /api/voice/status      — check model availability
"""

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from app.services.voice import (
    transcribe,
    synthesize,
    get_cached_audio,
    CANNED_PHRASES,
)

router = APIRouter(tags=["voice"])


class SpeakRequest(BaseModel):
    text: str = ""
    canned_key: str | None = None  # "greeting" | "acknowledging" | "announcing"


@router.post("/voice/transcribe")
async def voice_transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
):
    """Transcribe uploaded audio using Whisper large-v3 on GPU."""
    audio_bytes = await audio.read()
    if not audio_bytes:
        return {"text": "", "error": "Empty audio"}

    try:
        text = await transcribe(audio_bytes, language)
        return {"text": text}
    except RuntimeError as exc:
        return Response(content=str(exc), status_code=503)
    except Exception as exc:
        return Response(content=f"Transcription failed: {exc}", status_code=500)


@router.post("/voice/speak")
async def voice_speak(body: SpeakRequest):
    """Synthesize speech using Edge TTS. Returns MP3 audio bytes."""
    # Serve cached canned phrase if available (instant)
    if body.canned_key and body.canned_key in CANNED_PHRASES:
        cached = get_cached_audio(body.canned_key)
        if cached:
            return Response(content=cached, media_type="audio/mpeg")

    text = body.text or CANNED_PHRASES.get(body.canned_key, "")
    if not text:
        return Response(content="No text provided", status_code=400)

    try:
        audio_bytes = await synthesize(text)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except RuntimeError as exc:
        return Response(content=str(exc), status_code=503)
    except Exception as exc:
        return Response(content=f"Synthesis failed: {exc}", status_code=500)


@router.get("/voice/status")
async def voice_status():
    """Check whether voice dependencies (Whisper / edge-tts) are installed."""
    whisper_ok = False
    tts_ok = False

    try:
        from faster_whisper import WhisperModel  # noqa
        whisper_ok = True
    except ImportError:
        pass

    try:
        import edge_tts  # noqa
        tts_ok = True
    except ImportError:
        pass

    return {
        "whisper_available": whisper_ok,
        "tts_available": tts_ok,
        "canned_phrases": list(CANNED_PHRASES.keys()),
    }

"""
Voice endpoints:
  POST /api/voice/transcribe  - upload audio → Whisper/Groq → text
  GET  /api/voice/status      - check model availability
  WS   /api/voice/stream      - real-time Vosk STT (AudioWorklet PCM → partials/finals)
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from app.services.voice import transcribe

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("delta.voice")

router = APIRouter(tags=["voice"])

# ── Vosk model (lazy singleton) ──────────────────────────────────

_vosk_model = None
VOSK_MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "models" / "vosk" / "vosk-model-small-en-us-0.15"


def _get_vosk_model():
    global _vosk_model
    if _vosk_model is not None:
        return _vosk_model
    from vosk import Model, SetLogLevel
    SetLogLevel(-1)
    logger.info(f"Loading Vosk model from {VOSK_MODEL_PATH}")
    _vosk_model = Model(str(VOSK_MODEL_PATH))
    logger.info("Vosk model ready.")
    return _vosk_model


# ── REST endpoints ───────────────────────────────────────────────

@router.post("/voice/transcribe")
async def voice_transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
):
    """Transcribe uploaded audio via Groq Whisper / local faster-whisper."""
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


@router.get("/voice/status")
async def voice_status():
    """Check voice dependencies."""
    return {
        "vosk_available": VOSK_MODEL_PATH.exists(),
        "tts_available": True,  # static MP3 files, always available
    }


# ── WebSocket: real-time Vosk STT ────────────────────────────────

@router.websocket("/voice/stream")
async def voice_stream(ws: WebSocket):
    """
    Real-time speech recognition via Vosk.

    Client sends: binary PCM int16, 16 kHz, mono chunks
    Server sends: JSON {"type":"partial","text":"..."} or {"type":"final","text":"..."}
    """
    await ws.accept()
    logger.info("[WS] Vosk stream connected")

    try:
        from vosk import KaldiRecognizer
        model = _get_vosk_model()
        rec = KaldiRecognizer(model, 16000)
        rec.SetWords(False)
    except Exception as exc:
        logger.error(f"[WS] Vosk init failed: {exc}")
        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await ws.close()
        return

    await ws.send_text(json.dumps({"type": "ready"}))

    try:
        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"] is not None:
                pcm = message["bytes"]

                if rec.AcceptWaveform(pcm):
                    result = json.loads(rec.Result())
                    text = result.get("text", "").strip()
                    if text:
                        await ws.send_text(json.dumps({"type": "final", "text": text}))
                else:
                    partial = json.loads(rec.PartialResult())
                    text = partial.get("partial", "").strip()
                    if text:
                        await ws.send_text(json.dumps({"type": "partial", "text": text}))

    except WebSocketDisconnect:
        logger.info("[WS] Vosk stream disconnected")
    except Exception as exc:
        logger.error(f"[WS] Error: {exc}")
    finally:
        logger.info("[WS] Vosk stream cleaned up")

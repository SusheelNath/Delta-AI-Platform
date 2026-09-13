"""
Voice endpoints — Whisper STT transcription, Edge TTS synthesis,
and real-time WebSocket voice streaming with local VAD + Whisper.

POST /api/voice/transcribe  — upload audio → get text
POST /api/voice/speak       — send text    → get MP3 audio
GET  /api/voice/status      — check model availability
WS   /api/voice/stream      — real-time audio streaming with VAD + Whisper
"""

import asyncio
import io
import json
import logging
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel

from app.services.voice import (
    transcribe,
    synthesize,
    get_cached_audio,
    CANNED_PHRASES,
)
from app.services.streaming_vad import StreamingVAD

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("delta.voice.ws")
logger.setLevel(logging.INFO)

router = APIRouter(tags=["voice"])

# Thread pool for blocking Whisper calls (1 worker per connection is fine)
_whisper_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="whisper")


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


# ── Lazy-loaded local Whisper model ────────────────────────────────

_local_whisper = None


def _get_local_whisper():
    """Load faster-whisper model (singleton)."""
    global _local_whisper
    if _local_whisper is not None:
        return _local_whisper

    from faster_whisper import WhisperModel

    try:
        logger.info("Loading distil-large-v3 on CUDA …")
        _local_whisper = WhisperModel(
            "distil-large-v3", device="cuda", compute_type="float16",
        )
        logger.info("Whisper distil-large-v3 ready (CUDA).")
    except Exception as e:
        logger.warning(f"CUDA unavailable ({e}), falling back to CPU …")
        _local_whisper = WhisperModel(
            "distil-large-v3", device="cpu", compute_type="int8",
        )
        logger.info("Whisper distil-large-v3 ready (CPU).")
    return _local_whisper


def _transcribe_segment(audio_f32: np.ndarray) -> str:
    """
    Transcribe a float32 16 kHz numpy array using local faster-whisper.
    Runs in a thread pool (blocking call).
    """
    model = _get_local_whisper()

    # faster-whisper accepts numpy arrays directly (float32, 16 kHz expected)
    segments, _ = model.transcribe(
        audio_f32,
        language="en",
        beam_size=1,         # Fast greedy decoding — 3-5x faster than beam=5
        vad_filter=False,    # We already ran VAD — don't re-filter
    )
    return " ".join(seg.text for seg in segments).strip()


# ── WebSocket streaming endpoint ───────────────────────────────────

@router.websocket("/voice/stream")
async def voice_stream(ws: WebSocket):
    """
    Real-time voice streaming with server-side VAD + post-submit Whisper.

    Audio is accumulated during listening mode.  When the client sends
    {"type":"submit"}, the server flushes the VAD, concatenates all
    speech audio, runs Whisper once, and returns the full transcript.

    Protocol:
      Client → Server:
        - JSON text:  {"type":"set_mode","mode":"idle"|"listening"}
        - JSON text:  {"type":"submit"}           — trigger Whisper transcription
        - JSON text:  {"type":"mute"} / {"type":"unmute"}
        - Binary:     raw PCM int16, 16 kHz, mono

      Server → Client (JSON text):
        - {"type":"vad","speaking":true|false}
        - {"type":"submit_result","text":"..."}
        - {"type":"submit_error","message":"..."}
        - {"type":"ready"}
    """
    await ws.accept()
    logger.info("[WS] Voice stream connected")

    vad = StreamingVAD()
    mode = "idle"           # "idle" | "listening"
    muted = False
    loop = asyncio.get_running_loop()

    # Accumulate all speech audio segments during listening
    speech_segments: list[np.ndarray] = []

    async def send_json(obj: dict):
        try:
            await ws.send_text(json.dumps(obj))
        except Exception:
            pass

    # ── VAD callbacks ──
    # Only used for speech detection events + audio accumulation.
    # No real-time transcription — Whisper runs after submit.
    pending_events: list[dict] = []

    def on_speech_start():
        logger.info("[WS] VAD: speech start")
        pending_events.append({"type": "vad", "speaking": True})

    def on_speech_end(audio_f32: np.ndarray):
        logger.info(f"[WS] VAD: speech end ({len(audio_f32)/16000:.1f}s)")
        pending_events.append({"type": "vad", "speaking": False})
        # Accumulate audio — don't transcribe yet
        speech_segments.append(audio_f32)

    def on_partial(audio_f32: np.ndarray):
        # No interim transcription needed — Web Speech handles display
        pass

    vad.on_speech_start = on_speech_start
    vad.on_speech_end = on_speech_end
    vad.on_partial = on_partial

    # ── Drain VAD events (just speech start/end indicators) ──
    async def drain_events():
        while pending_events:
            event = pending_events.pop(0)
            await send_json(event)

    # ── Handle submit: flush VAD, concatenate audio, run Whisper ──
    async def handle_submit():
        # Flush any in-progress speech from VAD
        vad.flush()
        # Drain any events generated by flush
        await drain_events()

        if not speech_segments:
            logger.info("[WS] Submit with no speech audio")
            await send_json({"type": "submit_result", "text": ""})
            return

        # Concatenate all speech segments into one audio array
        full_audio = np.concatenate(speech_segments)
        speech_segments.clear()
        duration = len(full_audio) / 16000
        logger.info(f"[WS] Running Whisper on {duration:.1f}s of audio")

        try:
            t0 = time.perf_counter()
            text = await loop.run_in_executor(
                _whisper_pool, _transcribe_segment, full_audio,
            )
            elapsed = time.perf_counter() - t0
            logger.info(f"[WS] Whisper result ({elapsed:.2f}s): \"{text}\"")
            await send_json({"type": "submit_result", "text": text or ""})
        except Exception as exc:
            logger.error(f"[WS] Transcription error: {exc}")
            await send_json({"type": "submit_error", "message": str(exc)})

    # Pre-load Whisper model in background
    loop.run_in_executor(_whisper_pool, _get_local_whisper)

    await send_json({"type": "ready"})

    try:
        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "text" in message and message["text"] is not None:
                # JSON control message
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "set_mode":
                    new_mode = data.get("mode", "idle")
                    mode = new_mode
                    speech_segments.clear()
                    vad.reset()
                    logger.info(f"[WS] Mode → {mode}")
                    await send_json({"type": "mode_changed", "mode": mode})

                elif msg_type == "submit":
                    await handle_submit()

                elif msg_type == "mute":
                    muted = True

                elif msg_type == "unmute":
                    muted = False

            elif "bytes" in message and message["bytes"] is not None:
                # Binary PCM audio
                if not muted:
                    vad.feed(message["bytes"])
                    if pending_events:
                        await drain_events()

    except WebSocketDisconnect:
        logger.info("[WS] Voice stream disconnected")
    except Exception as exc:
        logger.error(f"[WS] Error: {exc}")
    finally:
        vad.reset()
        logger.info("[WS] Voice stream cleaned up")

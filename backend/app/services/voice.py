"""
Voice service - STT only (Groq Whisper API → local distil-large-v3 fallback).

TTS is handled by static MP3 files served from the frontend.
No runtime TTS synthesis on the backend.
"""

import asyncio
import logging
import os
import tempfile
from functools import partial
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

logger = logging.getLogger("delta.voice")

# ── Lazy-loaded singletons ────────────────────────────────────────
_whisper_model = None
_groq_client = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


# ── Groq Whisper API (primary) ───────────────────────────────────

def _get_groq_client():
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set")
    from groq import Groq  # noqa: delayed
    _groq_client = Groq(api_key=GROQ_API_KEY)
    logger.info("Groq client ready.")
    return _groq_client


def _transcribe_groq_sync(audio_bytes: bytes, language: str = "en") -> str:
    """Transcribe via Groq Whisper API (whisper-large-v3-turbo)."""
    client = _get_groq_client()

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        with open(tmp_path, "rb") as audio_file:
            result = client.audio.transcriptions.create(
                file=("recording.webm", audio_file),
                model="whisper-large-v3-turbo",
                language=language,
                response_format="text",
            )
        return result.strip() if isinstance(result, str) else str(result).strip()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Local distil-large-v3 (fallback) ─────────────────────────────

def _load_whisper():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    from faster_whisper import WhisperModel  # noqa: delayed

    try:
        logger.info("Loading distil-large-v3 on CUDA ...")
        _whisper_model = WhisperModel(
            "distil-large-v3", device="cuda", compute_type="float16",
        )
        logger.info("Whisper distil-large-v3 ready (CUDA).")
    except Exception as e:
        logger.warning(f"CUDA unavailable ({e}), falling back to CPU ...")
        _whisper_model = WhisperModel(
            "distil-large-v3", device="cpu", compute_type="int8",
        )
        logger.info("Whisper distil-large-v3 ready (CPU).")

    return _whisper_model


def _transcribe_local_sync(audio_bytes: bytes, language: str = "en") -> str:
    """Transcribe via local distil-large-v3."""
    model = _load_whisper()

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        segments, _ = model.transcribe(
            tmp_path, language=language, beam_size=5, vad_filter=True,
        )
        return " ".join(seg.text for seg in segments).strip()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Unified transcribe (Groq → local fallback) ───────────────────

def _transcribe_sync(audio_bytes: bytes, language: str = "en") -> str:
    """Try Groq first, fall back to local distil-large-v3."""
    if GROQ_API_KEY:
        try:
            text = _transcribe_groq_sync(audio_bytes, language)
            logger.info(f"Groq STT: {len(text)} chars")
            return text
        except Exception as exc:
            logger.warning(f"Groq STT failed ({exc}), falling back to local ...")

    text = _transcribe_local_sync(audio_bytes, language)
    logger.info(f"Local STT: {len(text)} chars")
    return text


async def transcribe(audio_bytes: bytes, language: str = "en") -> str:
    """Async wrapper - offloads STT to thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, partial(_transcribe_sync, audio_bytes, language),
    )

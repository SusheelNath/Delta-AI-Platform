"""
Voice service — STT (Groq Whisper API → local distil-large-v3 fallback) and Edge TTS.

STT pipeline:
  1. Groq Whisper API  — primary, ~1s for 1 min audio (cloud, free tier)
  2. distil-large-v3   — fallback, local GPU via faster-whisper

TTS: edge-tts (Microsoft Edge neural voices)
"""

import asyncio
import io
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

# Pre-rendered canned audio  {key: mp3_bytes}
_audio_cache: dict[str, bytes] = {}
_cache_ready = False

CANNED_PHRASES = {
    "greeting": "Hello! How can I help you?",
    "acknowledging": "One moment, please.",
    "announcing": "Here is what I found.",
    "announcing_space": "Here is what I have on this room.",
    "goodbye": "Thank you.",
}

# Edge TTS voice + prosody
EDGE_VOICE = "en-US-AvaNeural"
EDGE_RATE = "+15%"
EDGE_VOLUME = "-25%"

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
    # Primary: Groq
    if GROQ_API_KEY:
        try:
            text = _transcribe_groq_sync(audio_bytes, language)
            logger.info(f"Groq STT: {len(text)} chars")
            return text
        except Exception as exc:
            logger.warning(f"Groq STT failed ({exc}), falling back to local ...")

    # Fallback: local
    text = _transcribe_local_sync(audio_bytes, language)
    logger.info(f"Local STT: {len(text)} chars")
    return text


async def transcribe(audio_bytes: bytes, language: str = "en") -> str:
    """Async wrapper — offloads STT to thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, partial(_transcribe_sync, audio_bytes, language),
    )


# ── Edge TTS ─────────────────────────────────────────────────────

async def _edge_synthesize(text: str) -> bytes:
    """Generate speech via edge-tts. Returns MP3 bytes."""
    import edge_tts  # noqa: delayed

    communicate = edge_tts.Communicate(text, EDGE_VOICE, rate=EDGE_RATE, volume=EDGE_VOLUME)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


async def _warm_cache():
    """Pre-render canned phrases so playback is instant."""
    global _cache_ready
    if _cache_ready:
        return
    for key, text in CANNED_PHRASES.items():
        try:
            _audio_cache[key] = await _edge_synthesize(text)
            logger.info(f"Cached TTS: {key}")
        except Exception as exc:
            logger.warning(f"Failed to cache '{key}': {exc}")
    _cache_ready = True


async def synthesize(text: str) -> bytes:
    """Synthesize speech. Returns MP3 audio bytes."""
    if not _cache_ready:
        await _warm_cache()
    return await _edge_synthesize(text)


def get_cached_audio(key: str) -> bytes | None:
    """Return pre-rendered audio for a canned phrase key, or None."""
    return _audio_cache.get(key)


async def ensure_models_loaded():
    """Pre-load models + warm TTS cache (optional, call at startup)."""
    loop = asyncio.get_running_loop()
    if GROQ_API_KEY:
        loop.run_in_executor(None, _get_groq_client)
    await _warm_cache()

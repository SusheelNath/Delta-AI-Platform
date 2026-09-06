"""
Voice service — Whisper STT and Edge TTS.

- STT: faster-whisper (large-v3 on GPU, falls back to CPU)
- TTS: edge-tts (Microsoft Edge neural voices — high quality, no GPU needed)

Models are loaded lazily on first request.
Canned phrases (greeting, acknowledging, announcing) are pre-rendered
on first TTS call for instant playback.
"""

import asyncio
import io
import logging
import tempfile
from functools import partial
from pathlib import Path

logger = logging.getLogger("delta.voice")

# ── Lazy-loaded Whisper singleton ─────────────────────────────────
_whisper_model = None

# Pre-rendered canned audio  {key: wav_bytes}
_audio_cache: dict[str, bytes] = {}
_cache_ready = False

CANNED_PHRASES = {
    "greeting": "Hello! How can I help you?",
    "acknowledging": "Alright, working on it.",
    "announcing": "Here is what I found.",
}

# Edge TTS voice + prosody
EDGE_VOICE = "en-US-AvaNeural"   # Expressive, caring, natural female
EDGE_RATE = "+15%"                # Slightly faster delivery
EDGE_VOLUME = "-25%"              # Slightly softer


# ── Whisper STT ───────────────────────────────────────────────────

def _load_whisper():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    from faster_whisper import WhisperModel  # noqa: delayed

    # Try CUDA first, fall back to CPU
    try:
        logger.info("Loading Whisper large-v3 on CUDA ...")
        _whisper_model = WhisperModel(
            "large-v3", device="cuda", compute_type="float16",
        )
        logger.info("Whisper model ready (CUDA).")
    except Exception as e:
        logger.warning(f"CUDA unavailable ({e}), falling back to CPU ...")
        _whisper_model = WhisperModel(
            "large-v3", device="cpu", compute_type="int8",
        )
        logger.info("Whisper model ready (CPU).")

    return _whisper_model


def _transcribe_sync(audio_bytes: bytes, language: str = "en") -> str:
    """Synchronous Whisper transcription."""
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


async def transcribe(audio_bytes: bytes, language: str = "en") -> str:
    """Async wrapper — offloads Whisper to thread pool."""
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
    # Ensure canned cache is warm
    if not _cache_ready:
        await _warm_cache()
    return await _edge_synthesize(text)


def get_cached_audio(key: str) -> bytes | None:
    """Return pre-rendered audio for a canned phrase key, or None."""
    return _audio_cache.get(key)


async def ensure_models_loaded():
    """Pre-load Whisper + warm TTS cache (optional, call at startup)."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _load_whisper)
    await _warm_cache()

"""
Server-side keyword detection for voice commands.

Mirrors the regex patterns from frontend voiceManager.js so that
keyword detection runs on Whisper-quality transcriptions rather than
noisy Web Speech API output.
"""

import re

# ── Phonetic / fuzzy patterns ────────────────────────────────────

_DELTA_VARIANTS = re.compile(
    r"del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta|del\b", re.I
)
_WAKE_PREFIXES = re.compile(r"\b(?:hi|hey|hello|hay|hallo|hola)\b", re.I)
_STOP_PREFIX = re.compile(r"\b(?:stop|stopped|stuff|stock|stocked|stab)\b", re.I)
_THANKS_PREFIX = re.compile(r"\b(?:thank\s*you|thanks|thankyou)\b", re.I)
_SUBMIT_SOLO = re.compile(r"\bsubmit(?:ted)?\b", re.I)
_SUBMIT_DELTA = re.compile(
    r"\b(?:send|sent|sand|said)\b.*\b(?:del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)"
    r"|dealt\s*a|delt\s*a|dell\s*ta)\b",
    re.I,
)
_CLEAR_PREFIX = re.compile(
    r"\b(?:clear|clean|claire|cancel|cancelled|stop|stopped)\b", re.I
)


def _has_delta(text: str) -> bool:
    return bool(_DELTA_VARIANTS.search(text))


def has_wake_phrase(text: str) -> bool:
    """'Hello Delta', 'Hey Delta', etc."""
    return bool(_WAKE_PREFIXES.search(text)) and _has_delta(text)


def has_stop_phrase(text: str) -> bool:
    """'Stop Delta', 'Thanks Delta', etc."""
    return (bool(_STOP_PREFIX.search(text)) or bool(_THANKS_PREFIX.search(text))) and _has_delta(text)


def has_submit_phrase(text: str) -> bool:
    """'Submit' or 'Send Delta'."""
    return bool(_SUBMIT_SOLO.search(text)) or bool(_SUBMIT_DELTA.search(text))


def has_clear_phrase(text: str) -> bool:
    """'Clear', 'Cancel', etc."""
    return bool(_CLEAR_PREFIX.search(text))


def strip_submit_phrase(text: str) -> str:
    """Remove submit trigger phrases from transcription text."""
    result = re.sub(r"\s*\bsubmit(?:ted)?\b\s*", " ", text, flags=re.I)
    result = re.sub(
        r"\s*\b(?:send|sent|sand|said)\s+(?:del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)"
        r"|dealt\s*a|delt\s*a|dell\s*ta)\b\s*",
        " ",
        result,
        flags=re.I,
    )
    return result.strip()


def detect_keywords(text: str) -> list[str]:
    """
    Return all keyword types detected in *text*.
    Possible values: 'wake', 'stop', 'submit', 'clear'.
    """
    t = text.lower().strip()
    found = []
    if has_wake_phrase(t):
        found.append("wake")
    if has_stop_phrase(t):
        found.append("stop")
    if has_submit_phrase(t):
        found.append("submit")
    if has_clear_phrase(t):
        found.append("clear")
    return found

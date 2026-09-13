"""
Real-time Silero VAD wrapper for streaming WebSocket audio.

Processes 16 kHz mono float32 frames and reports speech start/end events.
Uses the ONNX model directly (no PyTorch dependency).
"""

import numpy as np
import onnxruntime as ort
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "models" / "silero_vad.onnx"

# VAD tuning
SAMPLE_RATE = 16000
FRAME_SAMPLES = 256          # 16 ms at 16 kHz — Silero VAD v5 expects this
SPEECH_THRESHOLD = 0.5       # probability above which a frame is "speech"
SILENCE_THRESHOLD = 0.35     # probability below which a frame is "silence"
MIN_SPEECH_MS = 250           # ignore speech shorter than this
MIN_SILENCE_MS = 600          # end-of-utterance requires this much silence
# How often (in seconds of speech) to emit partial transcription
PARTIAL_EVERY_S = 3.0


class StreamingVAD:
    """
    Feed 16 kHz mono int16 PCM in any chunk size.  The VAD accumulates
    internally and emits events via callbacks.

    Usage:
        vad = StreamingVAD()
        vad.on_speech_start = lambda: ...
        vad.on_speech_end   = lambda audio_f32: ...  # numpy float32 array
        vad.on_partial      = lambda audio_f32: ...  # for interim transcription
        vad.feed(pcm_bytes)
    """

    def __init__(self):
        self._session = ort.InferenceSession(
            str(MODEL_PATH),
            providers=["CPUExecutionProvider"],   # VAD is tiny, CPU is fine
        )
        # Callbacks — set once, never cleared by reset()
        self.on_speech_start = None
        self.on_speech_end = None    # (audio_f32_array)
        self.on_partial = None       # (audio_f32_array)
        self.reset()

    def reset(self):
        """Clear audio/state — call when mode changes or connection resets.
        Does NOT clear callbacks."""
        # ONNX state tensors  (2, 1, 128)
        self._h = np.zeros((2, 1, 128), dtype=np.float32)
        # Audio accumulator (partial frame)
        self._buf = np.array([], dtype=np.float32)
        # Speech state
        self._in_speech = False
        self._speech_frames: list[np.ndarray] = []
        self._speech_sample_count = 0
        self._silence_sample_count = 0
        self._last_partial_at = 0  # sample count at last partial emit

    def feed(self, pcm_bytes: bytes):
        """
        Feed raw PCM bytes (int16, 16 kHz, mono).
        Internally converts to float32 and processes frame-by-frame.
        """
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self._buf = np.concatenate([self._buf, samples])

        while len(self._buf) >= FRAME_SAMPLES:
            frame = self._buf[:FRAME_SAMPLES]
            self._buf = self._buf[FRAME_SAMPLES:]
            self._process_frame(frame)

    def _process_frame(self, frame: np.ndarray):
        """Run one 16 ms frame through Silero VAD."""
        input_data = frame[np.newaxis, :]   # (1, 256)
        sr = np.array(SAMPLE_RATE, dtype=np.int64)

        ort_inputs = {
            "input": input_data,
            "state": self._h,
            "sr": sr,
        }
        output, new_h = self._session.run(None, ort_inputs)
        self._h = new_h
        prob = float(output[0][0])

        if not self._in_speech:
            if prob >= SPEECH_THRESHOLD:
                self._in_speech = True
                self._speech_frames = [frame]
                self._speech_sample_count = FRAME_SAMPLES
                self._silence_sample_count = 0
                self._last_partial_at = 0
                if self.on_speech_start:
                    self.on_speech_start()
        else:
            # Currently in speech
            self._speech_frames.append(frame)
            self._speech_sample_count += FRAME_SAMPLES

            if prob < SILENCE_THRESHOLD:
                self._silence_sample_count += FRAME_SAMPLES
            else:
                self._silence_sample_count = 0

            # Check for end of utterance
            if self._silence_sample_count >= int(MIN_SILENCE_MS * SAMPLE_RATE / 1000):
                speech_ms = self._speech_sample_count * 1000 / SAMPLE_RATE
                if speech_ms >= MIN_SPEECH_MS:
                    audio = np.concatenate(self._speech_frames)
                    if self.on_speech_end:
                        self.on_speech_end(audio)
                # Reset
                self._in_speech = False
                self._speech_frames = []
                self._speech_sample_count = 0
                self._silence_sample_count = 0
                self._last_partial_at = 0
                return

            # Check for partial emit (every PARTIAL_EVERY_S of speech)
            speech_since_partial = self._speech_sample_count - self._last_partial_at
            if speech_since_partial >= int(PARTIAL_EVERY_S * SAMPLE_RATE):
                if self.on_partial:
                    audio = np.concatenate(self._speech_frames)
                    self.on_partial(audio)
                self._last_partial_at = self._speech_sample_count

    def get_buffered_audio(self) -> np.ndarray | None:
        """Return any buffered speech audio (for forced flush)."""
        if self._speech_frames:
            return np.concatenate(self._speech_frames)
        return None

    def flush(self):
        """Force-end current speech segment (e.g., on submit)."""
        if self._in_speech and self._speech_frames:
            speech_ms = self._speech_sample_count * 1000 / SAMPLE_RATE
            if speech_ms >= MIN_SPEECH_MS:
                audio = np.concatenate(self._speech_frames)
                if self.on_speech_end:
                    self.on_speech_end(audio)
        self._in_speech = False
        self._speech_frames = []
        self._speech_sample_count = 0
        self._silence_sample_count = 0
        self._last_partial_at = 0

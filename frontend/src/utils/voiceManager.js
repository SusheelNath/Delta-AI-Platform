/**
 * Voice utilities for Delta AI — Web Speech API wake-word detection,
 * MediaRecorder audio capture with silence detection, and audio playback.
 */

// ── Wake-word listener (Web Speech API, always-on, low power) ────

/**
 * Start continuous speech recognition that listens for wake/deactivate phrases.
 * Uses the browser's built-in Web Speech API (no network, no GPU).
 *
 * @param {() => void} onWake       - called when "Hi Delta" / "Hey Delta" is heard
 * @param {() => void} onDeactivate - called when "Stop Delta" is heard
 * @returns {() => void} stop function to tear down the listener
 */
export function startWakeWordListener(onWake, onDeactivate) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Voice] Web Speech API not supported in this browser');
    return () => {};
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let stopped = false;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      if (transcript.includes('hi delta') || transcript.includes('hey delta') || transcript.includes('hello delta')) {
        onWake();
      }
      if (transcript.includes('stop delta')) {
        onDeactivate();
      }
    }
  };

  recognition.onerror = (e) => {
    // 'no-speech' and 'aborted' are expected during normal operation
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('[Voice] Recognition error:', e.error);
    }
  };

  recognition.onend = () => {
    // Auto-restart unless intentionally stopped
    if (!stopped) {
      try {
        recognition.start();
      } catch (_) {
        /* already running */
      }
    }
  };

  try {
    recognition.start();
  } catch (_) {
    /* may need user gesture first */
  }

  return () => {
    stopped = true;
    try {
      recognition.abort();
    } catch (_) {}
  };
}

// ── Audio recorder with silence detection ────────────────────────

const SILENCE_THRESHOLD = 12; // RMS percentage below which = silence
const SILENCE_DURATION_MS = 2000; // ms of continuous silence before auto-stop

/**
 * Create a one-shot audio recorder.
 *
 * Usage:
 *   const rec = createAudioRecorder();
 *   await rec.start(onSilenceCallback);   // starts mic + silence monitor
 *   const blob = await rec.stop();        // returns webm blob
 */
export function createAudioRecorder() {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let resolveBlob = null;

  // Audio analysis
  let audioContext = null;
  let analyser = null;
  let silenceTimer = null;
  let onSilence = null;
  let rafId = null;

  function checkSilence() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    // RMS energy
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length) * 100;

    if (rms < SILENCE_THRESHOLD) {
      if (!silenceTimer) {
        silenceTimer = setTimeout(() => {
          if (onSilence) onSilence();
        }, SILENCE_DURATION_MS);
      }
    } else {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      rafId = requestAnimationFrame(checkSilence);
    }
  }

  return {
    /** Start recording. `silenceCallback` fires after ~2s of silence. */
    async start(silenceCallback) {
      onSilence = silenceCallback;
      chunks = [];

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // AnalyserNode for silence detection
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      // Prefer opus/webm; fall back to whatever is supported
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (resolveBlob) resolveBlob(blob);
      };

      mediaRecorder.start(250); // 250ms chunks
      rafId = requestAnimationFrame(checkSilence);
    },

    /** Stop recording. Returns a Promise<Blob> with the captured audio. */
    stop() {
      return new Promise((resolve) => {
        resolveBlob = resolve;
        clearTimeout(silenceTimer);
        silenceTimer = null;
        cancelAnimationFrame(rafId);

        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        } else {
          resolve(new Blob([], { type: 'audio/webm' }));
        }

        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
        if (audioContext) {
          audioContext.close().catch(() => {});
          audioContext = null;
        }
        analyser = null;
      });
    },

    /** Whether the recorder is currently capturing. */
    isRecording() {
      return mediaRecorder && mediaRecorder.state === 'recording';
    },
  };
}

// ── Audio playback ───────────────────────────────────────────────

/**
 * Play audio from an ArrayBuffer or Blob.
 * Returns a Promise that resolves when playback finishes.
 */
export function playAudio(audioData) {
  return new Promise((resolve, reject) => {
    const blob =
      audioData instanceof Blob
        ? audioData
        : new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    audio.play().catch(reject);
  });
}

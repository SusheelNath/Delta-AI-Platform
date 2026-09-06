/**
 * Voice manager for Delta AI.
 *
 * Single unified SpeechRecognition instance that switches behaviour
 * based on voice state (idle → wake-word detection, listening → live
 * transcription + "Submit Delta" trigger).
 *
 * Uses maxAlternatives to check multiple transcription guesses for
 * more reliable keyword detection.
 */

// ── Phonetic / fuzzy matching ───────────────────────────────────

const DELTA_VARIANTS = /del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta|del\b/i;
const WAKE_PREFIXES  = /\b(?:hi|hey|hello|hay|hallo|hola)\b/i;
const STOP_PREFIX    = /\b(?:stop|stopped|stuff|stock|stocked|stab)\b/i;
const THANKS_PREFIX  = /\b(?:thank\s*you|thanks|thankyou)\b/i;
const SUBMIT_PREFIX  = /\b(?:send|sent|sand|said)\b/i;
const CLEAR_PREFIX   = /\b(?:clear|clean|claire|cancel|cancelled|stop|stopped)\b/i;

function hasDelta(text)        { return DELTA_VARIANTS.test(text); }
function hasWakePhrase(text)   { return WAKE_PREFIXES.test(text) && hasDelta(text); }
function hasStopPhrase(text)   { return (STOP_PREFIX.test(text) || THANKS_PREFIX.test(text)) && hasDelta(text); }
function hasSubmitPhrase(text) { return SUBMIT_PREFIX.test(text); } // "Submit" alone is enough in listening mode
function hasClearPhrase(text)  { return CLEAR_PREFIX.test(text); }

// ── Canned phrases to filter out (Delta's own TTS picked up by mic) ──
const SELF_PHRASES = [
  /hello[,!]?\s*how\s+can\s+I\s+help\s+you\??/gi,
  /one\s+moment[,.]?\s*please\.?/gi,
  /here\s+is\s+what\s+I\s+found\.?/gi,
  /would\s+you\s+like\s+to\s+explore\s+more\??/gi,
  /^thank\s+you\.?$/gi,
];

function stripSelfPhrases(text) {
  let result = text;
  for (const re of SELF_PHRASES) {
    result = result.replace(re, '');
  }
  return result.trim();
}

/** Strip the submit trigger phrase from transcription text. */
export function stripSubmitPhrase(text) {
  // Remove "send" and variants from the transcript
  let result = text.replace(/\s*\b(?:send|sent|sand|said)\b\s*/gi, ' ');
  // Also strip any leaked self-phrases
  result = stripSelfPhrases(result);
  return result.trim();
}

/**
 * Check all alternatives (up to maxAlternatives) for a phrase match.
 * Returns true if any alternative matches the test function.
 */
function checkAlternatives(result, testFn) {
  for (let a = 0; a < result.length; a++) {
    if (testFn(result[a].transcript.toLowerCase().trim())) {
      return true;
    }
  }
  return false;
}

// ── Unified Voice Manager ───────────────────────────────────────
//
// One SpeechRecognition instance, two modes:
//   'idle'      → only detects wake ("Hello Delta") and stop ("Stop Delta")
//   'listening' → feeds interim results to onInterim callback,
//                 detects "Submit Delta" and "Stop Delta"
//
// MediaRecorder runs in parallel during 'listening' mode to capture
// audio for Whisper verification on submit.

const MAX_ALTERNATIVES = 5;

/**
 * Create the unified voice manager.
 *
 * @param {Object} callbacks
 * @param {() => void}                        callbacks.onWake    — wake phrase detected
 * @param {() => void}                        callbacks.onStop    — stop phrase detected
 * @param {(text: string) => void}            callbacks.onInterim — live transcription update
 * @param {(blob: Blob, text: string) => void} callbacks.onSubmit — submit phrase detected
 * @param {() => void}                        callbacks.onClear  — clear phrase detected
 * @param {(err: Error) => void}              callbacks.onError   — error
 * @returns {Object} control handle with start/setMode/startRecording/stopRecording/destroy
 */
export function createVoiceManager({
  onWake,
  onStop,
  onInterim,
  onSubmit,
  onClear,
  onError,
}) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[Voice] Web Speech API not supported');
    return _nullManager();
  }

  // ── State ──
  let mode = 'idle';          // 'idle' | 'listening'
  let destroyed = false;
  let wakeFired = false;      // prevent duplicate wake triggers per segment
  let accumulatedText = '';    // committed final segments during listening
  let recognition = null;
  let muted = false;          // suppress results during TTS playback (prevents self-hearing)

  // ── MediaRecorder (parallel audio capture) ──
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];

  // ── Health monitor ──
  let healthTimer = null;
  const HEALTH_INTERVAL = 4000; // ms — restart if recognition silently dies

  function resetHealthTimer() {
    clearInterval(healthTimer);
    healthTimer = setInterval(() => {
      if (destroyed) { clearInterval(healthTimer); return; }
      // If recognition exists but isn't getting results, restart it
      try {
        if (recognition) {
          recognition.stop();
          // onend handler will restart it
        }
      } catch (_) {}
    }, HEALTH_INTERVAL);
  }

  // ── SpeechRecognition setup ──

  function createRecognition() {
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = MAX_ALTERNATIVES;
    recognition.lang = 'en-US';

    recognition.onresult = handleResult;

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Voice] Recognition error:', e.error);
        onError?.(new Error(e.error));
      }
    };

    recognition.onend = () => {
      if (!destroyed) {
        // Auto-restart
        try { recognition.start(); } catch (_) {}
      }
    };

    try { recognition.start(); } catch (_) {}
    resetHealthTimer();
  }

  // ── Result handler — behaviour depends on mode ──

  function handleResult(event) {
    if (muted) return; // Ignore results while TTS is playing (prevents self-hearing)

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const isFinal = result.isFinal;

      // Build combined text: accumulated finals + current transcript
      const currentTranscript = result[0].transcript.trim();
      const combinedText = (accumulatedText + ' ' + currentTranscript).toLowerCase().trim();

      // ── Always check for Stop Delta (both modes) ──
      if (checkAlternatives(result, hasStopPhrase) || hasStopPhrase(combinedText)) {
        onStop?.();
        continue;
      }

      // ── Always check for Clear/Cancel (both modes) ──
      if (checkAlternatives(result, hasClearPhrase) || hasClearPhrase(combinedText)) {
        accumulatedText = '';
        onClear?.();
        continue;
      }

      if (mode === 'idle') {
        // ── IDLE: only detect wake phrase ──
        if (!wakeFired && (checkAlternatives(result, hasWakePhrase) || hasWakePhrase(combinedText))) {
          wakeFired = true;
          onWake?.();
        }
        if (isFinal) wakeFired = false;

      } else if (mode === 'listening') {
        // ── LISTENING: live transcription + submit detection ──

        // Check current result alternatives AND combined text for submit phrase
        if (checkAlternatives(result, hasSubmitPhrase) || hasSubmitPhrase(combinedText)) {
          // Strip the trigger phrase from the full text
          const fullText = accumulatedText +
            (accumulatedText ? ' ' : '') + currentTranscript;
          const cleaned = stripSubmitPhrase(fullText);

          // Stop recording and fire submit
          mode = 'idle';
          accumulatedText = '';
          _stopRecording().then((blob) => {
            onSubmit?.(blob, cleaned);
          });
          return;
        }

        // Build display text from all segments
        let interim = '';
        let finalText = '';

        if (isFinal) {
          finalText = stripSelfPhrases(currentTranscript);
        } else {
          interim = stripSelfPhrases(currentTranscript);
        }

        if (finalText) {
          accumulatedText += (accumulatedText ? ' ' : '') + finalText;
        }

        const displayText = stripSelfPhrases(
          accumulatedText + (interim ? ' ' + interim : '')
        );
        onInterim?.(displayText);
      }
    }
  }

  // ── MediaRecorder controls ──

  async function _startRecording() {
    audioChunks = [];
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : '';
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.start(250);
    } catch (err) {
      onError?.(err);
    }
  }

  function _stopRecording() {
    return new Promise((resolve) => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        const recorder = mediaRecorder;  // capture ref before nulling
        recorder.onstop = () => {
          const blob = new Blob(audioChunks, {
            type: recorder.mimeType || 'audio/webm',
          });
          resolve(blob);
        };
        mediaRecorder = null;
        recorder.stop();
      } else {
        mediaRecorder = null;
        resolve(new Blob([], { type: 'audio/webm' }));
      }
    });
  }

  // ── Public API ──

  return {
    /** Start the recognition engine (call once on mount). */
    start() {
      createRecognition();
    },

    /**
     * Switch mode.
     * 'idle' — wake-word detection only.
     * 'listening' — live transcription + submit detection + recording.
     */
    async setMode(newMode) {
      mode = newMode;
      accumulatedText = '';
      wakeFired = false;

      if (newMode === 'listening') {
        await _startRecording();
      } else {
        await _stopRecording();
      }
    },

    /** Get current mode. */
    getMode() {
      return mode;
    },

    /** Mute recognition (suppress results during TTS playback). */
    mute() { muted = true; },

    /** Unmute recognition (resume processing results). */
    unmute() { muted = false; },

    /** Clean up everything. */
    destroy() {
      destroyed = true;
      clearInterval(healthTimer);
      if (recognition) {
        try { recognition.abort(); } catch (_) {}
        recognition = null;
      }
      _stopRecording();
    },
  };
}

/** No-op manager for unsupported browsers. */
function _nullManager() {
  return {
    start() {},
    async setMode() {},
    getMode() { return 'idle'; },
    destroy() {},
  };
}

// ── Audio playback ──────────────────────────────────────────────

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

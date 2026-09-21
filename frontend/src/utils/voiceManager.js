/**
 * Voice manager for Delta AI — Chrome Web Speech API + static MP3 TTS.
 *
 * Architecture:
 *   - Chrome SpeechRecognition (continuous, interimResults) for STT
 *   - HTML5 Audio elements for TTS playback (static MP3 files)
 *   - Keyword detection via regex on transcription results
 *
 * Zero AudioContext. Zero backend STT. Zero dependencies.
 * Recognition auto-restarts on end so "Hello Delta" wake works
 * after the first mic activation.
 */

// ── Keyword detection (phonetic / fuzzy matching) ────────────────

const DELTA_VARIANTS = /del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta|del\b/i;
const WAKE_PREFIXES  = /\b(?:hi|hey|hello|hay|hallo|hola)\b/i;
const STOP_PREFIX    = /\b(?:stop|stopped|stuff|stock|stocked|stab)\b/i;
const THANKS_PREFIX  = /\b(?:thank\s*you|thanks|thankyou)\b/i;
const SUBMIT_SOLO    = /\bsubmit(?:ted)?\b/i;
const SUBMIT_DELTA   = /\b(?:send|sent|sand|said)\b.*\b(?:del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta)\b/i;
const CLEAR_PREFIX   = /\b(?:clear|clean|claire|cancel|cancelled|stop|stopped)\b/i;

function hasDelta(text)        { return DELTA_VARIANTS.test(text); }
function hasWakePhrase(text)   { return WAKE_PREFIXES.test(text) && hasDelta(text); }
function hasCancelPhrase(text)  { return STOP_PREFIX.test(text) && hasDelta(text); }
function hasGoodbyePhrase(text) { return THANKS_PREFIX.test(text) && hasDelta(text); }
function hasSubmitPhrase(text) { return SUBMIT_SOLO.test(text) || SUBMIT_DELTA.test(text); }
function hasClearPhrase(text)  { return CLEAR_PREFIX.test(text) && hasDelta(text); }

// ── Self-phrase filter (Delta's TTS picked up by mic) ────────────

const SELF_PHRASES = [
  /hello[,!]?\s*how\s+can\s+I\s+help\s+you\??/gi,
  /one\s+moment[,.]?\s*please\.?/gi,
  /here\s+is\s+what\s+I\s+found\.?/gi,
  /would\s+you\s+like\s+to\s+explore\s+more\??/gi,
  /^thank\s+you\.?$/gi,
];

function stripSelfPhrases(text) {
  let result = text;
  for (const re of SELF_PHRASES) result = result.replace(re, '');
  return result.trim();
}

/** Strip the submit trigger phrase from transcription text. */
export function stripSubmitPhrase(text) {
  let result = text.replace(/\s*\bsubmit(?:ted)?\b\s*/gi, ' ');
  result = result.replace(
    /\s*\b(?:send|sent|sand|said)\s+(?:del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta)\b\s*/gi,
    ' ',
  );
  result = stripSelfPhrases(result);
  return result.trim();
}

// ── No AudioContext needed ──────────────────────────────────────

/** No-op — kept for API compatibility. */
export function unlockAudio() {}

// ── Static audio cache ──────────────────────────────────────────

const _audioCache = {};
let _cacheLoaded = false;
let _cachePromise = null;

const CANNED_KEYS = ['greeting', 'acknowledging', 'announcing', 'announcing_space', 'goodbye'];

/** Pre-fetch all canned MP3 files. Browser preload tags make these instant cache hits. */
export function warmAudioCache() {
  if (_cacheLoaded) return Promise.resolve();
  if (_cachePromise) return _cachePromise;
  _cachePromise = Promise.all(CANNED_KEYS.map(async (key) => {
    try {
      const res = await fetch(`/audio/${key}.mp3`);
      if (res.ok) _audioCache[key] = await res.arrayBuffer();
    } catch (_) {}
  })).then(() => {
    _cacheLoaded = true;
    console.info('[Voice] Audio cache ready');
  });
  return _cachePromise;
}

/** Get cached audio ArrayBuffer, or null. */
export function getCachedAudio(key) {
  return _audioCache[key] || null;
}

/** Play audio via HTML5 Audio element — no AudioContext. */
export function playAudio(audioData) {
  return new Promise((resolve) => {
    try {
      const blob = audioData instanceof Blob
        ? audioData
        : new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      const timer = setTimeout(() => { cleanup(); resolve(); }, 6000);
      audio.onended = () => { clearTimeout(timer); cleanup(); resolve(); };
      audio.onerror = () => { clearTimeout(timer); cleanup(); resolve(); };
      audio.play().catch(() => { clearTimeout(timer); cleanup(); resolve(); });
    } catch (_) {
      resolve();
    }
  });
}

// ── Voice Manager ───────────────────────────────────────────────

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

/**
 * @param {Object} callbacks
 * @param {() => void}                        callbacks.onWake
 * @param {() => void}                        callbacks.onStop     - "Thank you Delta" → close mic
 * @param {() => void}                        callbacks.onCancel   - "Stop Delta" → abort current prompt
 * @param {(text: string) => void}            callbacks.onInterim
 * @param {(blob: Blob, text: string) => void} callbacks.onSubmit
 * @param {() => void}                        callbacks.onClear
 * @param {(err: Error) => void}              callbacks.onError
 */
export function createVoiceManager({
  onWake, onStop, onCancel, onInterim, onSubmit, onClear, onError,
}) {
  let mode = 'idle';
  let destroyed = false;
  let muted = false;
  let accumulatedText = '';
  let currentInterim = '';
  let wakeFired = false;

  let recognition = null;
  let running = false;
  let shouldRun = false; // true once user clicks mic — keeps auto-restart alive

  // ── SpeechRecognition setup ──

  function createRecognition() {
    if (!SpeechRecognition) {
      console.error('[Voice] SpeechRecognition not available in this browser');
      onError?.(new Error('SpeechRecognition not supported'));
      return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      if (muted) return;

      let newFinal = '';
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          newFinal += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (newFinal) handleTranscription(newFinal.trim(), true);
      else if (interim) handleTranscription(interim.trim(), false);
    };

    rec.onend = () => {
      running = false;
      if (destroyed || !shouldRun) return;
      // Auto-restart — keeps recognition alive after Chrome's periodic stops
      try {
        rec.start();
        running = true;
      } catch (err) {
        console.warn('[Voice] Auto-restart failed:', err.message);
      }
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted') return;
      console.warn('[Voice] Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        onError?.(new Error('Microphone access denied'));
      }
    };

    return rec;
  }

  // ── Transcription handler ──

  function handleTranscription(text, isFinal) {
    if (muted || !text) return;

    const lower = text.toLowerCase().trim();
    const combined = (accumulatedText + ' ' + lower).trim();

    // "Thank you Delta" → close mic entirely
    if (hasGoodbyePhrase(lower) || hasGoodbyePhrase(combined)) {
      accumulatedText = '';
      currentInterim = '';
      onStop?.();
      return;
    }

    // "Stop Delta" → abort current prompt, stay listening
    if (hasCancelPhrase(lower) || hasCancelPhrase(combined)) {
      accumulatedText = '';
      currentInterim = '';
      onCancel?.();
      return;
    }

    // Clear (any mode)
    if (hasClearPhrase(lower) || hasClearPhrase(combined)) {
      accumulatedText = '';
      currentInterim = '';
      onClear?.();
      return;
    }

    if (mode === 'idle') {
      // Wake phrase detection
      if (!wakeFired && (hasWakePhrase(lower) || hasWakePhrase(combined))) {
        wakeFired = true;
        onWake?.();
      }
      if (isFinal) wakeFired = false;

    } else if (mode === 'listening') {
      // Submit phrase
      if (hasSubmitPhrase(lower) || hasSubmitPhrase(combined)) {
        const full = accumulatedText + (accumulatedText ? ' ' : '') + text;
        const cleaned = stripSubmitPhrase(full);
        mode = 'idle';
        accumulatedText = '';
        currentInterim = '';
        onSubmit?.(new Blob([], { type: 'audio/webm' }), cleaned);
        return;
      }

      // Live display — finals accumulate, interims update in place
      if (isFinal) {
        const clean = stripSelfPhrases(text);
        if (clean) accumulatedText += (accumulatedText ? ' ' : '') + clean;
        currentInterim = '';
      } else {
        currentInterim = stripSelfPhrases(text);
      }

      onInterim?.(stripSelfPhrases(
        accumulatedText + (currentInterim ? ' ' + currentInterim : ''),
      ));
    }
  }

  // ── Public API ──

  return {
    async start() {},
    async ensureStarted() {},

    /** Start Chrome Speech Recognition. Call from a user gesture (click). */
    startCapture() {
      if (destroyed) return;
      if (running) return; // already running
      if (!recognition) recognition = createRecognition();
      if (!recognition) return;
      try {
        recognition.start();
        running = true;
        shouldRun = true;
        console.info('[Voice] Chrome Speech Recognition started');
      } catch (err) {
        console.error('[Voice] Recognition start failed:', err);
        onError?.(err);
      }
    },

    /** Fully stop recognition (no auto-restart). */
    stopCapture() {
      shouldRun = false;
      if (recognition && running) {
        try { recognition.abort(); } catch (_) {}
        running = false;
      }
    },

    async setMode(newMode) {
      mode = newMode;
      if (newMode !== 'listening') {
        accumulatedText = '';
        currentInterim = '';
      }
      wakeFired = false;
    },

    getMode() { return mode; },

    syncText(text) {
      accumulatedText = text;
      currentInterim = '';
    },

    mute() { muted = true; },
    unmute() { muted = false; },

    destroy() {
      destroyed = true;
      shouldRun = false;
      if (recognition) {
        try { recognition.abort(); } catch (_) {}
        recognition = null;
      }
      running = false;
    },
  };
}

/**
 * Voice manager for Delta AI — Web Speech API edition.
 *
 * Uses the browser's Web Speech API for:
 *   - Real-time interim transcription display
 *   - Keyword detection (wake / stop / submit / clear)
 *   - Final text sent directly to the LLM on submit
 *
 * No backend audio pipeline — instant response, zero latency on submit.
 */

// ── Phonetic / fuzzy matching (keyword detection) ─────────────

const DELTA_VARIANTS = /del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta|del\b/i;
const WAKE_PREFIXES  = /\b(?:hi|hey|hello|hay|hallo|hola)\b/i;
const STOP_PREFIX    = /\b(?:stop|stopped|stuff|stock|stocked|stab)\b/i;
const THANKS_PREFIX  = /\b(?:thank\s*you|thanks|thankyou)\b/i;
const SUBMIT_SOLO    = /\bsubmit(?:ted)?\b/i;
const SUBMIT_DELTA   = /\b(?:send|sent|sand|said)\b.*\b(?:del(?:ta|t\s*a|la|ts|lt\s*a|lta|da)|dealt\s*a|delt\s*a|dell\s*ta)\b/i;
const CLEAR_PREFIX   = /\b(?:clear|clean|claire|cancel|cancelled|stop|stopped)\b/i;

function hasDelta(text)        { return DELTA_VARIANTS.test(text); }
function hasWakePhrase(text)   { return WAKE_PREFIXES.test(text) && hasDelta(text); }
function hasStopPhrase(text)   { return (STOP_PREFIX.test(text) || THANKS_PREFIX.test(text)) && hasDelta(text); }
function hasSubmitPhrase(text) { return SUBMIT_SOLO.test(text) || SUBMIT_DELTA.test(text); }
function hasClearPhrase(text)  { return CLEAR_PREFIX.test(text) && hasDelta(text); }

const MAX_ALTERNATIVES = 5;

function checkAlternatives(result, testFn) {
  for (let a = 0; a < result.length; a++) {
    if (testFn(result[a].transcript.toLowerCase().trim())) return true;
  }
  return false;
}

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

// ── Voice Manager ──────────────────────────────────────────────

/**
 * Create the voice manager.
 *
 * @param {Object} callbacks
 * @param {() => void}                        callbacks.onWake
 * @param {() => void}                        callbacks.onStop
 * @param {(text: string) => void}            callbacks.onInterim
 * @param {(blob: Blob, text: string) => void} callbacks.onSubmit
 * @param {() => void}                        callbacks.onClear
 * @param {(err: Error) => void}              callbacks.onError
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

  // ── State ──
  let mode = 'idle';            // 'idle' | 'listening'
  let destroyed = false;
  let muted = false;
  let accumulatedText = '';     // Web Speech committed finals
  let lastInterim = '';         // last interim text (promoted on recognition restart)
  let wakeFired = false;

  // ── Web Speech API ───────────────────────────────────────────

  let recognition = null;

  function createRecognition() {
    if (!SpeechRecognition) return;
    if (recognition) { try { recognition.abort(); } catch (_) {} }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = MAX_ALTERNATIVES;
    recognition.lang = 'en-US';

    recognition.onresult = handleSpeechResult;

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Voice] Error:', e.error);
      }
    };

    recognition.onend = () => {
      // Promote any in-flight interim text to accumulatedText so it
      // survives the session restart instead of silently vanishing.
      if (lastInterim && mode === 'listening') {
        accumulatedText += (accumulatedText ? ' ' : '') + lastInterim;
        lastInterim = '';
        onInterim?.(accumulatedText);
      }
      if (!destroyed) {
        try { recognition.start(); } catch (_) {}
      }
    };

    try { recognition.start(); } catch (_) {}
  }

  function handleSpeechResult(event) {
    if (muted) return;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const isFinal = result.isFinal;
      const currentTranscript = result[0].transcript.trim();
      const combinedText = (accumulatedText + ' ' + currentTranscript).toLowerCase().trim();

      // ── Stop Delta (both modes) ──
      if (checkAlternatives(result, hasStopPhrase) || hasStopPhrase(combinedText)) {
        accumulatedText = '';
        lastInterim = '';
        onStop?.();
        continue;
      }

      // ── Clear/Cancel (both modes — requires "delta" guard) ──
      if (checkAlternatives(result, hasClearPhrase) || hasClearPhrase(combinedText)) {
        accumulatedText = '';
        lastInterim = '';
        onClear?.();
        continue;
      }

      if (mode === 'idle') {
        // ── Wake phrase ──
        if (!wakeFired && (checkAlternatives(result, hasWakePhrase) || hasWakePhrase(combinedText))) {
          wakeFired = true;
          onWake?.();
        }
        if (isFinal) wakeFired = false;

      } else if (mode === 'listening') {
        // ── Submit detection ──
        if (checkAlternatives(result, hasSubmitPhrase) || hasSubmitPhrase(combinedText)) {
          const fullText = accumulatedText +
            (accumulatedText ? ' ' : '') + currentTranscript;
          const cleaned = stripSubmitPhrase(fullText);

          mode = 'idle';
          accumulatedText = '';
          lastInterim = '';

          // Send empty blob — no audio pipeline, just text
          onSubmit?.(new Blob([], { type: 'audio/webm' }), cleaned);
          return;
        }

        // ── Live interim display ──
        let interim = '';
        let finalText = '';

        if (isFinal) {
          finalText = stripSelfPhrases(currentTranscript);
          lastInterim = '';
        } else {
          interim = stripSelfPhrases(currentTranscript);
          lastInterim = interim;
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

  // ── Public API ────────────────────────────────────────────────

  return {
    async start() {
      createRecognition();
    },

    async setMode(newMode) {
      mode = newMode;
      accumulatedText = '';
      lastInterim = '';
      wakeFired = false;
    },

    getMode() { return mode; },

    mute() { muted = true; },

    unmute() { muted = false; },

    destroy() {
      destroyed = true;
      if (recognition) { try { recognition.abort(); } catch (_) {} recognition = null; }
    },
  };
}

// ── Audio playback ──────────────────────────────────────────────

export function playAudio(audioData) {
  return new Promise((resolve, reject) => {
    const blob =
      audioData instanceof Blob
        ? audioData
        : new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    audio.play().catch(reject);
  });
}

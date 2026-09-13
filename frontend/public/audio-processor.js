/**
 * AudioWorklet processor for capturing microphone audio,
 * downsampling to 16 kHz mono int16 PCM, and sending to main thread.
 *
 * Runs in the audio rendering thread for glitch-free capture.
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    // We downsample from sampleRate (typically 48000) to 16000.
    // Ratio = sampleRate / 16000.  For 48000 → 3.
    this._ratio = sampleRate / 16000;
    // Accumulate downsampled samples until we have a good chunk to send
    // 256 samples at 16 kHz = 16 ms — matches Silero VAD v5 frame size
    this._targetChunk = 256;
    this._downsampled = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono (first channel)

    // Simple downsampling: pick every Nth sample (linear interpolation)
    const ratio = this._ratio;
    const inputLen = channelData.length;
    const outputLen = Math.floor(inputLen / ratio);

    if (outputLen === 0) return true;

    const resampled = new Float32Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const s0 = channelData[idx] || 0;
      const s1 = channelData[Math.min(idx + 1, inputLen - 1)] || 0;
      resampled[i] = s0 + frac * (s1 - s0);
    }

    // Accumulate
    const combined = new Float32Array(this._downsampled.length + resampled.length);
    combined.set(this._downsampled, 0);
    combined.set(resampled, this._downsampled.length);
    this._downsampled = combined;

    // Send chunks of _targetChunk samples
    while (this._downsampled.length >= this._targetChunk) {
      const chunk = this._downsampled.slice(0, this._targetChunk);
      this._downsampled = this._downsampled.slice(this._targetChunk);

      // Convert float32 [-1, 1] to int16
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 32768 : s * 32767;
      }

      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);

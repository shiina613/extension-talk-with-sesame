/**
 * Pure resampling and conversion functions for audio processing.
 * Extracted from AudioWorklet for independent testability.
 */

/**
 * Resample audio using linear interpolation.
 * Converts from source sample rate to target sample rate.
 *
 * @param input - Float32Array of audio samples at source rate
 * @param sourceSampleRate - Source sample rate (e.g., 44100 or 48000)
 * @param targetSampleRate - Target sample rate (e.g., 16000)
 * @returns Float32Array of resampled audio at target rate
 */
export function resampleLinear(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (input.length === 0) {
    return new Float32Array(0);
  }

  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(input);
  }

  const ratio = targetSampleRate / sourceSampleRate;
  const outputLength = Math.round(input.length * ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i / ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation between adjacent samples
    output[i] = input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction;
  }

  return output;
}

/**
 * Convert Float32 audio samples [-1.0, 1.0] to Int16 PCM [-32768, 32767].
 * Clamps values outside the [-1, 1] range before conversion.
 *
 * @param input - Float32Array of audio samples in range [-1.0, 1.0]
 * @returns Int16Array of PCM samples
 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i++) {
    // Clamp to [-1, 1] range
    const sample = Math.max(-1, Math.min(1, input[i]));
    // Scale to Int16 range: negative maps to [-32768, 0], positive maps to [0, 32767]
    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return output;
}

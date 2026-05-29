/**
 * AudioWorklet processor for real-time audio resampling.
 *
 * This file runs in the AudioWorkletGlobalScope — it does NOT have access
 * to DOM APIs or regular ES module imports. Communication with the main
 * thread happens exclusively via `this.port.postMessage()`.
 *
 * Responsibilities:
 * - Resample incoming audio from source rate (44100/48000) to 16kHz
 * - Convert Float32 samples to Int16 PCM
 * - Buffer samples until a full chunk (8000 samples = 500ms at 16kHz)
 * - Post AudioChunkMessage to main thread when chunk is ready
 */

// AudioWorkletGlobalScope declarations (not available in standard TS lib)
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface AudioProcessorOptions {
  targetSampleRate: number;   // 16000
  chunkSizeMs: number;        // 500
  sourceSampleRate: number;   // from AudioContext (44100 or 48000)
}

class AudioResamplerProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array;
  private bufferIndex: number;
  private targetSampleRate: number;
  private sourceSampleRate: number;
  private chunkSizeSamples: number;
  private resampleRatio: number;

  constructor(options: AudioWorkletNodeOptions) {
    super();

    const processorOptions = (options.processorOptions ?? {}) as AudioProcessorOptions;
    this.targetSampleRate = processorOptions.targetSampleRate || 16000;
    this.sourceSampleRate = processorOptions.sourceSampleRate || 48000;
    const chunkSizeMs = processorOptions.chunkSizeMs || 500;

    this.chunkSizeSamples = Math.floor(this.targetSampleRate * chunkSizeMs / 1000);
    this.resampleRatio = this.targetSampleRate / this.sourceSampleRate;
    this.buffer = new Float32Array(this.chunkSizeSamples);
    this.bufferIndex = 0;
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    // Take first channel only (mono)
    const inputChannel = input[0];
    const resampledSamples = this.resample(inputChannel);

    for (let i = 0; i < resampledSamples.length; i++) {
      this.buffer[this.bufferIndex++] = resampledSamples[i];

      if (this.bufferIndex >= this.chunkSizeSamples) {
        this.emitChunk();
        this.bufferIndex = 0;
      }
    }

    return true;
  }

  /**
   * Resample audio using linear interpolation.
   * Converts from source sample rate to target sample rate (16kHz).
   */
  private resample(input: Float32Array): Float32Array {
    const outputLength = Math.round(input.length * this.resampleRatio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / this.resampleRatio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      // Linear interpolation between adjacent samples
      output[i] = input[srcIndexFloor] * (1 - fraction) + input[srcIndexCeil] * fraction;
    }

    return output;
  }

  /**
   * Convert buffered Float32 samples to Int16 PCM and post to main thread.
   */
  private emitChunk(): void {
    let peak = 0;
    for (let i = 0; i < this.chunkSizeSamples; i++) {
      peak = Math.max(peak, Math.abs(this.buffer[i]));
    }
    // Boost quiet tab-capture audio (YouTube often decodes below 0.1 peak)
    const targetPeak = 0.35;
    const gain = peak > 0.0005 && peak < targetPeak ? targetPeak / peak : 1;

    const pcmData = new Int16Array(this.chunkSizeSamples);

    for (let i = 0; i < this.chunkSizeSamples; i++) {
      const sample = Math.max(-1, Math.min(1, this.buffer[i] * gain));
      pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }

    this.port.postMessage(
      {
        type: 'audio-chunk',
        pcmData,
        timestamp: Date.now(),
      },
      [pcmData.buffer],
    );
  }
}

registerProcessor('audio-resampler-processor', AudioResamplerProcessor);

/**
 * Audio Processor Service (main thread side).
 *
 * Manages AudioContext lifecycle, connects MediaStream to AudioWorkletNode,
 * and forwards PCM chunks from the worklet to registered callbacks.
 */

import { AudioConfig, AudioChunkMessage } from '../../shared/types/audio.types';
import { ensureAudioContextRunning } from './audio-context.util';

const WORKLET_NAME = 'audio-resampler-processor';

export type AudioChunkCallback = (chunk: AudioChunkMessage) => void;

export interface StartCaptureOptions {
  /** Reuse an existing AudioContext (required for tab capture — one context per stream) */
  audioContext?: AudioContext;
  /** Reuse an existing source node (tab: one source → speakers + worklet) */
  mediaStreamSource?: MediaStreamAudioSourceNode;
}

export class AudioProcessorService {
  private audioContext: AudioContext | null = null;
  private ownsAudioContext = true;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private ownsSourceNode = true;
  private silentGain: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunkCallbacks: AudioChunkCallback[] = [];
  private isCapturing = false;

  /**
   * Start capturing audio from a MediaStream.
   * Creates AudioContext, loads the AudioWorklet, and connects the pipeline:
   * MediaStreamSource → AudioWorkletNode (resampling + chunking).
   *
   * @param stream - MediaStream from getUserMedia or tabCapture
   * @param config - Audio configuration (sampleRate, chunkSizeMs, etc.)
   * @param workletUrl - URL to the audio-processor.worklet.js file
   * @param options - Optional shared AudioContext (tab capture must use one context for play + process)
   */
  async startCapture(
    stream: MediaStream,
    config: AudioConfig,
    workletUrl: string,
    options: StartCaptureOptions = {},
  ): Promise<void> {
    if (this.isCapturing) {
      await this.stopCapture();
    }

    if (options.audioContext) {
      this.audioContext = options.audioContext;
      this.ownsAudioContext = false;
    } else {
      this.audioContext = new AudioContext();
      this.ownsAudioContext = true;
    }
    await ensureAudioContextRunning(this.audioContext);
    const sourceSampleRate = this.audioContext.sampleRate;

    await this.audioContext.audioWorklet.addModule(workletUrl);

    this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_NAME, {
      processorOptions: {
        targetSampleRate: config.sampleRate,
        chunkSizeMs: config.chunkSizeMs,
        sourceSampleRate,
      },
    });

    this.workletNode.port.onmessage = (event: MessageEvent<AudioChunkMessage>) => {
      if (event.data.type === 'audio-chunk') {
        for (const callback of this.chunkCallbacks) {
          callback(event.data);
        }
      }
    };

    if (options.mediaStreamSource) {
      this.sourceNode = options.mediaStreamSource;
      this.ownsSourceNode = false;
    } else {
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.ownsSourceNode = true;
    }

    // Worklet must reach destination (via silent gain) or process() is never called
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);

    this.isCapturing = true;
  }

  /**
   * Stop capturing audio. Disconnects nodes and closes AudioContext.
   * Releases all audio resources.
   */
  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    if (this.sourceNode && !this.ownsSourceNode && this.workletNode) {
      try {
        this.sourceNode.disconnect(this.workletNode);
      } catch {
        // already disconnected
      }
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }

    if (this.sourceNode && this.ownsSourceNode) {
      this.sourceNode.disconnect();
    }
    this.sourceNode = null;

    if (this.audioContext && this.ownsAudioContext) {
      await this.audioContext.close();
    }
    this.audioContext = null;

    this.isCapturing = false;
  }

  /**
   * Register a callback to receive PCM audio chunks from the worklet.
   *
   * @param callback - Function called with each AudioChunkMessage
   */
  onChunk(callback: AudioChunkCallback): void {
    this.chunkCallbacks.push(callback);
  }

  /**
   * Remove a previously registered chunk callback.
   *
   * @param callback - The callback to remove
   */
  offChunk(callback: AudioChunkCallback): void {
    const index = this.chunkCallbacks.indexOf(callback);
    if (index !== -1) {
      this.chunkCallbacks.splice(index, 1);
    }
  }

  /**
   * Check if audio capture is currently active.
   */
  getIsCapturing(): boolean {
    return this.isCapturing;
  }
}

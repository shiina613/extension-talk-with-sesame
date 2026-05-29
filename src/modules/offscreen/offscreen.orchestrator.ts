/**
 * Offscreen Orchestrator.
 *
 * Manages audio capture pipelines (mic and tab) by coordinating
 * AudioProcessorService and WebSocketClientService instances.
 * Forwards transcript results and connection events back to the
 * service worker via registered event callbacks.
 */

import type { AudioConfig, AudioSource, OffscreenEvent } from '../../shared/types';
import { AudioProcessorService, ensureAudioContextRunning } from '../audio-processor';
import { WebSocketClientService } from '../websocket-client';
import {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_INTERVAL_MS,
} from '../../shared/constants';

type EventCallback = (event: OffscreenEvent) => void;

interface SourcePipeline {
  processor: AudioProcessorService;
  wsClient: WebSocketClientService;
  stream: MediaStream | null;
  audioCtx?: AudioContext;
}

export type PipelineResult = { ok: true } | { ok: false; error: string };

function getWorkletUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('audio-processor.worklet.js');
  }
  return 'audio-processor.worklet.js';
}

export class OffscreenOrchestrator {
  private micPipeline: SourcePipeline | null = null;
  private tabPipeline: SourcePipeline | null = null;
  private eventCallbacks: EventCallback[] = [];

  /** Register a callback to receive OffscreenEvent messages. */
  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /** Remove a previously registered event callback. */
  offEvent(callback: EventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index !== -1) {
      this.eventCallbacks.splice(index, 1);
    }
  }

  /**
   * Start microphone capture pipeline.
   * Acquires mic stream, creates audio processor and WebSocket client,
   * and begins streaming PCM chunks to the STT server.
   */
  async startMic(config: AudioConfig, serverUrl: string): Promise<PipelineResult> {
    if (this.micPipeline) {
      await this.stopMic();
    }

    let pipeline: SourcePipeline | null = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pipeline = this.createPipeline(stream, 'mic', config, serverUrl);
      this.micPipeline = pipeline;
      await this.waitForPipelineConnection(pipeline);
      await pipeline.processor.startCapture(stream, config, getWorkletUrl());
      this.emitEvent({ type: 'recording-started', source: 'mic' });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (pipeline) {
        await this.abortPipeline(pipeline);
      }
      this.micPipeline = null;
      this.emitEvent({ type: 'connection-error', source: 'mic', error: message });
      return { ok: false, error: message };
    }
  }

  /**
   * Start tab audio capture pipeline.
   * Uses the streamId from chrome.tabCapture.getMediaStreamId to acquire
   * the tab's audio stream, then processes and streams to STT server.
   * Also plays the audio through speakers so the user can still hear it.
   */
  async startTab(
    streamId: string,
    config: AudioConfig,
    serverUrl: string,
  ): Promise<PipelineResult> {
    if (this.tabPipeline) {
      await this.stopTab();
    }

    let pipeline: SourcePipeline | null = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        } as MediaTrackConstraints,
      });

      // One AudioContext + one MediaStreamSource for playback and STT
      const audioCtx = new AudioContext();
      await ensureAudioContextRunning(audioCtx);
      const tabSource = audioCtx.createMediaStreamSource(stream);
      tabSource.connect(audioCtx.destination);

      pipeline = this.createPipeline(stream, 'tab', config, serverUrl);
      pipeline.audioCtx = audioCtx;
      this.tabPipeline = pipeline;
      await this.waitForPipelineConnection(pipeline);
      await pipeline.processor.startCapture(stream, config, getWorkletUrl(), {
        audioContext: audioCtx,
        mediaStreamSource: tabSource,
      });
      this.emitEvent({ type: 'recording-started', source: 'tab' });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (pipeline) {
        if (pipeline.audioCtx) {
          await pipeline.audioCtx.close();
        }
        await this.abortPipeline(pipeline);
      }
      this.tabPipeline = null;
      this.emitEvent({ type: 'connection-error', source: 'tab', error: message });
      return { ok: false, error: message };
    }
  }

  /** Stop microphone capture and release resources. */
  async stopMic(): Promise<void> {
    if (!this.micPipeline) return;
    await this.teardownPipeline(this.micPipeline, 'mic');
    this.micPipeline = null;
  }

  /** Stop tab audio capture and release resources. */
  async stopTab(): Promise<void> {
    if (!this.tabPipeline) return;
    if (this.tabPipeline.audioCtx) {
      await this.tabPipeline.audioCtx.close();
    }
    await this.teardownPipeline(this.tabPipeline, 'tab');
    this.tabPipeline = null;
  }

  /** Stop all active capture pipelines. */
  async stopAll(): Promise<void> {
    await this.stopMic();
    await this.stopTab();
  }

  /**
   * Create a capture pipeline: AudioProcessor + WebSocket client.
   * Wires audio chunks from the processor to the WebSocket client,
   * and transcript/connection events back to the orchestrator.
   */
  private createPipeline(
    stream: MediaStream,
    source: AudioSource,
    config: AudioConfig,
    serverUrl: string,
  ): SourcePipeline {
    const processor = new AudioProcessorService();
    const wsClient = new WebSocketClientService({
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectIntervalMs: RECONNECT_INTERVAL_MS,
    });

    // Forward audio chunks to WebSocket as binary PCM
    processor.onChunk((chunk) => {
      wsClient.sendAudioChunk(chunk.pcmData);
    });

    // Forward transcript results to service worker
    wsClient.onTranscript((result) => {
      this.emitEvent({ type: 'transcript', data: result });
    });

    // Forward connection errors
    wsClient.onConnectionError((src, error) => {
      this.emitEvent({ type: 'connection-error', source: src, error });
    });

    // Forward reconnection attempts
    wsClient.onReconnecting((src, attempt) => {
      this.emitEvent({ type: 'reconnecting', source: src, attempt });
    });

    wsClient.connect(serverUrl, source);

    return { processor, wsClient, stream };
  }

  /**
   * Wait for a pipeline's WebSocket to be connected before starting capture.
   */
  private async waitForPipelineConnection(pipeline: SourcePipeline): Promise<void> {
    await pipeline.wsClient.waitForConnection(5000);
  }

  /**
   * Tear down a failed pipeline without emitting recording-stopped.
   */
  private async abortPipeline(pipeline: SourcePipeline): Promise<void> {
    try {
      await pipeline.processor.stopCapture();
    } catch {
      // Pipeline may not have started capture yet
    }
    pipeline.wsClient.disconnect();
    if (pipeline.stream) {
      for (const track of pipeline.stream.getTracks()) {
        track.stop();
      }
    }
  }

  /**
   * Tear down a capture pipeline: stop processor, send end-of-stream,
   * disconnect WebSocket, and stop all media tracks.
   */
  private async teardownPipeline(
    pipeline: SourcePipeline,
    source: AudioSource,
  ): Promise<void> {
    await pipeline.processor.stopCapture();
    pipeline.wsClient.sendEndOfStream();
    pipeline.wsClient.disconnect();

    if (pipeline.stream) {
      for (const track of pipeline.stream.getTracks()) {
        track.stop();
      }
    }

    this.emitEvent({ type: 'recording-stopped', source });
  }

  /** Emit an event to all registered callbacks. */
  private emitEvent(event: OffscreenEvent): void {
    for (const callback of this.eventCallbacks) {
      callback(event);
    }
  }
}

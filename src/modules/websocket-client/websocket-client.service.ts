import type { AudioSource, TranscriptResult } from '../../shared/types';

/** sherpa-onnx server JSON response format */
interface SherpaOnnxResponse {
  text: string;
  segment: number;
  is_final?: boolean;
  tokens?: string[];
  timestamps?: number[];
}

/** WebSocket connection state */
export type WebSocketClientStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** Callback type for transcript events */
export type TranscriptCallback = (result: TranscriptResult) => void;

/** Callback type for connection error events */
export type ConnectionErrorCallback = (source: AudioSource, error: string) => void;

/** Callback type for reconnecting events */
export type ReconnectingCallback = (source: AudioSource, attempt: number) => void;

/** Configuration for WebSocket client */
export interface WebSocketClientConfig {
  maxReconnectAttempts: number;  // default: 3
  reconnectIntervalMs: number;  // default: 1000
}

const DEFAULT_CONFIG: WebSocketClientConfig = {
  maxReconnectAttempts: 3,
  reconnectIntervalMs: 1000,
};

export class WebSocketClientService {
  private ws: WebSocket | null = null;
  private source: AudioSource | null = null;
  private status: WebSocketClientStatus = 'disconnected';
  private url: string = '';
  private lastSegment: number = -1;
  private reconnectAttempt: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private config: WebSocketClientConfig;

  private transcriptCallbacks: TranscriptCallback[] = [];
  private connectionErrorCallbacks: ConnectionErrorCallback[] = [];
  private reconnectingCallbacks: ReconnectingCallback[] = [];

  constructor(config: Partial<WebSocketClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getStatus(): WebSocketClientStatus {
    return this.status;
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  getSource(): AudioSource | null {
    return this.source;
  }

  /** Register a callback for transcript results */
  onTranscript(callback: TranscriptCallback): void {
    this.transcriptCallbacks.push(callback);
  }

  /** Register a callback for connection error (after all retries exhausted) */
  onConnectionError(callback: ConnectionErrorCallback): void {
    this.connectionErrorCallbacks.push(callback);
  }

  /** Register a callback for reconnection attempts */
  onReconnecting(callback: ReconnectingCallback): void {
    this.reconnectingCallbacks.push(callback);
  }

  /** Establish WebSocket connection to STT server */
  connect(url: string, source: AudioSource): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.url = url;
    this.source = source;
    this.lastSegment = -1;
    this.status = 'connecting';
    this.createConnection();
  }

  /** Wait for WebSocket to be connected. Resolves when open, rejects on failure. */
  waitForConnection(timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        if (this.status === 'connected') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        } else if (this.status === 'failed' || this.status === 'disconnected') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(new Error('WebSocket connection failed'));
        }
      }, 50);
    });
  }

  /** Send audio chunk as binary frame */
  sendAudioChunk(data: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    // Send exact PCM bytes only (avoid ArrayBuffer slack space)
    this.ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  /** Send end-of-stream signal to server */
  sendEndOfStream(): void {
    if (this.status !== 'connected' || !this.ws) {
      return;
    }
    this.ws.send('Done');
  }

  /** Close connection gracefully */
  disconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;

    if (this.ws) {
      // Remove event handlers to prevent reconnection on intentional close
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;

      if (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.status = 'disconnected';
    this.source = null;
  }

  private createConnection(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.status = 'connected';
        this.reconnectAttempt = 0;
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.ws.onclose = (event: CloseEvent) => {
        // Only attempt reconnect if not a clean close
        if (event.code !== 1000) {
          this.handleDisconnect();
        } else {
          this.status = 'disconnected';
        }
      };

      this.ws.onerror = () => {
        // onerror is always followed by onclose in browsers,
        // so we let onclose handle the reconnection logic.
        // No action needed here.
      };
    } catch {
      this.handleDisconnect();
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      return;
    }

    try {
      const response: SherpaOnnxResponse = JSON.parse(event.data);

      if (!response.text || response.text.trim() === '') {
        return;
      }

      // Use is_final from server if available, otherwise detect via segment change
      const isFinal = response.is_final === true ||
        (this.lastSegment >= 0 && response.segment !== this.lastSegment);
      this.lastSegment = response.segment;

      const result: TranscriptResult = {
        text: response.text.trim(),
        isFinal,
        source: this.source!,
        timestamp: Date.now(),
        segmentId: `${this.source}-${response.segment}`,
      };

      for (const callback of this.transcriptCallbacks) {
        callback(result);
      }
    } catch {
      // Ignore malformed JSON responses
    }
  }

  private handleDisconnect(): void {
    if (this.status === 'failed') {
      return;
    }

    this.ws = null;

    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.status = 'failed';
      const source = this.source!;
      for (const callback of this.connectionErrorCallbacks) {
        callback(source, `Reconnection failed after ${this.config.maxReconnectAttempts} attempts`);
      }
      return;
    }

    this.status = 'reconnecting';
    this.reconnectAttempt++;

    for (const callback of this.reconnectingCallbacks) {
      callback(this.source!, this.reconnectAttempt);
    }

    this.reconnectTimer = setTimeout(() => {
      this.createConnection();
    }, this.config.reconnectIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

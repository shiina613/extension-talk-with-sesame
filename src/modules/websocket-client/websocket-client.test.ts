import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClientService } from './websocket-client.service';

// Mock WebSocket with controllable behavior
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  static behavior: 'open' | 'fail' | 'manual' = 'open';

  binaryType: string = 'blob';
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  sentMessages: (string | ArrayBuffer)[] = [];
  closeCalled = false;
  closeCode?: number;
  closeReason?: string;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);

    if (MockWebSocket.behavior === 'open') {
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen(new Event('open'));
      }, 0);
    } else if (MockWebSocket.behavior === 'fail') {
      setTimeout(() => {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onerror) this.onerror(new Event('error'));
        if (this.onclose) this.onclose(new CloseEvent('close', { code: 1006 }));
      }, 0);
    }
    // 'manual' — test controls timing
  }

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalled = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
  }
}

// Align with browser WebSocket constants when MockWebSocket is the global constructor
Object.assign(MockWebSocket, {
  CONNECTING: MockWebSocket.CONNECTING,
  OPEN: MockWebSocket.OPEN,
  CLOSING: MockWebSocket.CLOSING,
  CLOSED: MockWebSocket.CLOSED,
});

describe('WebSocketClientService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    MockWebSocket.instances = [];
    MockWebSocket.behavior = 'open';
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('connect', () => {
    it('should establish connection and transition to connected state', () => {
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');

      expect(client.getStatus()).toBe('connecting');
      vi.advanceTimersByTime(0);
      expect(client.getStatus()).toBe('connected');
      expect(client.getSource()).toBe('mic');

      client.disconnect();
    });

    it('should not create duplicate connections if already connected', () => {
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      client.connect('ws://localhost:6006', 'mic');
      expect(MockWebSocket.instances.length).toBe(1);

      client.disconnect();
    });

    it('should not create duplicate connections if connecting', () => {
      MockWebSocket.behavior = 'manual';
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');
      client.connect('ws://localhost:6006', 'mic');

      expect(MockWebSocket.instances.length).toBe(1);
      client.disconnect();
    });
  });

  describe('sendAudioChunk', () => {
    it('should send binary frame when connected', () => {
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      const chunk = new Int16Array([100, 200, -300, 400]);
      client.sendAudioChunk(chunk);

      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBe(1);
      expect(ws.sentMessages[0]).toEqual(
        chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      );

      client.disconnect();
    });

    it('should not send when not connected', () => {
      MockWebSocket.behavior = 'manual';
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');
      // Still in 'connecting' state

      const chunk = new Int16Array([100, 200]);
      client.sendAudioChunk(chunk);

      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBe(0);

      client.disconnect();
    });
  });

  describe('sendEndOfStream', () => {
    it('should send "Done" text frame when connected', () => {
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'tab');
      vi.advanceTimersByTime(0);

      client.sendEndOfStream();

      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBe(1);
      expect(ws.sentMessages[0]).toBe('Done');

      client.disconnect();
    });

    it('should not send when not connected', () => {
      MockWebSocket.behavior = 'manual';
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');

      client.sendEndOfStream();

      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBe(0);

      client.disconnect();
    });
  });

  describe('disconnect', () => {
    it('should close connection gracefully', () => {
      const client = new WebSocketClientService();
      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      client.disconnect();

      const ws = MockWebSocket.instances[0];
      expect(ws.closeCalled).toBe(true);
      expect(ws.closeCode).toBe(1000);
      expect(client.getStatus()).toBe('disconnected');
      expect(client.getSource()).toBeNull();
    });

    it('should clear reconnect timer on disconnect', () => {
      MockWebSocket.behavior = 'fail';
      const client = new WebSocketClientService({ reconnectIntervalMs: 1000 });
      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0); // trigger failure, starts reconnect timer

      expect(client.getStatus()).toBe('reconnecting');
      client.disconnect();
      expect(client.getStatus()).toBe('disconnected');

      // Advance past reconnect interval — no new connections
      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  describe('onTranscript - JSON response parsing', () => {
    it('should parse sherpa-onnx JSON response and emit transcript', () => {
      const client = new WebSocketClientService();
      const transcriptCallback = vi.fn();
      client.onTranscript(transcriptCallback);

      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      const ws = MockWebSocket.instances[0];
      // Simulate server response
      const response = JSON.stringify({
        text: 'hello world',
        tokens: ['hello', ' ', 'world'],
        timestamps: [0.1, 0.2, 0.3],
        segment: 0,
      });
      ws.onmessage!(new MessageEvent('message', { data: response }));

      expect(transcriptCallback).toHaveBeenCalledTimes(1);
      expect(transcriptCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'hello world',
          isFinal: false,
          source: 'mic',
          segmentId: 'mic-0',
        })
      );

      client.disconnect();
    });

    it('should detect segment change as isFinal', () => {
      const client = new WebSocketClientService();
      const transcriptCallback = vi.fn();
      client.onTranscript(transcriptCallback);

      client.connect('ws://localhost:6006', 'tab');
      vi.advanceTimersByTime(0);

      const ws = MockWebSocket.instances[0];

      // First message — segment 0
      ws.onmessage!(new MessageEvent('message', {
        data: JSON.stringify({ text: 'hello', tokens: [], timestamps: [], segment: 0 }),
      }));

      // Second message — still segment 0 (partial)
      ws.onmessage!(new MessageEvent('message', {
        data: JSON.stringify({ text: 'hello world', tokens: [], timestamps: [], segment: 0 }),
      }));

      // Third message — segment 1 (new segment = previous was final)
      ws.onmessage!(new MessageEvent('message', {
        data: JSON.stringify({ text: 'how', tokens: [], timestamps: [], segment: 1 }),
      }));

      expect(transcriptCallback).toHaveBeenCalledTimes(3);
      // First call: isFinal = false (first message, lastSegment was -1)
      expect(transcriptCallback.mock.calls[0][0].isFinal).toBe(false);
      // Second call: isFinal = false (same segment)
      expect(transcriptCallback.mock.calls[1][0].isFinal).toBe(false);
      // Third call: isFinal = true (segment changed from 0 to 1)
      expect(transcriptCallback.mock.calls[2][0].isFinal).toBe(true);
      expect(transcriptCallback.mock.calls[2][0].segmentId).toBe('tab-1');

      client.disconnect();
    });

    it('should ignore malformed JSON responses', () => {
      const client = new WebSocketClientService();
      const transcriptCallback = vi.fn();
      client.onTranscript(transcriptCallback);

      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      const ws = MockWebSocket.instances[0];
      ws.onmessage!(new MessageEvent('message', { data: 'not valid json' }));

      expect(transcriptCallback).not.toHaveBeenCalled();
      client.disconnect();
    });

    it('should ignore binary messages', () => {
      const client = new WebSocketClientService();
      const transcriptCallback = vi.fn();
      client.onTranscript(transcriptCallback);

      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0);

      const ws = MockWebSocket.instances[0];
      ws.onmessage!(new MessageEvent('message', { data: new ArrayBuffer(10) }));

      expect(transcriptCallback).not.toHaveBeenCalled();
      client.disconnect();
    });
  });

  describe('reconnection', () => {
    it('should attempt reconnection on unexpected close', () => {
      MockWebSocket.behavior = 'fail';
      const reconnectingCallback = vi.fn();
      const client = new WebSocketClientService({ reconnectIntervalMs: 1000 });
      client.onReconnecting(reconnectingCallback);

      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0); // initial failure

      expect(client.getStatus()).toBe('reconnecting');
      expect(reconnectingCallback).toHaveBeenCalledWith('mic', 1);

      client.disconnect();
    });

    it('should emit connection-error after max attempts exhausted', () => {
      MockWebSocket.behavior = 'fail';
      const errorCallback = vi.fn();
      const client = new WebSocketClientService({
        maxReconnectAttempts: 3,
        reconnectIntervalMs: 100,
      });
      client.onConnectionError(errorCallback);

      client.connect('ws://localhost:6006', 'mic');
      vi.advanceTimersByTime(0); // initial failure, attempt 1

      vi.advanceTimersByTime(101); // attempt 2
      vi.advanceTimersByTime(101); // attempt 3
      vi.advanceTimersByTime(101); // triggers failed state

      expect(client.getStatus()).toBe('failed');
      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(errorCallback).toHaveBeenCalledWith('mic', expect.any(String));

      client.disconnect();
    });
  });
});

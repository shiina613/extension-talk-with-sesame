import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { WebSocketClientService } from './websocket-client.service';

/**
 * Feature: stt-zipformer-extension, Property 3: WebSocket reconnection respects retry limits
 *
 * For any sequence of WebSocket connection failure events, the client SHALL attempt
 * reconnection at most 3 times. After 3 consecutive failures without a successful
 * connection in between, the client SHALL transition to a 'failed' state and not
 * attempt further reconnections.
 *
 * Validates: Requirements 4.4
 */

// Mock WebSocket that can be configured to fail or succeed
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static shouldFail = true;

  binaryType: string = 'blob';
  readyState: number = WebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);

    // Simulate async connection attempt
    setTimeout(() => {
      if (MockWebSocket.shouldFail) {
        this.readyState = WebSocket.CLOSED;
        if (this.onerror) {
          this.onerror(new Event('error'));
        }
        if (this.onclose) {
          this.onclose(new CloseEvent('close', { code: 1006 }));
        }
      } else {
        this.readyState = WebSocket.OPEN;
        if (this.onopen) {
          this.onopen(new Event('open'));
        }
      }
    }, 0);
  }

  send(_data: string | ArrayBuffer): void {}
  close(_code?: number, _reason?: string): void {
    this.readyState = WebSocket.CLOSED;
  }
}

describe('Property 3: WebSocket reconnection respects retry limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    MockWebSocket.shouldFail = true;
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should attempt at most maxReconnectAttempts reconnections for any failure sequence', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary maxReconnectAttempts between 1 and 10
        fc.integer({ min: 1, max: 10 }),
        // Generate arbitrary reconnect interval
        fc.integer({ min: 100, max: 5000 }),
        (maxAttempts, intervalMs) => {
          MockWebSocket.instances = [];
          MockWebSocket.shouldFail = true;

          const client = new WebSocketClientService({
            maxReconnectAttempts: maxAttempts,
            reconnectIntervalMs: intervalMs,
          });

          // Initial connection attempt
          client.connect('ws://localhost:6006', 'mic');
          vi.advanceTimersByTime(0); // trigger initial connection failure

          // Advance through all reconnection attempts
          for (let i = 0; i < maxAttempts + 5; i++) {
            vi.advanceTimersByTime(intervalMs + 1);
          }

          // Total connection attempts = 1 initial + maxAttempts reconnections
          // But we should never exceed maxAttempts reconnections
          const totalAttempts = MockWebSocket.instances.length;
          expect(totalAttempts).toBeLessThanOrEqual(1 + maxAttempts);
          expect(client.getStatus()).toBe('failed');

          client.disconnect();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should transition to failed state after maxReconnectAttempts consecutive failures', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (maxAttempts) => {
          MockWebSocket.instances = [];
          MockWebSocket.shouldFail = true;

          const errorCallback = vi.fn();
          const client = new WebSocketClientService({
            maxReconnectAttempts: maxAttempts,
            reconnectIntervalMs: 100,
          });
          client.onConnectionError(errorCallback);

          client.connect('ws://localhost:6006', 'tab');
          vi.advanceTimersByTime(0); // initial failure

          // Advance through reconnection attempts
          for (let i = 0; i < maxAttempts; i++) {
            vi.advanceTimersByTime(101);
          }

          expect(client.getStatus()).toBe('failed');
          expect(errorCallback).toHaveBeenCalledTimes(1);
          expect(errorCallback).toHaveBeenCalledWith(
            'tab',
            expect.stringContaining('failed')
          );

          client.disconnect();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not attempt further reconnections after reaching failed state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 20 }),
        (maxAttempts, extraTicks) => {
          MockWebSocket.instances = [];
          MockWebSocket.shouldFail = true;

          const client = new WebSocketClientService({
            maxReconnectAttempts: maxAttempts,
            reconnectIntervalMs: 100,
          });

          client.connect('ws://localhost:6006', 'mic');
          vi.advanceTimersByTime(0);

          // Exhaust all reconnection attempts
          for (let i = 0; i < maxAttempts; i++) {
            vi.advanceTimersByTime(101);
          }

          const instancesAfterFailed = MockWebSocket.instances.length;

          // Advance extra time — no new connections should be created
          for (let i = 0; i < extraTicks; i++) {
            vi.advanceTimersByTime(101);
          }

          expect(MockWebSocket.instances.length).toBe(instancesAfterFailed);
          expect(client.getStatus()).toBe('failed');

          client.disconnect();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reset reconnection counter on successful connection', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (maxAttempts) => {
          MockWebSocket.instances = [];

          const client = new WebSocketClientService({
            maxReconnectAttempts: maxAttempts,
            reconnectIntervalMs: 100,
          });

          // First: fail some attempts (less than max)
          MockWebSocket.shouldFail = true;
          client.connect('ws://localhost:6006', 'mic');
          vi.advanceTimersByTime(0); // initial failure → attempt 1

          // Fail a few more times but stay under the limit
          const failCount = Math.min(maxAttempts - 2, maxAttempts - 1);
          for (let i = 0; i < failCount; i++) {
            vi.advanceTimersByTime(101);
          }
          expect(client.getStatus()).toBe('reconnecting');

          // Now let the next connection succeed
          MockWebSocket.shouldFail = false;
          vi.advanceTimersByTime(101);

          expect(client.getStatus()).toBe('connected');
          expect(client.getReconnectAttempt()).toBe(0);

          client.disconnect();
        }
      ),
      { numRuns: 100 }
    );
  });
});

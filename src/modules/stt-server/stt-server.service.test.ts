import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SttServerService } from './stt-server.service';

// Mock WebSocket
class MockWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  static instances: MockWebSocket[] = [];
  static behavior: 'open' | 'error' | 'timeout' = 'open';

  constructor(public url: string) {
    MockWebSocket.instances.push(this);

    // Simulate async behavior
    setTimeout(() => {
      switch (MockWebSocket.behavior) {
        case 'open':
          this.onopen?.();
          break;
        case 'error':
          this.onerror?.();
          break;
        case 'timeout':
          // Do nothing — let the timeout fire
          break;
      }
    }, 0);
  }

  close() {
    // no-op for mock
  }

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.behavior = 'open';
  }
}

// Install mock WebSocket globally
vi.stubGlobal('WebSocket', MockWebSocket);

describe('SttServerService', () => {
  let service: SttServerService;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    service = new SttServerService();
  });

  afterEach(() => {
    service.stopHealthPolling();
    vi.useRealTimers();
  });

  describe('checkHealth', () => {
    it('should return true when server responds (WebSocket opens)', async () => {
      MockWebSocket.behavior = 'open';

      const healthPromise = service.checkHealth('localhost', 6006);
      await vi.advanceTimersByTimeAsync(10);

      const result = await healthPromise;
      expect(result).toBe(true);
      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:6006');
    });

    it('should return false when server connection fails', async () => {
      MockWebSocket.behavior = 'error';

      const healthPromise = service.checkHealth('localhost', 6006);
      await vi.advanceTimersByTimeAsync(10);

      const result = await healthPromise;
      expect(result).toBe(false);
    });

    it('should return false when connection times out', async () => {
      MockWebSocket.behavior = 'timeout';

      const healthPromise = service.checkHealth('localhost', 6006);
      // Advance past the 3000ms health check timeout
      await vi.advanceTimersByTimeAsync(1100);

      const result = await healthPromise;
      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return initial stopped status', () => {
      const status = service.getStatus();
      expect(status.state).toBe('stopped');
      expect(status.containerId).toBeNull();
      expect(status.errorMessage).toBeNull();
    });

    it('should return a copy of status (immutable)', () => {
      const status1 = service.getStatus();
      const status2 = service.getStatus();
      expect(status1).toEqual(status2);
      expect(status1).not.toBe(status2);
    });
  });

  describe('startHealthPolling', () => {
    it('should update status to ready when health check succeeds', async () => {
      MockWebSocket.behavior = 'open';

      service.startHealthPolling('localhost', 6006, 5000);
      // Let the first poll execute
      await vi.advanceTimersByTimeAsync(10);

      const status = service.getStatus();
      expect(status.state).toBe('ready');
      expect(status.errorMessage).toBeNull();
    });

    it('should update status to error when health check fails', async () => {
      MockWebSocket.behavior = 'error';

      service.startHealthPolling('localhost', 6006, 5000);
      // Advance past setTimeout(0) in MockWebSocket + allow async poll to complete
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();
      expect(status.state).toBe('error');
      expect(status.errorMessage).toContain('not running');
    });

    it('should transition to unresponsive after 10s of failures', async () => {
      MockWebSocket.behavior = 'error';

      service.startHealthPolling('localhost', 6006, 5000);
      // First poll at t=0
      await vi.advanceTimersByTimeAsync(100);
      expect(service.getStatus().state).toBe('error');

      // Second poll — still within 10s window
      await vi.advanceTimersByTimeAsync(3000);
      expect(service.getStatus().state).toBe('error');

      // Advance past 10s since polling started (3s poll interval while unhealthy)
      await vi.advanceTimersByTimeAsync(10000);
      const status = service.getStatus();
      expect(status.state).toBe('unresponsive');
      expect(status.errorMessage).toContain('unresponsive');
    });

    it('should poll again after ready interval when server is healthy', async () => {
      MockWebSocket.behavior = 'open';

      service.startHealthPolling('localhost', 6006, 2000);
      await vi.advanceTimersByTimeAsync(10);
      expect(MockWebSocket.instances.length).toBe(1);
      expect(service.getStatus().state).toBe('ready');

      // Ready servers use a slower poll interval (15s)
      await vi.advanceTimersByTimeAsync(15000);
      expect(MockWebSocket.instances.length).toBe(2);
    });

    it('should recover to ready state after failure then success', async () => {
      MockWebSocket.behavior = 'error';

      service.startHealthPolling('localhost', 6006, 5000);
      await vi.advanceTimersByTimeAsync(100);
      expect(service.getStatus().state).toBe('error');

      // Server comes back
      MockWebSocket.behavior = 'open';
      await vi.advanceTimersByTimeAsync(3000);

      expect(service.getStatus().state).toBe('ready');
      expect(service.getStatus().errorMessage).toBeNull();
    });
  });

  describe('stopHealthPolling', () => {
    it('should stop polling when called', async () => {
      MockWebSocket.behavior = 'open';

      service.startHealthPolling('localhost', 6006, 2000);
      await vi.advanceTimersByTimeAsync(10);
      expect(MockWebSocket.instances.length).toBe(1);

      service.stopHealthPolling();

      // No more polls after stopping
      await vi.advanceTimersByTimeAsync(20000);
      expect(MockWebSocket.instances.length).toBe(1);
    });
  });

  describe('onStatusChange', () => {
    it('should notify listeners when status changes', async () => {
      MockWebSocket.behavior = 'open';
      const callback = vi.fn();

      service.onStatusChange(callback);
      service.startHealthPolling('localhost', 6006, 5000);
      await vi.advanceTimersByTimeAsync(10);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'ready' })
      );
    });

    it('should notify with error message when server unavailable', async () => {
      MockWebSocket.behavior = 'error';
      const callback = vi.fn();

      service.onStatusChange(callback);
      service.startHealthPolling('localhost', 6006, 5000);
      await vi.advanceTimersByTimeAsync(100);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'error',
          errorMessage: expect.stringContaining('not running'),
        })
      );
    });

    it('should allow removing listeners with offStatusChange', async () => {
      MockWebSocket.behavior = 'open';
      const callback = vi.fn();

      service.onStatusChange(callback);
      service.offStatusChange(callback);
      service.startHealthPolling('localhost', 6006, 5000);
      await vi.advanceTimersByTimeAsync(10);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});

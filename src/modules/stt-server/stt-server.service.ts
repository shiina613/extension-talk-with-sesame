import type { ServerStatus } from '@shared/types/server.types';
import { ServerUnavailableError, ServerUnresponsiveError } from '@shared/errors';
import {
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_INTERVAL_READY_MS,
  UNRESPONSIVE_TIMEOUT_MS,
} from '@shared/constants';

type StatusChangeCallback = (status: ServerStatus) => void;

/**
 * Health checker service for the STT Docker server.
 * Monitors server availability via WebSocket connection attempts.
 */
export class SttServerService {
  private status: ServerStatus = {
    state: 'stopped',
    containerId: null,
    uptime: 0,
    lastHealthCheck: 0,
    errorMessage: null,
  };

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number = HEALTH_CHECK_INTERVAL_MS;
  private lastSuccessfulCheck: number = 0;
  private statusChangeListeners: StatusChangeCallback[] = [];
  private checkInFlight: Promise<boolean> | null = null;
  private pollHost: string = 'localhost';
  private pollPort: number = 6006;
  private pollingStartedAt: number = 0;

  /**
   * Attempt a WebSocket connection to verify the STT server is running.
   * Returns true if the server responds, false otherwise.
   */
  async checkHealth(host: string, port: number): Promise<boolean> {
    const url = `ws://${host}:${port}`;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let ws: WebSocket;

      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(result);
      };

      const timeout = setTimeout(() => finish(false), HEALTH_CHECK_TIMEOUT_MS);

      try {
        ws = new WebSocket(url);
      } catch {
        finish(false);
        return;
      }

      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false);
      // Ignore onclose — open/error already decided; close after success is normal
    });
  }

  /**
   * Run a single health check (deduped if one is already in flight).
   */
  async runImmediateCheck(host: string, port: number): Promise<boolean> {
    if (this.checkInFlight) {
      return this.checkInFlight;
    }
    this.checkInFlight = this.checkHealth(host, port).finally(() => {
      this.checkInFlight = null;
    });
    return this.checkInFlight;
  }

  /**
   * Probe server now and update internal status. Returns latest status.
   */
  async probeNow(host: string, port: number): Promise<ServerStatus> {
    this.updateStatus({ state: 'starting', errorMessage: null });
    const healthy = await this.runImmediateCheck(host, port);
    this.applyHealthResult(healthy);
    return this.getStatus();
  }

  /**
   * Start periodic health polling at the given interval.
   * Uses a faster interval while server is not ready.
   */
  startHealthPolling(
    host: string,
    port: number,
    interval: number = HEALTH_CHECK_INTERVAL_MS,
  ): void {
    this.stopHealthPolling();
    this.pollHost = host;
    this.pollPort = port;
    this.pollIntervalMs = interval;
    this.lastSuccessfulCheck = 0;
    this.pollingStartedAt = Date.now();

    this.updateStatus({ state: 'starting', errorMessage: null });

    const poll = async () => {
      const healthy = await this.runImmediateCheck(host, port);
      this.applyHealthResult(healthy);
      this.scheduleNextPoll();
    };

    void poll();
  }

  /**
   * Stop the health polling loop.
   */
  stopHealthPolling(): void {
    if (this.pollingTimer !== null) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Get the current server status.
   */
  getStatus(): ServerStatus {
    return { ...this.status };
  }

  /**
   * Register a callback for status changes.
   */
  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeListeners.push(callback);
  }

  /**
   * Remove a previously registered status change callback.
   */
  offStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeListeners = this.statusChangeListeners.filter(
      (cb) => cb !== callback,
    );
  }

  private applyHealthResult(healthy: boolean): void {
    const now = Date.now();

    if (healthy) {
      const wasReady = this.status.state === 'ready';
      this.lastSuccessfulCheck = now;
      this.updateStatus({
        state: 'ready',
        lastHealthCheck: now,
        errorMessage: null,
        uptime: wasReady ? this.status.uptime : 0,
      });
      return;
    }

    const timeSinceLastSuccess =
      this.lastSuccessfulCheck > 0 ? now - this.lastSuccessfulCheck : now - this.pollingStartedAt;

    if (timeSinceLastSuccess >= UNRESPONSIVE_TIMEOUT_MS) {
      const error = new ServerUnresponsiveError();
      this.updateStatus({
        state: 'unresponsive',
        lastHealthCheck: now,
        errorMessage: error.userMessage,
      });
    } else {
      const error = new ServerUnavailableError();
      this.updateStatus({
        state: 'error',
        lastHealthCheck: now,
        errorMessage: error.userMessage,
      });
    }
  }

  private scheduleNextPoll(): void {
    this.pollIntervalMs =
      this.status.state === 'ready'
        ? HEALTH_CHECK_INTERVAL_READY_MS
        : HEALTH_CHECK_INTERVAL_MS;

    this.pollingTimer = setTimeout(() => {
      void this.runImmediateCheck(this.pollHost, this.pollPort).then((healthy) => {
        this.applyHealthResult(healthy);
        this.scheduleNextPoll();
      });
    }, this.pollIntervalMs);
  }

  private updateStatus(partial: Partial<ServerStatus>): void {
    const previousState = this.status.state;
    this.status = { ...this.status, ...partial };

    if (this.status.state !== previousState || partial.errorMessage !== undefined) {
      for (const listener of this.statusChangeListeners) {
        listener(this.getStatus());
      }
    }
  }
}

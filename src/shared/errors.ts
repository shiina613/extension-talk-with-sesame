import type { AudioSource } from './types/audio.types';

/** Base class for all extension-specific errors */
export abstract class ExtensionError extends Error {
  abstract readonly code: string;
  abstract readonly recoverable: boolean;
  abstract readonly userMessage: string;
}

/** STT Server is not running or unreachable */
export class ServerUnavailableError extends ExtensionError {
  readonly code = 'SERVER_UNAVAILABLE';
  readonly recoverable = false;
  readonly userMessage: string;

  constructor() {
    super('STT Server is not running');
    this.name = 'ServerUnavailableError';
    this.userMessage = 'STT Server is not running. Start it with: docker compose up -d';
  }
}

/** STT Server is running but not responding to requests */
export class ServerUnresponsiveError extends ExtensionError {
  readonly code = 'SERVER_UNRESPONSIVE';
  readonly recoverable = false;
  readonly userMessage: string;

  constructor() {
    super('STT Server is unresponsive');
    this.name = 'ServerUnresponsiveError';
    this.userMessage = 'STT Server is unresponsive. Try restarting: docker compose restart';
  }
}

/** WebSocket connection was lost during active recording */
export class ConnectionLostError extends ExtensionError {
  readonly code = 'WS_CONNECTION_LOST';
  readonly recoverable = true;
  readonly userMessage = 'Connection lost. Attempting to reconnect...';

  constructor() {
    super('WebSocket connection lost');
    this.name = 'ConnectionLostError';
  }
}

/** All reconnection attempts exhausted for a given audio source */
export class ReconnectionFailedError extends ExtensionError {
  readonly code = 'WS_RECONNECT_FAILED';
  readonly recoverable = false;
  readonly userMessage: string;

  constructor(source: AudioSource) {
    super(`Reconnection failed for ${source}`);
    this.name = 'ReconnectionFailedError';
    this.userMessage = `Could not reconnect ${source} stream. Recording stopped.`;
  }
}

/** No microphone device detected on the system */
export class MicrophoneNotFoundError extends ExtensionError {
  readonly code = 'MIC_NOT_FOUND';
  readonly recoverable = false;
  readonly userMessage = 'No microphone detected. Please connect a microphone and try again.';

  constructor() {
    super('No microphone detected');
    this.name = 'MicrophoneNotFoundError';
  }
}

/** Tab audio capture permission was denied or unavailable */
export class TabCaptureError extends ExtensionError {
  readonly code = 'TAB_CAPTURE_DENIED';
  readonly recoverable = false;
  readonly userMessage = 'Tab audio capture permission denied. Click the extension icon on the tab you want to capture.';

  constructor() {
    super('Tab capture permission denied');
    this.name = 'TabCaptureError';
  }
}

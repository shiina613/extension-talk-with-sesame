import { AudioSource, AudioConfig } from './audio.types';
import { ChatMessage } from './chat.types';
import { ExtensionConfig, ExtensionState, TranscriptResult } from './server.types';

// Messages from Popup → Service Worker
export type PopupMessage =
  | { type: 'start-mic-recording' }
  | { type: 'stop-mic-recording' }
  | { type: 'start-tab-recording'; tabId: number; streamId: string }
  | { type: 'stop-tab-recording' }
  | { type: 'start-conversation'; tabId: number; streamId: string }
  | { type: 'stop-conversation' }
  | { type: 'get-state' }
  | { type: 'refresh-server-status' }
  | { type: 'update-config'; config: Partial<ExtensionConfig> }
  | { type: 'clear-session' }
  | { type: 'copy-transcript' };

// Messages from Service Worker → Popup
export type ServiceWorkerMessage =
  | { type: 'state-update'; state: ExtensionState }
  | { type: 'transcript-update'; message: ChatMessage }
  | { type: 'error'; error: string; source: string };

// Messages from Service Worker → Offscreen
export type OffscreenCommand =
  | { type: 'start-mic'; config: AudioConfig; serverUrl: string }
  | { type: 'stop-mic' }
  | { type: 'start-tab'; streamId: string; config: AudioConfig; serverUrl: string }
  | { type: 'stop-tab' }
  | { type: 'stop-all' };

/** Response from Offscreen → Service Worker for command completion */
export type OffscreenCommandResponse =
  | { ok: true }
  | { ok: false; error: string };

// Messages from Offscreen → Service Worker
export type OffscreenEvent =
  | { type: 'transcript'; data: TranscriptResult }
  | { type: 'recording-started'; source: AudioSource }
  | { type: 'recording-stopped'; source: AudioSource }
  | { type: 'connection-error'; source: AudioSource; error: string }
  | { type: 'reconnecting'; source: AudioSource; attempt: number };

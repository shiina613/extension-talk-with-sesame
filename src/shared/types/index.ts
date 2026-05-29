// Shared types - Re-export all shared type definitions

export type { AudioSource, AudioConfig, AudioChunkMessage } from './audio.types';
export type { ChatMessage, ChatSession, UIState } from './chat.types';
export type {
  ServerConfig,
  ServerStatus,
  ExtensionConfig,
  ExtensionState,
  PopupStateResponse,
  TranscriptResult,
} from './server.types';
export type {
  PopupMessage,
  ServiceWorkerMessage,
  OffscreenCommand,
  OffscreenCommandResponse,
  OffscreenEvent,
} from './messages.types';

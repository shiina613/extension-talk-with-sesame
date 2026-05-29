import { AudioSource } from './audio.types';
import { ChatMessage } from './chat.types';

/** Docker STT server configuration */
export interface ServerConfig {
  host: string;              // default: 'localhost'
  port: number;              // default: 6006
  dockerImage: string;       // default: 'stt-zipformer-server'
  numThreads: number;        // default: 2
  maxBatchSize: number;      // default: 5
  decodingMethod: 'greedy_search' | 'modified_beam_search';
}

/** Current status of the STT server */
export interface ServerStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error' | 'unresponsive';
  containerId: string | null;
  uptime: number;
  lastHealthCheck: number;
  errorMessage: string | null;
}

/** Extension-level configuration stored in chrome.storage */
export interface ExtensionConfig {
  serverHost: string;       // default: 'localhost'
  serverPort: number;       // default: 6006
  modelPath: string;        // path to sherpa-onnx model
  audioChunkSizeMs: number; // default: 500 (0.5s)
}

/** Global extension state managed by the service worker */
export interface ExtensionState {
  serverStatus: 'stopped' | 'starting' | 'ready' | 'error';
  micRecording: boolean;
  tabRecording: boolean;
  activeTabId: number | null;
  config: ExtensionConfig;
}

/** Extension state plus chat history for popup sync */
export interface PopupStateResponse extends ExtensionState {
  messages: ChatMessage[];
}

/** Result from the STT server transcript */
export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  source: AudioSource;
  timestamp: number;
  segmentId: string;
}

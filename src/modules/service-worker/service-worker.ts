// Service Worker - Extension orchestrator
// Manages extension state and routes messages between popup and offscreen document

import {
  ExtensionState,
  PopupStateResponse,
  PopupMessage,
  ServiceWorkerMessage,
  OffscreenEvent,
  OffscreenCommand,
  OffscreenCommandResponse,
  AudioConfig,
} from '@shared/types';
import { getDefaults, loadConfig, saveConfig } from '@modules/config';
import { SttServerService } from '@modules/stt-server';
import {
  addMessage,
  updateInterim,
  finalizeMessage,
  removeBySegmentId,
  clearSession,
  startNewSession,
  getCurrentSession,
  getMessages,
  formatForClipboard,
} from '@modules/chat-ui';
import { applyTranscriptToStore } from '@shared/transcript';
import {
  DEFAULT_SAMPLE_RATE,
  DEFAULT_CHANNELS,
  DEFAULT_BIT_DEPTH,
  HEALTH_CHECK_INTERVAL_MS,
} from '@shared/constants';

// --- Offscreen Document Lifecycle ---

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

/**
 * Ensures the offscreen document exists, creating it if necessary.
 * Returns true if a new document was created, false if it already existed.
 */
export async function ensureOffscreenDocument(): Promise<boolean> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    return false;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Audio capture and WebSocket communication for speech-to-text processing',
  });
  return true;
}

/**
 * Closes the offscreen document if it exists.
 */
export async function closeOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length === 0) {
    return;
  }

  await chrome.offscreen.closeDocument();
}

/**
 * Sends an OffscreenCommand message to the offscreen document.
 * Ensures the offscreen document exists before sending.
 */
export async function sendOffscreenCommand(
  command: OffscreenCommand,
): Promise<OffscreenCommandResponse> {
  const wasCreated = await ensureOffscreenDocument();
  if (wasCreated) {
    // Wait for offscreen document script to load and register listeners
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log('[sw] Sending offscreen command:', command.type);
  const response = (await chrome.runtime.sendMessage(
    command,
  )) as OffscreenCommandResponse | undefined;
  return response ?? { ok: true };
}

function buildServerUrl(): string {
  const { serverHost, serverPort } = state.config;
  return `ws://${serverHost}:${serverPort}`;
}

function isServerReady(): boolean {
  return state.serverStatus === 'ready';
}

// --- State Management ---

let state: ExtensionState = {
  serverStatus: 'stopped',
  micRecording: false,
  tabRecording: false,
  activeTabId: null,
  config: getDefaults(),
};

export function getState(): ExtensionState {
  return { ...state };
}

function buildPopupState(): PopupStateResponse {
  return { ...getState(), messages: getMessages() };
}

export function updateState(partial: Partial<ExtensionState>): void {
  state = { ...state, ...partial };
  broadcastStateUpdate();
}

// --- Health Checker Instance ---

const healthChecker = new SttServerService();

export function getHealthChecker(): SttServerService {
  return healthChecker;
}

// --- Broadcasting ---

function broadcastStateUpdate(): void {
  const message: ServiceWorkerMessage = { type: 'state-update', state: getState() };
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may not be open — ignore send failures
  });
}

function sendError(error: string, source: string): void {
  const message: ServiceWorkerMessage = { type: 'error', error, source };
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may not be open — ignore send failures
  });
}

// --- Audio Config Builder ---

function buildAudioConfig(): AudioConfig {
  return {
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    bitDepth: DEFAULT_BIT_DEPTH,
    chunkSizeMs: state.config.audioChunkSizeMs,
  };
}

// --- Tab Capture Flow ---

/**
 * Starts tab audio capture using a streamId obtained from the popup (user gesture).
 * getMediaStreamId must run in the popup — calling it here loses the gesture and fails.
 */
async function startTabCapture(
  tabId: number,
  streamId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isServerReady()) {
    const errorMessage = 'STT server is not ready. Run: docker compose up -d';
    sendError(errorMessage, 'tab-capture');
    return { success: false, error: errorMessage };
  }

  try {
    const audioConfig = buildAudioConfig();
    const result = await sendOffscreenCommand({
      type: 'start-tab',
      streamId,
      config: audioConfig,
      serverUrl: buildServerUrl(),
    });
    if (!result.ok) {
      sendError(result.error, 'tab-capture');
      return { success: false, error: result.error };
    }
    updateState({ activeTabId: tabId });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Tab capture failed';
    sendError(errorMessage, 'tab-capture');
    return { success: false, error: errorMessage };
  }
}

/**
 * Stops tab audio capture by sending stop command to offscreen document.
 */
async function stopTabCapture(): Promise<void> {
  try {
    await sendOffscreenCommand({ type: 'stop-tab' });
  } catch {
    // Best-effort stop — continue with state update
  }
  updateState({ tabRecording: false, activeTabId: null });
}

// --- Mic Recording Flow ---

/**
 * Starts microphone recording by sending start-mic command to offscreen document.
 */
async function startMicRecording(): Promise<{ success: boolean; error?: string }> {
  if (!isServerReady()) {
    const errorMessage = 'STT server is not ready. Run: docker compose up -d';
    sendError(errorMessage, 'mic-recording');
    return { success: false, error: errorMessage };
  }

  try {
    const audioConfig = buildAudioConfig();
    const result = await sendOffscreenCommand({
      type: 'start-mic',
      config: audioConfig,
      serverUrl: buildServerUrl(),
    });
    if (!result.ok) {
      sendError(result.error, 'mic-recording');
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Mic recording failed';
    sendError(errorMessage, 'mic-recording');
    return { success: false, error: errorMessage };
  }
}

/**
 * Stops microphone recording by sending stop-mic command to offscreen document.
 */
async function stopMicRecording(): Promise<void> {
  try {
    await sendOffscreenCommand({ type: 'stop-mic' });
  } catch {
    // Best-effort stop — continue with state update
  }
  updateState({ micRecording: false });
}

// --- Conversation Mode Orchestration ---

/**
 * Starts conversation mode: activates both mic and tab recording simultaneously.
 * Requires a tabId to capture tab audio from.
 */
async function startConversation(
  tabId: number,
  streamId: string,
): Promise<{ success: boolean; error?: string }> {
  // Start a new chat session for the conversation
  startNewSession();

  const micResult = await startMicRecording();
  if (!micResult.success) {
    return { success: false, error: micResult.error };
  }

  const tabResult = await startTabCapture(tabId, streamId);
  if (!tabResult.success) {
    // Rollback mic recording if tab capture fails
    await stopMicRecording();
    return { success: false, error: tabResult.error };
  }

  return { success: true };
}

/**
 * Stops conversation mode: stops both mic and tab recording.
 */
async function stopConversation(): Promise<void> {
  try {
    await sendOffscreenCommand({ type: 'stop-all' });
  } catch {
    // Best-effort stop
  }
  updateState({ micRecording: false, tabRecording: false, activeTabId: null });
}

// --- Server Health Check Integration ---

/**
 * Initializes health check polling and wires status updates to extension state.
 * Called on extension activation (bootstrap).
 */
export function startHealthCheckIntegration(): void {
  const { serverHost, serverPort } = state.config;

  healthChecker.onStatusChange((status) => {
    const serverStatus = mapServerState(status.state);
    updateState({ serverStatus });

    if (status.errorMessage) {
      sendError(status.errorMessage, 'stt-server');
    }
  });

  healthChecker.startHealthPolling(serverHost, serverPort, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Probe STT server immediately and sync extension state.
 * Used when popup opens so the user does not wait for the next poll tick.
 */
export async function refreshServerStatus(): Promise<PopupStateResponse> {
  const { serverHost, serverPort } = state.config;
  const status = await healthChecker.probeNow(serverHost, serverPort);
  const serverStatus = mapServerState(status.state);
  updateState({ serverStatus });
  if (status.errorMessage) {
    sendError(status.errorMessage, 'stt-server');
  }
  return buildPopupState();
}

/**
 * Stops health check polling and all active recordings.
 * Called on extension deactivation.
 */
export async function deactivate(): Promise<void> {
  healthChecker.stopHealthPolling();

  if (state.micRecording || state.tabRecording) {
    try {
      await sendOffscreenCommand({ type: 'stop-all' });
    } catch {
      // Best-effort cleanup
    }
  }

  await closeOffscreenDocument();
  updateState({ micRecording: false, tabRecording: false, activeTabId: null, serverStatus: 'stopped' });
}

function mapServerState(serverState: string): ExtensionState['serverStatus'] {
  switch (serverState) {
    case 'ready':
      return 'ready';
    case 'starting':
      return 'starting';
    case 'error':
    case 'unresponsive':
      return 'error';
    default:
      return 'stopped';
  }
}

// --- Initialization ---

export async function initializeState(): Promise<void> {
  const config = await loadConfig();
  state = { ...state, config };
}

// --- PopupMessage Handler ---

async function handlePopupMessage(
  message: PopupMessage,
  sendResponse: (response: unknown) => void
): Promise<void> {
  switch (message.type) {
    case 'get-state':
      sendResponse(buildPopupState());
      if (state.serverStatus !== 'ready') {
        void refreshServerStatus();
      }
      break;

    case 'refresh-server-status': {
      const refreshed = await refreshServerStatus();
      sendResponse(refreshed);
      break;
    }

    case 'update-config': {
      const result = await saveConfig(message.config);
      if (result.success) {
        const config = await loadConfig();
        updateState({ config });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, errors: result.errors });
      }
      break;
    }

    case 'start-mic-recording': {
      const result = await startMicRecording();
      sendResponse(result);
      break;
    }

    case 'stop-mic-recording':
      await stopMicRecording();
      sendResponse({ success: true });
      break;

    case 'start-tab-recording': {
      const result = await startTabCapture(message.tabId, message.streamId);
      sendResponse(result);
      break;
    }

    case 'stop-tab-recording':
      await stopTabCapture();
      sendResponse({ success: true });
      break;

    case 'start-conversation': {
      const result = await startConversation(message.tabId, message.streamId);
      sendResponse(result);
      break;
    }

    case 'stop-conversation':
      await stopConversation();
      sendResponse({ success: true });
      break;

    case 'clear-session':
      clearSession();
      sendResponse({ success: true });
      break;

    case 'copy-transcript': {
      const messages = getMessages();
      const text = formatForClipboard(messages);
      sendResponse({ success: true, text });
      break;
    }

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

// --- OffscreenEvent Handler ---

function handleOffscreenEvent(event: OffscreenEvent): void {
  switch (event.type) {
    case 'recording-started':
      if (event.source === 'mic') {
        updateState({ micRecording: true });
      } else {
        updateState({ tabRecording: true });
      }
      break;

    case 'recording-stopped':
      if (event.source === 'mic') {
        updateState({ micRecording: false });
      } else {
        updateState({ tabRecording: false, activeTabId: null });
      }
      break;

    case 'transcript': {
      const chatMsg = applyTranscriptToStore(event.data, {
        getMessages,
        addMessage,
        updateInterim,
        finalizeMessage,
        removeBySegmentId,
      });

      const transcriptMessage: ServiceWorkerMessage = {
        type: 'transcript-update',
        message: chatMsg,
      };
      chrome.runtime.sendMessage(transcriptMessage).catch(() => {
        // Popup may not be open
      });
      break;
    }

    case 'connection-error':
      sendError(event.error, event.source);
      if (event.source === 'mic') {
        updateState({ micRecording: false });
      } else {
        updateState({ tabRecording: false, activeTabId: null });
      }
      break;

    case 'reconnecting':
      // Informational — no state change needed
      break;
  }
}

// --- Message type guards ---

function isPopupMessage(message: unknown): message is PopupMessage {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string };
  const popupTypes = [
    'start-mic-recording',
    'stop-mic-recording',
    'start-tab-recording',
    'stop-tab-recording',
    'start-conversation',
    'stop-conversation',
    'get-state',
    'refresh-server-status',
    'update-config',
    'clear-session',
    'copy-transcript',
  ];
  return typeof msg.type === 'string' && popupTypes.includes(msg.type);
}

function isOffscreenEvent(message: unknown): message is OffscreenEvent {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string };
  const offscreenTypes = [
    'transcript',
    'recording-started',
    'recording-stopped',
    'connection-error',
    'reconnecting',
  ];
  return typeof msg.type === 'string' && offscreenTypes.includes(msg.type);
}

// --- Register Message Listeners ---

export function registerMessageListeners(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      if (isPopupMessage(message)) {
        handlePopupMessage(message, sendResponse);
        return true; // Keep message channel open for async response
      }

      if (isOffscreenEvent(message)) {
        handleOffscreenEvent(message);
        return false;
      }

      return false;
    }
  );
}

// --- Bootstrap ---

async function bootstrap(): Promise<void> {
  await initializeState();
  registerMessageListeners();
  startHealthCheckIntegration();
}

bootstrap();

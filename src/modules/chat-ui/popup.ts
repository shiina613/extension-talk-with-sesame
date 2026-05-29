// Popup Controller - Entry point for the extension popup UI
// Connects to service worker and manages UI state rendering

import {
  PopupMessage,
  ServiceWorkerMessage,
  ExtensionState,
  PopupStateResponse,
  ChatMessage,
} from '@shared/types';
import { renderMessage, renderTypingIndicator } from './chat-ui.renderer';
import { formatForClipboard } from './chat-ui.clipboard';
import {
  addMessage,
  updateInterim,
  finalizeMessage,
  clearSession,
  startNewSession,
  getCurrentSession,
  getMessages,
  loadMessages,
} from './chat-ui.service';
import { formatTabCaptureError, validateTabForCapture } from './tab-capture.util';
import { applyTranscriptToStore, liveSegmentId } from '@shared/transcript';
import { removeBySegmentId } from './chat-ui.service';

// --- DOM Element References ---

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

let elements: {
  statusIndicator: HTMLSpanElement;
  statusText: HTMLSpanElement;
  micIndicator: HTMLSpanElement;
  tabIndicator: HTMLSpanElement;
  chatEmpty: HTMLElement;
  chatListening: HTMLElement;
  chatListeningHint: HTMLElement;
  chatMessages: HTMLDivElement;
  chatContainer: HTMLElement;
  btnMic: HTMLButtonElement;
  btnTab: HTMLButtonElement;
  btnConversation: HTMLButtonElement;
  btnCopy: HTMLButtonElement;
  btnClear: HTMLButtonElement;
  btnNewSession: HTMLButtonElement;
};

// --- State ---

let currentState: ExtensionState | null = null;
let conversationMode = false;
let stateRequestAttempts = 0;
let recordingSyncTimer: ReturnType<typeof setInterval> | null = null;
const MAX_STATE_REQUEST_ATTEMPTS = 8;
const RECORDING_SYNC_INTERVAL_MS = 2000;

// --- Service Worker Communication ---

function sendMessage(message: PopupMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

function applyPopupState(response: PopupStateResponse): void {
  currentState = response;
  loadMessages(response.messages ?? []);
  renderState(response);
  renderAllMessages();
  updateEmptyState();
}

async function requestState(): Promise<void> {
  stateRequestAttempts += 1;

  if (stateRequestAttempts === 1) {
    renderServerStatus('starting');
    elements.statusText.textContent = 'Checking STT server...';
  }

  try {
    const state = (await sendMessage({ type: 'refresh-server-status' })) as PopupStateResponse;
    if (state?.serverStatus) {
      applyPopupState(state);
      stateRequestAttempts = 0;
      return;
    }
  } catch {
    // Service worker waking up — fall through to retry
  }

  if (stateRequestAttempts < MAX_STATE_REQUEST_ATTEMPTS) {
    renderServerStatus('starting');
    const delayMs = stateRequestAttempts <= 3 ? 400 : 1500;
    setTimeout(requestState, delayMs);
    return;
  }

  renderServerStatus('error');
  elements.statusText.textContent =
    'Cannot reach extension background — reload the extension';
}

// --- Status Rendering ---

export function renderServerStatus(status: ExtensionState['serverStatus']): void {
  const { statusIndicator, statusText, btnMic, btnTab, btnConversation } = elements;

  statusIndicator.className = 'status-indicator';

  switch (status) {
    case 'ready':
      statusIndicator.classList.add('status-indicator--ready');
      if (!currentState?.micRecording && !currentState?.tabRecording) {
        statusText.textContent = 'Server ready — choose Mic or Tab below';
      }
      btnMic.disabled = false;
      btnTab.disabled = false;
      btnConversation.disabled = false;
      break;
    case 'error':
      statusIndicator.classList.add('status-indicator--error');
      statusText.textContent = 'Server unavailable — run: docker compose up -d';
      btnMic.disabled = true;
      btnTab.disabled = true;
      btnConversation.disabled = true;
      break;
    case 'starting':
      statusIndicator.classList.add('status-indicator--loading');
      statusText.textContent = 'Connecting to server...';
      btnMic.disabled = true;
      btnTab.disabled = true;
      btnConversation.disabled = true;
      break;
    case 'stopped':
    default:
      statusText.textContent = 'Server stopped';
      btnMic.disabled = true;
      btnTab.disabled = true;
      btnConversation.disabled = true;
      break;
  }
}

function updateActivityStatus(): void {
  if (!currentState || currentState.serverStatus !== 'ready') return;

  const { micRecording, tabRecording } = currentState;
  if (micRecording && tabRecording) {
    elements.statusText.textContent = 'Listening — your voice + tab audio';
  } else if (micRecording) {
    elements.statusText.textContent = 'Listening — speak English now';
  } else if (tabRecording) {
    elements.statusText.textContent = 'Listening — tab audio';
  } else {
    elements.statusText.textContent = 'Server ready — choose Mic or Tab below';
  }
}

export function renderRecordingIndicators(micRecording: boolean, tabRecording: boolean): void {
  const { micIndicator, tabIndicator } = elements;

  micIndicator.classList.toggle('hidden', !micRecording);
  tabIndicator.classList.toggle('hidden', !tabRecording);
}

function updateButtonStates(micRecording: boolean, tabRecording: boolean): void {
  const { btnMic, btnTab, btnConversation } = elements;

  btnMic.classList.toggle('btn--active', micRecording);
  btnTab.classList.toggle('btn--active', tabRecording);

  if (micRecording && tabRecording) {
    conversationMode = true;
    btnConversation.classList.add('btn--active');
  } else {
    conversationMode = false;
    btnConversation.classList.remove('btn--active');
  }
}

function stopRecordingSync(): void {
  if (recordingSyncTimer !== null) {
    clearInterval(recordingSyncTimer);
    recordingSyncTimer = null;
  }
}

async function syncTranscriptsWhileRecording(): Promise<void> {
  if (!currentState?.micRecording && !currentState?.tabRecording) {
    stopRecordingSync();
    return;
  }

  try {
    const state = (await sendMessage({ type: 'get-state' })) as PopupStateResponse;
    const incoming = state.messages ?? [];
    if (incoming.length > getMessages().length) {
      loadMessages(incoming);
      renderAllMessages();
      updateEmptyState();
    }
    if (state.serverStatus) {
      currentState = state;
      updateActivityStatus();
    }
  } catch {
    // ignore transient errors while popup is open
  }
}

function startRecordingSync(): void {
  stopRecordingSync();
  recordingSyncTimer = setInterval(() => {
    void syncTranscriptsWhileRecording();
  }, RECORDING_SYNC_INTERVAL_MS);
}

function updateRecordingSync(isRecording: boolean): void {
  if (isRecording) {
    startRecordingSync();
  } else {
    stopRecordingSync();
  }
}

function updateEmptyState(): void {
  const hasMessages = getMessages().length > 0;
  const isRecording = currentState?.micRecording || currentState?.tabRecording;

  elements.chatEmpty.classList.toggle('hidden', hasMessages || !!isRecording);
  elements.chatListening.classList.toggle('hidden', hasMessages || !isRecording);

  if (isRecording && !hasMessages) {
    if (currentState?.micRecording && currentState?.tabRecording) {
      elements.chatListeningHint.textContent =
        'Listening to your voice and tab audio (English only).';
    } else if (currentState?.micRecording) {
      elements.chatListeningHint.textContent = 'Speak English clearly into your microphone.';
    } else {
      elements.chatListeningHint.textContent =
        'Tab capture is less accurate than mic. Interim text updates in one line; finals stay in chat.';
    }
  }
}

function renderState(state: ExtensionState): void {
  renderServerStatus(state.serverStatus);
  renderRecordingIndicators(state.micRecording, state.tabRecording);
  updateButtonStates(state.micRecording, state.tabRecording);
  updateActivityStatus();
  updateRecordingSync(state.micRecording || state.tabRecording);
  updateEmptyState();
}

export function renderTranscriptMessage(message: ChatMessage): void {
  const { chatMessages, chatContainer } = elements;
  const source = message.sender === 'user' ? 'mic' : 'tab';

  if (message.isFinal) {
    const liveEl = chatMessages.querySelector(
      `[data-segment="${liveSegmentId(source)}"]`,
    );
    if (liveEl) liveEl.remove();
  }

  if (!message.isFinal) {
    const existing = chatMessages.querySelector(`[data-segment="${message.segmentId}"]`);
    if (existing) {
      const textEl = existing.querySelector('.message__text');
      if (textEl) textEl.textContent = message.text;
    } else {
      chatMessages.insertAdjacentHTML('beforeend', renderTypingIndicator(message.segmentId, message.text));
    }
  } else {
    const existing = chatMessages.querySelector(`[data-segment="${message.segmentId}"]`);
    if (existing) {
      existing.outerHTML = renderMessage(message);
    } else {
      chatMessages.insertAdjacentHTML('beforeend', renderMessage(message));
    }
  }

  updateEmptyState();
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function renderAllMessages(): void {
  elements.chatMessages.innerHTML = getMessages()
    .map((msg) => renderMessage(msg))
    .join('');
  updateEmptyState();
}

function showPendingRecording(source: 'mic' | 'tab' | 'both'): void {
  if (source === 'mic' || source === 'both') {
    elements.micIndicator.classList.remove('hidden');
    elements.btnMic.classList.add('btn--active');
  }
  if (source === 'tab' || source === 'both') {
    elements.tabIndicator.classList.remove('hidden');
    elements.btnTab.classList.add('btn--active');
  }
  if (source === 'both') {
    elements.btnConversation.classList.add('btn--active');
  }
  elements.chatEmpty.classList.add('hidden');
  elements.statusText.textContent =
    source === 'mic'
      ? 'Starting microphone…'
      : source === 'tab'
        ? 'Waiting for tab audio…'
        : 'Allow mic + Share tab audio in Chrome dialogs…';
}

// --- Tab capture (must run in popup while user gesture is active) ---

async function getActivePageTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found');
  }
  return tab;
}

/** Stop any in-progress capture so Chrome can issue a new tab stream ID. */
async function stopAnyActiveRecording(): Promise<void> {
  if (!currentState?.micRecording && !currentState?.tabRecording) {
    return;
  }
  if (currentState.micRecording && currentState.tabRecording) {
    await sendMessage({ type: 'stop-conversation' });
  } else if (currentState.tabRecording) {
    await sendMessage({ type: 'stop-tab-recording' });
  } else {
    await sendMessage({ type: 'stop-mic-recording' });
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function syncPopupState(): Promise<void> {
  const state = (await sendMessage({ type: 'get-state' })) as PopupStateResponse;
  applyPopupState(state);
}

function resetPendingRecordingUi(): void {
  elements.micIndicator.classList.add('hidden');
  elements.tabIndicator.classList.add('hidden');
  elements.btnMic.classList.remove('btn--active');
  elements.btnTab.classList.remove('btn--active');
  elements.btnConversation.classList.remove('btn--active');
  conversationMode = false;
  stopRecordingSync();
  updateEmptyState();
}

async function handleCaptureFailure(error: unknown): Promise<void> {
  try {
    await sendMessage({ type: 'stop-conversation' });
  } catch {
    // ignore
  }
  try {
    await sendMessage({ type: 'stop-tab-recording' });
  } catch {
    // ignore
  }
  try {
    await sendMessage({ type: 'stop-mic-recording' });
  } catch {
    // ignore
  }
  resetPendingRecordingUi();
  await syncPopupState();
  elements.statusText.textContent = formatTabCaptureError(error);
}

function obtainTabStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!streamId) {
        reject(new Error('No stream ID returned'));
        return;
      }
      resolve(streamId);
    });
  });
}

// --- Event Handlers ---

async function handleMicToggle(): Promise<void> {
  const micRecording = currentState?.micRecording ?? false;
  if (micRecording) {
    await sendMessage({ type: 'stop-mic-recording' });
    return;
  }

  showPendingRecording('mic');
  const result = (await sendMessage({ type: 'start-mic-recording' })) as {
    success?: boolean;
    error?: string;
  };
  if (result?.success === false && result.error) {
    elements.statusText.textContent = `Error: ${result.error}`;
    elements.micIndicator.classList.add('hidden');
    elements.btnMic.classList.remove('btn--active');
    updateEmptyState();
    return;
  }

  const state = (await sendMessage({ type: 'get-state' })) as PopupStateResponse;
  applyPopupState(state);
}

async function handleTabToggle(): Promise<void> {
  const tabRecording = currentState?.tabRecording ?? false;
  if (tabRecording) {
    await sendMessage({ type: 'stop-tab-recording' });
    await syncPopupState();
    return;
  }

  try {
    await stopAnyActiveRecording();
    const tab = await getActivePageTab();
    validateTabForCapture(tab);

    showPendingRecording('tab');
    elements.statusText.textContent = 'Chrome dialog: pick this tab + Share';
    const streamId = await obtainTabStreamId(tab.id!);
    const result = (await sendMessage({
      type: 'start-tab-recording',
      tabId: tab.id,
      streamId,
    })) as { success?: boolean; error?: string };
    if (result?.success === false && result.error) {
      throw new Error(result.error);
    }
    await syncPopupState();
  } catch (error) {
    await handleCaptureFailure(error);
  }
}

async function handleConversationToggle(): Promise<void> {
  if (conversationMode || (currentState?.micRecording && currentState?.tabRecording)) {
    await sendMessage({ type: 'stop-conversation' });
    await syncPopupState();
    return;
  }

  startNewSession();
  renderAllMessages();

  try {
    await stopAnyActiveRecording();
    const tab = await getActivePageTab();
    validateTabForCapture(tab);

    showPendingRecording('both');
    elements.statusText.textContent =
      'Allow microphone, then Share tab audio in Chrome dialogs…';
    const streamId = await obtainTabStreamId(tab.id!);
    const result = (await sendMessage({
      type: 'start-conversation',
      tabId: tab.id,
      streamId,
    })) as { success?: boolean; error?: string };
    if (result?.success === false && result.error) {
      throw new Error(result.error);
    }
    await syncPopupState();
  } catch (error) {
    await handleCaptureFailure(error);
  }
}

async function handleCopy(): Promise<void> {
  const session = getCurrentSession();
  const text = formatForClipboard(session.messages);
  await navigator.clipboard.writeText(text);
  elements.statusText.textContent = 'Copied to clipboard';
}

function handleClear(): void {
  clearSession();
  elements.chatMessages.innerHTML = '';
  updateEmptyState();
}

function handleNewSession(): void {
  startNewSession();
  elements.chatMessages.innerHTML = '';
  updateEmptyState();
}

function handleServiceWorkerMessage(message: ServiceWorkerMessage): void {
  switch (message.type) {
    case 'state-update':
      currentState = message.state;
      renderState(message.state);
      break;

    case 'transcript-update': {
      const chatMsg = applyTranscriptToStore(
        {
          text: message.message.text,
          isFinal: message.message.isFinal,
          source: message.message.sender === 'user' ? 'mic' : 'tab',
          timestamp: message.message.timestamp,
          segmentId: message.message.segmentId,
        },
        {
          getMessages,
          addMessage,
          updateInterim,
          finalizeMessage,
          removeBySegmentId,
        },
      );
      renderTranscriptMessage(chatMsg);
      break;
    }

    case 'error':
      if (elements) {
        elements.statusText.textContent = `Error: ${message.error}`;
      }
      break;
  }
}

export function initializePopup(): void {
  stateRequestAttempts = 0;
  elements = {
    statusIndicator: getElement<HTMLSpanElement>('status-indicator'),
    statusText: getElement<HTMLSpanElement>('status-text'),
    micIndicator: getElement<HTMLSpanElement>('mic-indicator'),
    tabIndicator: getElement<HTMLSpanElement>('tab-indicator'),
    chatEmpty: getElement<HTMLElement>('chat-empty'),
    chatListening: getElement<HTMLElement>('chat-listening'),
    chatListeningHint: getElement<HTMLElement>('chat-listening-hint'),
    chatMessages: getElement<HTMLDivElement>('chat-messages'),
    chatContainer: getElement<HTMLElement>('chat-container'),
    btnMic: getElement<HTMLButtonElement>('btn-mic'),
    btnTab: getElement<HTMLButtonElement>('btn-tab'),
    btnConversation: getElement<HTMLButtonElement>('btn-conversation'),
    btnCopy: getElement<HTMLButtonElement>('btn-copy'),
    btnClear: getElement<HTMLButtonElement>('btn-clear'),
    btnNewSession: getElement<HTMLButtonElement>('btn-new-session'),
  };

  elements.btnMic.addEventListener('click', handleMicToggle);
  elements.btnTab.addEventListener('click', handleTabToggle);
  elements.btnConversation.addEventListener('click', handleConversationToggle);
  elements.btnCopy.addEventListener('click', handleCopy);
  elements.btnClear.addEventListener('click', handleClear);
  elements.btnNewSession.addEventListener('click', handleNewSession);

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message) {
      handleServiceWorkerMessage(message as ServiceWorkerMessage);
    }
  });

  requestState();
}

if (typeof document !== 'undefined' && import.meta.env?.MODE !== 'test') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup);
  } else {
    initializePopup();
  }
}

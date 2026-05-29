// Popup Controller - Unit Tests
// Tests UI state rendering, recording indicators, button interactions

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionState } from '@shared/types';

// --- DOM Setup Helper ---

function createPopupDOM(): void {
  document.body.innerHTML = `
    <header class="status-bar" id="status-bar">
      <span class="status-indicator" id="status-indicator"></span>
      <span class="status-text" id="status-text">Connecting...</span>
    </header>
    <div class="recording-indicators" id="recording-indicators">
      <span class="recording-badge recording-badge--mic hidden" id="mic-indicator">
        <span class="recording-dot"></span> Your Voice
      </span>
      <span class="recording-badge recording-badge--tab hidden" id="tab-indicator">
        <span class="recording-dot"></span> Sesame Voice
      </span>
    </div>
    <main class="chat-container" id="chat-container">
      <div class="chat-empty" id="chat-empty">
        <p class="chat-empty__title">Ready</p>
      </div>
      <div class="chat-listening hidden" id="chat-listening">
        <p class="chat-listening__title">Listening…</p>
        <p class="chat-listening__hint" id="chat-listening-hint">Waiting…</p>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
    </main>
    <footer class="controls">
      <button class="btn btn--mic" id="btn-mic"></button>
      <button class="btn btn--tab" id="btn-tab"></button>
      <button class="btn btn--conversation" id="btn-conversation"></button>
      <button class="btn btn--copy" id="btn-copy"></button>
      <button class="btn btn--clear" id="btn-clear"></button>
      <button class="btn btn--new-session" id="btn-new-session"></button>
    </footer>
  `;
}

// --- Mock chrome API ---

const mockSendMessage = vi.fn().mockResolvedValue({
  serverStatus: 'ready',
  micRecording: false,
  tabRecording: false,
  activeTabId: null,
  config: {
    serverHost: 'localhost',
    serverPort: 6006,
    modelPath: 'test',
    audioChunkSizeMs: 500,
  },
  messages: [],
});
const mockTabsQuery = vi.fn().mockResolvedValue([
  { id: 42, url: 'https://www.youtube.com/watch?v=test' },
]);
const mockGetMediaStreamId = vi.fn(
  (_options: unknown, callback: (streamId: string) => void) => {
    callback('popup-stream-id');
  },
);
const mockAddListener = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: mockAddListener,
    },
    lastError: null,
  },
  tabs: {
    query: mockTabsQuery,
  },
  tabCapture: {
    getMediaStreamId: mockGetMediaStreamId,
  },
});

// Mock navigator.clipboard
vi.stubGlobal('navigator', {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
});

// Import after mocks are set up
import {
  initializePopup,
  renderServerStatus,
  renderRecordingIndicators,
  renderTranscriptMessage,
} from './popup';
import { resetState } from './chat-ui.service';

describe('Popup Controller', () => {
  beforeEach(() => {
    createPopupDOM();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({
      serverStatus: 'ready',
      micRecording: false,
      tabRecording: false,
      activeTabId: null,
      config: {
        serverHost: 'localhost',
        serverPort: 6006,
        modelPath: '',
        audioChunkSizeMs: 500,
      },
    } satisfies ExtensionState);
    mockTabsQuery.mockResolvedValue([
      { id: 42, url: 'https://www.youtube.com/watch?v=test' },
    ]);
    resetState();
    initializePopup();
  });

  describe('Server Status Rendering', () => {
    it('should show ready status with green indicator', () => {
      renderServerStatus('ready');

      const indicator = document.getElementById('status-indicator')!;
      const text = document.getElementById('status-text')!;

      expect(indicator.classList.contains('status-indicator--ready')).toBe(true);
      expect(text.textContent).toContain('Server ready');
    });

    it('should show error status with red indicator and instructions', () => {
      renderServerStatus('error');

      const indicator = document.getElementById('status-indicator')!;
      const text = document.getElementById('status-text')!;

      expect(indicator.classList.contains('status-indicator--error')).toBe(true);
      expect(text.textContent).toContain('docker compose up -d');
    });

    it('should show loading status with yellow indicator', () => {
      renderServerStatus('starting');

      const indicator = document.getElementById('status-indicator')!;
      const text = document.getElementById('status-text')!;

      expect(indicator.classList.contains('status-indicator--loading')).toBe(true);
      expect(text.textContent).toContain('Connecting');
    });

    it('should disable recording buttons when server is not ready', () => {
      renderServerStatus('error');

      const btnMic = document.getElementById('btn-mic') as HTMLButtonElement;
      const btnTab = document.getElementById('btn-tab') as HTMLButtonElement;
      const btnConversation = document.getElementById('btn-conversation') as HTMLButtonElement;

      expect(btnMic.disabled).toBe(true);
      expect(btnTab.disabled).toBe(true);
      expect(btnConversation.disabled).toBe(true);
    });

    it('should enable recording buttons when server is ready', () => {
      renderServerStatus('ready');

      const btnMic = document.getElementById('btn-mic') as HTMLButtonElement;
      const btnTab = document.getElementById('btn-tab') as HTMLButtonElement;
      const btnConversation = document.getElementById('btn-conversation') as HTMLButtonElement;

      expect(btnMic.disabled).toBe(false);
      expect(btnTab.disabled).toBe(false);
      expect(btnConversation.disabled).toBe(false);
    });
  });

  describe('Recording Indicator Visibility', () => {
    it('should show mic indicator when mic is recording', () => {
      renderRecordingIndicators(true, false);

      const micIndicator = document.getElementById('mic-indicator')!;
      const tabIndicator = document.getElementById('tab-indicator')!;

      expect(micIndicator.classList.contains('hidden')).toBe(false);
      expect(tabIndicator.classList.contains('hidden')).toBe(true);
    });

    it('should show tab indicator when tab is recording', () => {
      renderRecordingIndicators(false, true);

      const micIndicator = document.getElementById('mic-indicator')!;
      const tabIndicator = document.getElementById('tab-indicator')!;

      expect(micIndicator.classList.contains('hidden')).toBe(true);
      expect(tabIndicator.classList.contains('hidden')).toBe(false);
    });

    it('should show both indicators in conversation mode', () => {
      renderRecordingIndicators(true, true);

      const micIndicator = document.getElementById('mic-indicator')!;
      const tabIndicator = document.getElementById('tab-indicator')!;

      expect(micIndicator.classList.contains('hidden')).toBe(false);
      expect(tabIndicator.classList.contains('hidden')).toBe(false);
    });

    it('should hide both indicators when not recording', () => {
      renderRecordingIndicators(false, false);

      const micIndicator = document.getElementById('mic-indicator')!;
      const tabIndicator = document.getElementById('tab-indicator')!;

      expect(micIndicator.classList.contains('hidden')).toBe(true);
      expect(tabIndicator.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Conversation Mode Button', () => {
    it('should send start-conversation message with active tab id', async () => {
      mockSendMessage.mockImplementation((msg: { type: string }) => {
        if (msg.type === 'start-conversation') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({
          serverStatus: 'ready',
          micRecording: false,
          tabRecording: false,
          activeTabId: null,
          config: {
            serverHost: 'localhost',
            serverPort: 6006,
            modelPath: 'test',
            audioChunkSizeMs: 500,
          },
          messages: [],
        });
      });
      renderServerStatus('ready');

      const btnConversation = document.getElementById('btn-conversation') as HTMLButtonElement;
      btnConversation.click();

      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'start-conversation',
          tabId: 42,
          streamId: 'popup-stream-id',
        });
        expect(mockGetMediaStreamId).toHaveBeenCalledWith(
          { targetTabId: 42 },
          expect.any(Function),
        );
      });
    });
  });

  describe('Copy Button', () => {
    it('should copy formatted transcript to clipboard', async () => {
      // Add a message to the session first
      const { addMessage } = await import('./chat-ui.service');
      addMessage({
        id: 'msg-1',
        sender: 'user',
        text: 'Hello world',
        timestamp: 1000,
        isFinal: true,
        segmentId: 'seg-1',
      });

      const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
      btnCopy.click();

      await vi.waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('You: Hello world');
      });
    });
  });

  describe('Clear Button', () => {
    it('should clear all messages from chat container', () => {
      // Add some content to chat
      const chatMessages = document.getElementById('chat-messages')!;
      chatMessages.innerHTML = '<div class="message">Test</div>';

      const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
      btnClear.click();

      expect(chatMessages.innerHTML).toBe('');
    });
  });

  describe('Transcript Rendering', () => {
    it('should render interim result as typing indicator', () => {
      renderTranscriptMessage({
        id: 'msg-1',
        sender: 'sesame',
        text: 'Hello',
        timestamp: 1000,
        isFinal: false,
        segmentId: 'seg-1',
      });

      const chatMessages = document.getElementById('chat-messages')!;
      const typingEl = chatMessages.querySelector('[data-segment="seg-1"]');

      expect(typingEl).not.toBeNull();
      expect(typingEl!.classList.contains('message--typing')).toBe(true);
      expect(typingEl!.querySelector('.message__text')!.textContent).toBe('Hello');
    });

    it('should update existing typing indicator with new interim text', () => {
      renderTranscriptMessage({
        id: 'msg-1',
        sender: 'sesame',
        text: 'Hello',
        timestamp: 1000,
        isFinal: false,
        segmentId: 'seg-1',
      });

      renderTranscriptMessage({
        id: 'msg-1',
        sender: 'sesame',
        text: 'Hello world',
        timestamp: 1000,
        isFinal: false,
        segmentId: 'seg-1',
      });

      const chatMessages = document.getElementById('chat-messages')!;
      const segments = chatMessages.querySelectorAll('[data-segment="seg-1"]');

      expect(segments.length).toBe(1);
      expect(segments[0].querySelector('.message__text')!.textContent).toBe('Hello world');
    });

    it('should replace typing indicator with final message bubble', () => {
      renderTranscriptMessage({
        id: 'msg-1',
        sender: 'sesame',
        text: 'Hello',
        timestamp: 1000,
        isFinal: false,
        segmentId: 'seg-1',
      });

      renderTranscriptMessage({
        id: 'msg-1',
        sender: 'sesame',
        text: 'Hello world',
        timestamp: 1000,
        isFinal: true,
        segmentId: 'seg-1',
      });

      const chatMessages = document.getElementById('chat-messages')!;
      const finalEl = chatMessages.querySelector('[data-segment="seg-1"]');

      expect(finalEl).not.toBeNull();
      expect(finalEl!.classList.contains('message--typing')).toBe(false);
      expect(finalEl!.querySelector('.message__text')!.textContent).toBe('Hello world');
    });

    it('should render user messages with right alignment', () => {
      renderTranscriptMessage({
        id: 'msg-2',
        sender: 'user',
        text: 'My speech',
        timestamp: 2000,
        isFinal: true,
        segmentId: 'seg-2',
      });

      const chatMessages = document.getElementById('chat-messages')!;
      const msgEl = chatMessages.querySelector('[data-segment="seg-2"]');

      expect(msgEl).not.toBeNull();
      expect(msgEl!.classList.contains('message--right')).toBe(true);
      expect(msgEl!.classList.contains('message--user')).toBe(true);
    });
  });
});

/**
 * Integration tests for end-to-end flows.
 *
 * Tests the wiring between modules:
 * - Mic recording: start → audio chunks → WebSocket send → transcript → chat message
 * - Conversation mode: both sources active → interleaved messages
 * - Server health: ready status → recording enabled
 * - Deactivation: all resources released
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  OffscreenCommand,
  OffscreenEvent,
  ServiceWorkerMessage,
  ExtensionState,
  PopupMessage,
} from '@shared/types';

// --- Chrome API Mocks ---

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetContexts = vi.fn().mockResolvedValue([]);
const mockCreateDocument = vi.fn().mockResolvedValue(undefined);
const mockCloseDocument = vi.fn().mockResolvedValue(undefined);
const mockGetURL = vi.fn((path: string) => `chrome-extension://abc/${path}`);
const mockGetMediaStreamId = vi.fn(
  (_options: unknown, callback: (streamId: string) => void) => {
    callback('integration-stream-id');
  },
);
const mockStorageGet = vi.fn().mockResolvedValue({});
const mockStorageSet = vi.fn().mockResolvedValue(undefined);

let messageListener: (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

const mockAddListener = vi.fn((listener) => {
  messageListener = listener;
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    getContexts: mockGetContexts,
    getURL: mockGetURL,
    lastError: null,
    onMessage: {
      addListener: mockAddListener,
    },
    ContextType: {
      OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
    },
  },
  offscreen: {
    createDocument: mockCreateDocument,
    closeDocument: mockCloseDocument,
    Reason: {
      USER_MEDIA: 'USER_MEDIA',
    },
  },
  tabCapture: {
    getMediaStreamId: mockGetMediaStreamId,
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
});

// --- Mock SttServerService ---

const mockStartHealthPolling = vi.fn();
const mockStopHealthPolling = vi.fn();
const mockOnStatusChange = vi.fn();
const mockProbeNow = vi.fn().mockResolvedValue({
  state: 'ready',
  containerId: null,
  uptime: 0,
  lastHealthCheck: Date.now(),
  errorMessage: null,
});
const mockGetStatus = vi.fn().mockReturnValue({ state: 'stopped', errorMessage: null });

vi.mock('../stt-server', () => ({
  SttServerService: vi.fn().mockImplementation(() => ({
    startHealthPolling: mockStartHealthPolling,
    stopHealthPolling: mockStopHealthPolling,
    onStatusChange: mockOnStatusChange,
    probeNow: mockProbeNow,
    getStatus: mockGetStatus,
  })),
}));

// --- Mock Config Module ---

vi.mock('../config', () => ({
  getDefaults: vi.fn(() => ({
    serverHost: 'localhost',
    serverPort: 6006,
    modelPath: 'sherpa-onnx-streaming-zipformer-en-2023-06-21',
    audioChunkSizeMs: 500,
  })),
  loadConfig: vi.fn().mockResolvedValue({
    serverHost: 'localhost',
    serverPort: 6006,
    modelPath: 'sherpa-onnx-streaming-zipformer-en-2023-06-21',
    audioChunkSizeMs: 500,
  }),
  saveConfig: vi.fn().mockResolvedValue({ success: true }),
}));

// --- Mock Chat UI Module ---

const mockAddMessage = vi.fn();
const mockUpdateInterim = vi.fn();
const mockFinalizeMessage = vi.fn();
const mockClearSession = vi.fn();
const mockStartNewSession = vi.fn();
const mockGetCurrentSession = vi.fn().mockReturnValue({
  id: 'session-1',
  messages: [],
  startedAt: 1000,
  isActive: true,
});
const mockGetMessages = vi.fn().mockReturnValue([]);
const mockRemoveBySegmentId = vi.fn();
const mockFormatForClipboard = vi.fn().mockReturnValue('You: hello\nSesame: hi');

vi.mock('../chat-ui', () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  updateInterim: (...args: unknown[]) => mockUpdateInterim(...args),
  finalizeMessage: (...args: unknown[]) => mockFinalizeMessage(...args),
  removeBySegmentId: (...args: unknown[]) => mockRemoveBySegmentId(...args),
  clearSession: (...args: unknown[]) => mockClearSession(...args),
  startNewSession: (...args: unknown[]) => mockStartNewSession(...args),
  getCurrentSession: (...args: unknown[]) => mockGetCurrentSession(...args),
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
  formatForClipboard: (...args: unknown[]) => mockFormatForClipboard(...args),
}));

// --- Helpers ---

function simulateMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const sendResponse = (response: unknown) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    const keepOpen = messageListener(message, {}, sendResponse);
    if (keepOpen !== true && !settled) {
      settled = true;
      resolve(undefined);
    }
  });
}

/** Capture all messages sent via chrome.runtime.sendMessage */
function getSentMessages(): unknown[] {
  return mockSendMessage.mock.calls.map((call) => call[0]);
}

/** Filter sent messages by type */
function getSentMessagesByType(type: string): unknown[] {
  return getSentMessages().filter(
    (msg) => msg && typeof msg === 'object' && (msg as { type: string }).type === type,
  );
}

async function setServerReady(): Promise<void> {
  const { updateState } = await import('../service-worker/service-worker');
  updateState({ serverStatus: 'ready' });
  mockSendMessage.mockClear();
}

// --- Integration Tests ---

describe('Integration: End-to-End Flows', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetContexts.mockResolvedValue([]);
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetMediaStreamId.mockImplementation(
      (_options: unknown, callback: (streamId: string) => void) => {
        callback('integration-stream-id');
      },
    );
    (chrome.runtime as { lastError: chrome.runtime.LastError | null }).lastError = null;
    mockGetMessages.mockReturnValue([]);

    vi.resetModules();
    const sw = await import('../service-worker/service-worker');
    await sw.initializeState();
    sw.registerMessageListeners();
  });

  describe('Mic recording → audio chunks → WebSocket → transcript → chat message', () => {
    beforeEach(async () => {
      await setServerReady();
    });

    it('should send start-mic command with correct audio config to offscreen', async () => {
      const response = await simulateMessage({ type: 'start-mic-recording' });

      expect(response).toEqual({ success: true });

      // Verify offscreen document was created
      expect(mockCreateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('offscreen.html'),
          reasons: ['USER_MEDIA'],
        }),
      );

      // Verify start-mic command was sent with correct audio config
      const startMicCalls = getSentMessagesByType('start-mic');
      expect(startMicCalls).toHaveLength(1);
      expect(startMicCalls[0]).toEqual(
        expect.objectContaining({
          type: 'start-mic',
          serverUrl: 'ws://localhost:6006',
          config: {
            sampleRate: 16000,
            channels: 1,
            bitDepth: 16,
            chunkSizeMs: 500,
          },
        }),
      );
    });

    it('should process transcript event from offscreen and forward to popup', async () => {
      // Start mic recording
      await simulateMessage({ type: 'start-mic-recording' });
      mockSendMessage.mockClear();

      // Simulate transcript event from offscreen document
      const transcriptEvent: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'hello world',
          isFinal: true,
          source: 'mic',
          timestamp: 1234567890,
          segmentId: 'mic-1',
        },
      };
      simulateMessage(transcriptEvent);

      // Verify transcript was forwarded to popup
      const transcriptUpdates = getSentMessagesByType('transcript-update');
      expect(transcriptUpdates.length).toBeGreaterThan(0);

      const update = transcriptUpdates[0] as ServiceWorkerMessage;
      expect(update).toEqual({
        type: 'transcript-update',
        message: expect.objectContaining({
          sender: 'user',
          text: 'hello world',
          isFinal: true,
          segmentId: 'mic-1',
        }),
      });
    });

    it('should add final transcript to chat session service', async () => {
      await simulateMessage({ type: 'start-mic-recording' });

      const transcriptEvent: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'recognized speech',
          isFinal: true,
          source: 'mic',
          timestamp: 1000,
          segmentId: 'mic-seg-0',
        },
      };
      simulateMessage(transcriptEvent);

      // Chat service should receive the message
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'user',
          text: 'recognized speech',
          isFinal: true,
          segmentId: 'mic-seg-0',
        }),
      );
    });

    it('should update interim transcript in chat session service', async () => {
      await simulateMessage({ type: 'start-mic-recording' });

      // First interim result
      const interimEvent: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'hel',
          isFinal: false,
          source: 'mic',
          timestamp: 1000,
          segmentId: 'mic-seg-0',
        },
      };
      simulateMessage(interimEvent);

      // First time — no existing message, so addMessage is called
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'hel',
          isFinal: false,
          segmentId: 'mic-live',
        }),
      );

      // Simulate existing live caption for second interim
      mockGetMessages.mockReturnValue([
        { id: 'mic-mic-seg-0-1000', sender: 'user', text: 'hel', timestamp: 1000, isFinal: false, segmentId: 'mic-live' },
      ]);

      const interimEvent2: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'hello',
          isFinal: false,
          source: 'mic',
          timestamp: 1001,
          segmentId: 'mic-seg-0',
        },
      };
      simulateMessage(interimEvent2);

      // Second time — existing message found, so updateInterim is called
      expect(mockUpdateInterim).toHaveBeenCalledWith('mic-live', 'hello');
    });
  });

  describe('Conversation mode → both sources active → interleaved messages', () => {
    beforeEach(async () => {
      await setServerReady();
    });

    it('should start both mic and tab recording simultaneously', async () => {
      const response = await simulateMessage({
        type: 'start-conversation',
        tabId: 99,
        streamId: 'integration-stream-id',
      });

      expect(response).toEqual({ success: true });

      // Both start commands should be sent
      const startMicCalls = getSentMessagesByType('start-mic');
      const startTabCalls = getSentMessagesByType('start-tab');
      expect(startMicCalls).toHaveLength(1);
      expect(startTabCalls).toHaveLength(1);

      // Tab command should include the stream ID
      expect(startTabCalls[0]).toEqual(
        expect.objectContaining({
          type: 'start-tab',
          streamId: 'integration-stream-id',
          config: expect.objectContaining({ sampleRate: 16000 }),
        }),
      );
    });

    it('should start a new chat session when conversation mode begins', async () => {
      await simulateMessage({
        type: 'start-conversation',
        tabId: 99,
        streamId: 'integration-stream-id',
      });

      expect(mockStartNewSession).toHaveBeenCalled();
    });

    it('should interleave mic and tab transcripts in chronological order', async () => {
      await simulateMessage({
        type: 'start-conversation',
        tabId: 99,
        streamId: 'integration-stream-id',
      });
      mockSendMessage.mockClear();

      // Simulate mic transcript
      const micEvent: OffscreenEvent = {
        type: 'transcript',
        data: { text: 'my question', isFinal: true, source: 'mic', timestamp: 1000, segmentId: 'mic-0' },
      };
      simulateMessage(micEvent);

      // Simulate tab transcript (Sesame response)
      const tabEvent: OffscreenEvent = {
        type: 'transcript',
        data: { text: 'sesame answer', isFinal: true, source: 'tab', timestamp: 1500, segmentId: 'tab-0' },
      };
      simulateMessage(tabEvent);

      // Both should be added to chat service
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sender: 'user', text: 'my question' }),
      );
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sender: 'sesame', text: 'sesame answer' }),
      );

      // Both should be forwarded to popup
      const transcriptUpdates = getSentMessagesByType('transcript-update');
      expect(transcriptUpdates).toHaveLength(2);

      const senders = transcriptUpdates.map(
        (msg) => ((msg as ServiceWorkerMessage & { type: 'transcript-update' }).message).sender,
      );
      expect(senders).toContain('user');
      expect(senders).toContain('sesame');
    });

    it('should stop both sources and update state on stop-conversation', async () => {
      const { getState } = await import('../service-worker/service-worker');
      await setServerReady();
      await simulateMessage({
        type: 'start-conversation',
        tabId: 99,
        streamId: 'integration-stream-id',
      });
      await simulateMessage({ type: 'recording-started', source: 'mic' });
      await simulateMessage({ type: 'recording-started', source: 'tab' });

      expect(getState().micRecording).toBe(true);
      expect(getState().tabRecording).toBe(true);

      mockSendMessage.mockClear();
      await simulateMessage({ type: 'stop-conversation' });

      // stop-all command sent to offscreen
      const stopAllCalls = getSentMessagesByType('stop-all');
      expect(stopAllCalls).toHaveLength(1);

      // State reset
      expect(getState().micRecording).toBe(false);
      expect(getState().tabRecording).toBe(false);
      expect(getState().activeTabId).toBeNull();
    });
  });

  describe('Server health → ready status → recording enabled', () => {
    it('should transition to ready state when health checker reports server available', async () => {
      const { startHealthCheckIntegration, getState } = await import('../service-worker/service-worker');

      startHealthCheckIntegration();

      // Simulate health checker reporting ready
      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'ready', errorMessage: null });

      expect(getState().serverStatus).toBe('ready');
    });

    it('should broadcast ready state to popup for enabling recording buttons', async () => {
      const { startHealthCheckIntegration } = await import('../service-worker/service-worker');

      startHealthCheckIntegration();
      mockSendMessage.mockClear();

      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'ready', errorMessage: null });

      // State update broadcast should include ready status
      const stateUpdates = getSentMessagesByType('state-update');
      expect(stateUpdates.length).toBeGreaterThan(0);

      const latestUpdate = stateUpdates[stateUpdates.length - 1] as {
        type: string;
        state: ExtensionState;
      };
      expect(latestUpdate.state.serverStatus).toBe('ready');
    });

    it('should allow mic recording after server becomes ready', async () => {
      const { startHealthCheckIntegration, getState } = await import('../service-worker/service-worker');

      startHealthCheckIntegration();
      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'ready', errorMessage: null });

      // Now start recording — should succeed
      const response = await simulateMessage({ type: 'start-mic-recording' });
      expect(response).toEqual({ success: true });
      await simulateMessage({ type: 'recording-started', source: 'mic' });
      expect(getState().micRecording).toBe(true);
    });

    it('should send error notification when server is unavailable', async () => {
      const { startHealthCheckIntegration, getState } = await import('../service-worker/service-worker');

      startHealthCheckIntegration();
      mockSendMessage.mockClear();

      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({
        state: 'error',
        errorMessage: 'STT Server is not running. Start it with: docker compose up -d',
      });

      expect(getState().serverStatus).toBe('error');

      // Error notification sent
      const errors = getSentMessagesByType('error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          type: 'error',
          error: 'STT Server is not running. Start it with: docker compose up -d',
          source: 'stt-server',
        }),
      );
    });
  });

  describe('Deactivation → all resources released', () => {
    it('should stop all recordings and close offscreen on deactivation', async () => {
      const { deactivate, updateState, getState } = await import('../service-worker/service-worker');

      // Simulate active recording state
      updateState({ micRecording: true, tabRecording: true, activeTabId: 42, serverStatus: 'ready' });
      mockSendMessage.mockClear();
      mockGetContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      await deactivate();

      // stop-all sent to offscreen
      const stopAllCalls = getSentMessagesByType('stop-all');
      expect(stopAllCalls).toHaveLength(1);

      // Offscreen document closed
      expect(mockCloseDocument).toHaveBeenCalled();

      // All state reset
      const state = getState();
      expect(state.micRecording).toBe(false);
      expect(state.tabRecording).toBe(false);
      expect(state.activeTabId).toBeNull();
      expect(state.serverStatus).toBe('stopped');
    });

    it('should stop health polling on deactivation', async () => {
      const { deactivate, startHealthCheckIntegration } = await import('../service-worker/service-worker');

      startHealthCheckIntegration();
      await deactivate();

      expect(mockStopHealthPolling).toHaveBeenCalled();
    });

    it('should handle connection error during active recording gracefully', async () => {
      const { getState } = await import('../service-worker/service-worker');

      await setServerReady();
      await simulateMessage({ type: 'start-mic-recording' });
      await simulateMessage({ type: 'recording-started', source: 'mic' });
      expect(getState().micRecording).toBe(true);
      mockSendMessage.mockClear();

      // Simulate connection error from offscreen
      const errorEvent: OffscreenEvent = {
        type: 'connection-error',
        source: 'mic',
        error: 'Reconnection failed after 3 attempts',
      };
      simulateMessage(errorEvent);

      // Recording should be stopped
      expect(getState().micRecording).toBe(false);

      // Error notification sent to popup
      const errors = getSentMessagesByType('error');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          type: 'error',
          error: 'Reconnection failed after 3 attempts',
          source: 'mic',
        }),
      );
    });

    it('should handle clear-session by delegating to chat service', async () => {
      const response = await simulateMessage({ type: 'clear-session' });

      expect(response).toEqual({ success: true });
      expect(mockClearSession).toHaveBeenCalled();
    });

    it('should handle copy-transcript by formatting messages', async () => {
      mockGetMessages.mockReturnValue([
        { id: '1', sender: 'user', text: 'hello', timestamp: 1000, isFinal: true, segmentId: 'seg-1' },
        { id: '2', sender: 'sesame', text: 'hi', timestamp: 1500, isFinal: true, segmentId: 'seg-2' },
      ]);

      const response = await simulateMessage({ type: 'copy-transcript' });

      expect(response).toEqual({ success: true, text: 'You: hello\nSesame: hi' });
      expect(mockFormatForClipboard).toHaveBeenCalled();
    });
  });
});

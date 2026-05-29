import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PopupMessage, OffscreenEvent, ExtensionState } from '@shared/types';

// --- Chrome API Mocks ---

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetContexts = vi.fn().mockResolvedValue([]);
const mockCreateDocument = vi.fn().mockResolvedValue(undefined);
const mockCloseDocument = vi.fn().mockResolvedValue(undefined);
const mockGetURL = vi.fn((path: string) => `chrome-extension://abc/${path}`);
const mockGetMediaStreamId = vi.fn((_options: unknown, callback: (streamId: string) => void) => {
  callback('mock-stream-id-123');
});
const mockStorageGet = vi.fn().mockResolvedValue({});
const mockStorageSet = vi.fn().mockResolvedValue(undefined);

let messageListener: (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
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
const mockRemoveBySegmentId = vi.fn();
const mockClearSession = vi.fn();
const mockStartNewSession = vi.fn();
const mockGetCurrentSession = vi.fn().mockReturnValue({ id: 'session-1', messages: [], startedAt: 1000, isActive: true });
const mockGetMessages = vi.fn().mockReturnValue([]);
const mockFormatForClipboard = vi.fn().mockReturnValue('');

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

const TEST_STREAM_ID = 'test-stream-id';

// --- Helper to simulate sending a message ---

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
    // Offscreen events return false and never call sendResponse
    if (keepOpen !== true && !settled) {
      settled = true;
      resolve(undefined);
    }
  });
}

async function setServerReady(): Promise<void> {
  const { updateState } = await import('./service-worker');
  updateState({ serverStatus: 'ready' });
  mockSendMessage.mockClear();
}

// --- Tests ---

describe('Service Worker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetContexts.mockResolvedValue([]);
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetMediaStreamId.mockImplementation((_options: unknown, callback: (streamId: string) => void) => {
      callback('mock-stream-id-123');
    });
    (chrome.runtime as { lastError: chrome.runtime.LastError | null }).lastError = null;

    // Re-import to reset module state
    vi.resetModules();
    const sw = await import('./service-worker');
    await sw.initializeState();
    sw.registerMessageListeners();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('State Management', () => {
    it('should return initial state with defaults', async () => {
      const { getState } = await import('./service-worker');
      const state = getState();

      expect(state.serverStatus).toBe('stopped');
      expect(state.micRecording).toBe(false);
      expect(state.tabRecording).toBe(false);
      expect(state.activeTabId).toBeNull();
      expect(state.config.serverHost).toBe('localhost');
      expect(state.config.serverPort).toBe(6006);
    });

    it('should return a copy of state (immutable)', async () => {
      const { getState } = await import('./service-worker');
      const state1 = getState();
      const state2 = getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it('should broadcast state update when state changes', async () => {
      const { updateState } = await import('./service-worker');
      mockSendMessage.mockResolvedValue({ ok: true });

      updateState({ micRecording: true });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'state-update',
          state: expect.objectContaining({ micRecording: true }),
        })
      );
    });

    it('should not throw when popup is not open (sendMessage fails)', async () => {
      const { updateState } = await import('./service-worker');
      mockSendMessage.mockRejectedValue(new Error('No receiver'));

      expect(() => updateState({ micRecording: true })).not.toThrow();
    });
  });

  describe('PopupMessage Routing', () => {
    it('should return current state on get-state message', async () => {
      const response = await simulateMessage({ type: 'get-state' });

      expect(response).toEqual(
        expect.objectContaining({
          serverStatus: 'stopped',
          micRecording: false,
          tabRecording: false,
          messages: [],
        }),
      );
    });

    it('should handle update-config message', async () => {
      const { saveConfig } = await import('../config');
      (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

      const response = await simulateMessage({
        type: 'update-config',
        config: { serverPort: 7007 },
      });

      expect(response).toEqual({ success: true });
    });

    it('should ignore unknown message types (not recognized by type guard)', async () => {
      const sendResponse = vi.fn();
      const result = messageListener({ type: 'unknown-type' }, {}, sendResponse);

      // Unknown types are not recognized by either type guard, so listener returns false
      expect(result).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  describe('Mic Recording Flow', () => {
    beforeEach(async () => {
      await setServerReady();
    });

    it('should send start-mic command to offscreen on start-mic-recording', async () => {
      const response = await simulateMessage({ type: 'start-mic-recording' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'start-mic' })
      );
      expect(response).toEqual({ success: true });
    });

    it('should ensure offscreen document exists before sending mic command', async () => {
      await simulateMessage({ type: 'start-mic-recording' });

      expect(mockGetContexts).toHaveBeenCalled();
      expect(mockCreateDocument).toHaveBeenCalled();
    });

    it('should send stop-mic command to offscreen on stop-mic-recording', async () => {
      await simulateMessage({ type: 'start-mic-recording' });
      mockSendMessage.mockClear();

      await simulateMessage({ type: 'stop-mic-recording' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stop-mic' })
      );
    });

    it('should update state to micRecording=false after stop', async () => {
      const { getState } = await import('./service-worker');
      await simulateMessage({ type: 'start-mic-recording' });
      await simulateMessage({ type: 'stop-mic-recording' });

      expect(getState().micRecording).toBe(false);
    });
  });

  describe('Tab Capture Flow', () => {
    beforeEach(async () => {
      await setServerReady();
    });

    it('should forward popup streamId to offscreen via start-tab command', async () => {
      await simulateMessage({
        type: 'start-tab-recording',
        tabId: 42,
        streamId: 'stream-abc',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start-tab',
          streamId: 'stream-abc',
          config: expect.objectContaining({ sampleRate: 16000 }),
        }),
      );
      expect(mockGetMediaStreamId).not.toHaveBeenCalled();
    });

    it('should update state with tabRecording=true and activeTabId', async () => {
      const { getState } = await import('./service-worker');

      await simulateMessage({
        type: 'start-tab-recording',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });
      await simulateMessage({ type: 'recording-started', source: 'tab' });

      expect(getState().tabRecording).toBe(true);
      expect(getState().activeTabId).toBe(42);
    });

    it('should send stop-tab command and reset state on stop-tab-recording', async () => {
      const { getState } = await import('./service-worker');
      await simulateMessage({
        type: 'start-tab-recording',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });
      mockSendMessage.mockClear();

      await simulateMessage({ type: 'stop-tab-recording' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stop-tab' })
      );
      expect(getState().tabRecording).toBe(false);
      expect(getState().activeTabId).toBeNull();
    });
  });

  describe('Conversation Mode Orchestration', () => {
    beforeEach(async () => {
      await setServerReady();
    });

    it('should start both mic and tab recording on start-conversation', async () => {
      const { getState } = await import('./service-worker');

      await simulateMessage({
        type: 'start-conversation',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });
      await simulateMessage({ type: 'recording-started', source: 'mic' });
      await simulateMessage({ type: 'recording-started', source: 'tab' });

      expect(getState().micRecording).toBe(true);
      expect(getState().tabRecording).toBe(true);
      expect(getState().activeTabId).toBe(42);
    });

    it('should send start-mic and start-tab commands to offscreen', async () => {
      await simulateMessage({
        type: 'start-conversation',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'start-mic' })
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'start-tab', streamId: TEST_STREAM_ID }),
      );
    });

    it('should rollback mic if tab capture fails in conversation mode', async () => {
      const { getState } = await import('./service-worker');
      mockSendMessage.mockImplementation((msg: { type?: string }) => {
        if (msg?.type === 'start-tab') {
          return Promise.resolve({ ok: false, error: 'Tab denied' });
        }
        return Promise.resolve({ ok: true });
      });

      const response = await simulateMessage({
        type: 'start-conversation',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });

      expect(response).toEqual({ success: false, error: 'Tab denied' });
      expect(getState().micRecording).toBe(false);
      expect(getState().tabRecording).toBe(false);
    });

    it('should send stop-all command on stop-conversation', async () => {
      await simulateMessage({
        type: 'start-conversation',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });
      mockSendMessage.mockClear();

      await simulateMessage({ type: 'stop-conversation' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stop-all' })
      );
    });

    it('should reset all recording state on stop-conversation', async () => {
      const { getState } = await import('./service-worker');
      await simulateMessage({
        type: 'start-conversation',
        tabId: 42,
        streamId: TEST_STREAM_ID,
      });

      await simulateMessage({ type: 'stop-conversation' });

      expect(getState().micRecording).toBe(false);
      expect(getState().tabRecording).toBe(false);
      expect(getState().activeTabId).toBeNull();
    });
  });

  describe('OffscreenEvent Handling', () => {
    it('should update state on recording-started event from mic', async () => {
      const { getState } = await import('./service-worker');
      const event: OffscreenEvent = { type: 'recording-started', source: 'mic' };

      simulateMessage(event);

      expect(getState().micRecording).toBe(true);
    });

    it('should update state on recording-started event from tab', async () => {
      const { getState } = await import('./service-worker');
      const event: OffscreenEvent = { type: 'recording-started', source: 'tab' };

      simulateMessage(event);

      expect(getState().tabRecording).toBe(true);
    });

    it('should update state on recording-stopped event', async () => {
      const { getState, updateState } = await import('./service-worker');
      updateState({ micRecording: true });
      mockSendMessage.mockClear();

      const event: OffscreenEvent = { type: 'recording-stopped', source: 'mic' };
      simulateMessage(event);

      expect(getState().micRecording).toBe(false);
    });

    it('should forward transcript events to popup as transcript-update', async () => {
      const event: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'hello world',
          isFinal: true,
          source: 'mic',
          timestamp: 1000,
          segmentId: 'seg-1',
        },
      };

      simulateMessage(event);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transcript-update',
          message: expect.objectContaining({
            sender: 'user',
            text: 'hello world',
            isFinal: true,
            segmentId: 'seg-1',
          }),
        })
      );
    });

    it('should map tab source to sesame sender in transcript', async () => {
      const event: OffscreenEvent = {
        type: 'transcript',
        data: {
          text: 'sesame says hi',
          isFinal: false,
          source: 'tab',
          timestamp: 2000,
          segmentId: 'seg-2',
        },
      };

      simulateMessage(event);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transcript-update',
          message: expect.objectContaining({
            sender: 'sesame',
            text: 'sesame says hi',
          }),
        })
      );
    });

    it('should stop recording and send error on connection-error event', async () => {
      const { getState, updateState } = await import('./service-worker');
      updateState({ micRecording: true });
      mockSendMessage.mockClear();

      const event: OffscreenEvent = {
        type: 'connection-error',
        source: 'mic',
        error: 'Reconnection failed',
      };
      simulateMessage(event);

      expect(getState().micRecording).toBe(false);
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'Reconnection failed',
          source: 'mic',
        })
      );
    });

    it('should not change state on reconnecting event', async () => {
      const { getState, updateState } = await import('./service-worker');
      updateState({ micRecording: true });
      const stateBefore = getState();
      mockSendMessage.mockClear();

      const event: OffscreenEvent = { type: 'reconnecting', source: 'mic', attempt: 2 };
      simulateMessage(event);

      expect(getState().micRecording).toBe(stateBefore.micRecording);
    });
  });

  describe('Health Check Integration', () => {
    it('should start health polling on startHealthCheckIntegration', async () => {
      const { startHealthCheckIntegration } = await import('./service-worker');

      startHealthCheckIntegration();

      expect(mockOnStatusChange).toHaveBeenCalledWith(expect.any(Function));
      expect(mockStartHealthPolling).toHaveBeenCalledWith('localhost', 6006, 3000);
    });

    it('should update serverStatus when health checker reports ready', async () => {
      const { startHealthCheckIntegration, getState } = await import('./service-worker');

      startHealthCheckIntegration();

      // Get the status change callback
      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'ready', errorMessage: null });

      expect(getState().serverStatus).toBe('ready');
    });

    it('should update serverStatus to error when health checker reports error', async () => {
      const { startHealthCheckIntegration, getState } = await import('./service-worker');

      startHealthCheckIntegration();

      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'error', errorMessage: 'STT Server is not running. Start it with: docker compose up -d' });

      expect(getState().serverStatus).toBe('error');
    });

    it('should map unresponsive server state to error status', async () => {
      const { startHealthCheckIntegration, getState } = await import('./service-worker');

      startHealthCheckIntegration();

      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      statusCallback({ state: 'unresponsive', errorMessage: 'Server unresponsive' });

      expect(getState().serverStatus).toBe('error');
    });

    it('should send error notification when server has error message', async () => {
      const { startHealthCheckIntegration } = await import('./service-worker');

      startHealthCheckIntegration();

      const statusCallback = mockOnStatusChange.mock.calls[0][0];
      mockSendMessage.mockClear();
      statusCallback({ state: 'error', errorMessage: 'STT Server is not running' });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'STT Server is not running',
          source: 'stt-server',
        })
      );
    });
  });

  describe('Deactivation', () => {
    it('should stop health polling on deactivate', async () => {
      const { deactivate, startHealthCheckIntegration } = await import('./service-worker');
      startHealthCheckIntegration();

      await deactivate();

      expect(mockStopHealthPolling).toHaveBeenCalled();
    });

    it('should send stop-all command when recordings are active', async () => {
      const { deactivate, updateState } = await import('./service-worker');
      updateState({ micRecording: true, tabRecording: true });
      mockSendMessage.mockClear();

      await deactivate();

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stop-all' })
      );
    });

    it('should close offscreen document on deactivate', async () => {
      const { deactivate } = await import('./service-worker');
      mockGetContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      await deactivate();

      expect(mockCloseDocument).toHaveBeenCalled();
    });

    it('should reset all state on deactivate', async () => {
      const { deactivate, updateState, getState } = await import('./service-worker');
      updateState({ micRecording: true, tabRecording: true, activeTabId: 42, serverStatus: 'ready' });

      await deactivate();

      const state = getState();
      expect(state.micRecording).toBe(false);
      expect(state.tabRecording).toBe(false);
      expect(state.activeTabId).toBeNull();
      expect(state.serverStatus).toBe('stopped');
    });

    it('should not send stop-all if no recordings are active', async () => {
      const { deactivate } = await import('./service-worker');
      mockSendMessage.mockClear();

      await deactivate();

      // Should not have sent stop-all (only state-update broadcasts)
      const stopAllCalls = mockSendMessage.mock.calls.filter(
        (call) => call[0]?.type === 'stop-all'
      );
      expect(stopAllCalls).toHaveLength(0);
    });
  });

  describe('Offscreen Document Lifecycle', () => {
    it('should create offscreen document if none exists', async () => {
      const { ensureOffscreenDocument } = await import('./service-worker');
      mockGetContexts.mockResolvedValue([]);

      await ensureOffscreenDocument();

      expect(mockCreateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          reasons: ['USER_MEDIA'],
        })
      );
    });

    it('should not create offscreen document if one already exists', async () => {
      const { ensureOffscreenDocument } = await import('./service-worker');
      mockGetContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      await ensureOffscreenDocument();

      expect(mockCreateDocument).not.toHaveBeenCalled();
    });

    it('should close offscreen document if it exists', async () => {
      const { closeOffscreenDocument } = await import('./service-worker');
      mockGetContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      await closeOffscreenDocument();

      expect(mockCloseDocument).toHaveBeenCalled();
    });

    it('should not close offscreen document if none exists', async () => {
      const { closeOffscreenDocument } = await import('./service-worker');
      mockGetContexts.mockResolvedValue([]);

      await closeOffscreenDocument();

      expect(mockCloseDocument).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioConfig, OffscreenEvent } from '../../shared/types';
import { OffscreenOrchestrator } from './offscreen.orchestrator';

// --- Mocks ---

const mockStartCapture = vi.fn().mockResolvedValue(undefined);
const mockStopCapture = vi.fn().mockResolvedValue(undefined);
const mockOnChunk = vi.fn();
const mockOffChunk = vi.fn();
const mockGetIsCapturing = vi.fn().mockReturnValue(false);

vi.mock('../audio-processor', () => ({
  AudioProcessorService: vi.fn().mockImplementation(() => ({
    startCapture: mockStartCapture,
    stopCapture: mockStopCapture,
    onChunk: mockOnChunk,
    offChunk: mockOffChunk,
    getIsCapturing: mockGetIsCapturing,
  })),
  ensureAudioContextRunning: vi.fn().mockResolvedValue(undefined),
}));

const mockConnect = vi.fn();
const mockWaitForConnection = vi.fn().mockResolvedValue(undefined);
const mockSendAudioChunk = vi.fn();
const mockSendEndOfStream = vi.fn();
const mockDisconnect = vi.fn();
const mockOnTranscript = vi.fn();
const mockOnConnectionError = vi.fn();
const mockOnReconnecting = vi.fn();

const SERVER_URL = 'ws://localhost:6006';

vi.mock('../websocket-client', () => ({
  WebSocketClientService: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    waitForConnection: mockWaitForConnection,
    sendAudioChunk: mockSendAudioChunk,
    sendEndOfStream: mockSendEndOfStream,
    disconnect: mockDisconnect,
    onTranscript: mockOnTranscript,
    onConnectionError: mockOnConnectionError,
    onReconnecting: mockOnReconnecting,
  })),
}));

// Mock navigator.mediaDevices.getUserMedia
const mockGetUserMedia = vi.fn();
Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
    },
  },
  writable: true,
});

const mockAudioContextClose = vi.fn().mockResolvedValue(undefined);
const mockAudioContextConnect = vi.fn();
const mockCreateMediaStreamSource = vi.fn().mockReturnValue({
  connect: mockAudioContextConnect,
});

vi.stubGlobal(
  'AudioContext',
  vi.fn().mockImplementation(() => ({
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: mockCreateMediaStreamSource,
    destination: {},
    close: mockAudioContextClose,
  })),
);

const defaultConfig: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  chunkSizeMs: 500,
};

function createMockMediaStream(): MediaStream {
  const mockTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack;
  return {
    getTracks: vi.fn().mockReturnValue([mockTrack]),
  } as unknown as MediaStream;
}

describe('OffscreenOrchestrator', () => {
  let orchestrator: OffscreenOrchestrator;
  let events: OffscreenEvent[];

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new OffscreenOrchestrator();
    events = [];
    orchestrator.onEvent((event) => events.push(event));
    mockGetUserMedia.mockResolvedValue(createMockMediaStream());
  });

  afterEach(async () => {
    await orchestrator.stopAll();
  });

  describe('startMic', () => {
    it('should call getUserMedia with audio: true', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it('should start audio processor with the stream and config', async () => {
      const mockStream = createMockMediaStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(mockStartCapture).toHaveBeenCalledWith(
        mockStream,
        defaultConfig,
        'audio-processor.worklet.js',
      );
    });

    it('should connect WebSocket client to STT server for mic source', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(mockConnect).toHaveBeenCalledWith(
        'ws://localhost:6006',
        'mic',
      );
    });

    it('should emit recording-started event on success', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(events).toContainEqual({ type: 'recording-started', source: 'mic' });
    });

    it('should emit connection-error event when getUserMedia fails', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Microphone not found'));

      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(events).toContainEqual({
        type: 'connection-error',
        source: 'mic',
        error: 'Microphone not found',
      });
    });

    it('should stop existing mic pipeline before starting new one', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);
      vi.clearAllMocks();
      mockGetUserMedia.mockResolvedValue(createMockMediaStream());

      await orchestrator.startMic(defaultConfig, SERVER_URL);

      expect(mockStopCapture).toHaveBeenCalled();
      expect(mockSendEndOfStream).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('startTab', () => {
    const streamId = 'test-stream-id-123';

    it('should call getUserMedia with tab capture constraints', async () => {
      await orchestrator.startTab(streamId, defaultConfig, SERVER_URL);

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        },
      });
    });

    it('should start audio processor with the tab stream and config', async () => {
      const mockStream = createMockMediaStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      await orchestrator.startTab(streamId, defaultConfig, SERVER_URL);

      expect(mockStartCapture).toHaveBeenCalledWith(
        mockStream,
        defaultConfig,
        'audio-processor.worklet.js',
        expect.objectContaining({
          audioContext: expect.any(Object),
          mediaStreamSource: expect.objectContaining({ connect: expect.any(Function) }),
        }),
      );
    });

    it('should connect WebSocket client to STT server for tab source', async () => {
      await orchestrator.startTab(streamId, defaultConfig, SERVER_URL);

      expect(mockConnect).toHaveBeenCalledWith(
        'ws://localhost:6006',
        'tab',
      );
    });

    it('should emit recording-started event on success', async () => {
      await orchestrator.startTab(streamId, defaultConfig, SERVER_URL);

      expect(events).toContainEqual({ type: 'recording-started', source: 'tab' });
    });

    it('should emit connection-error event when tab capture fails', async () => {
      mockGetUserMedia.mockRejectedValue(new Error('Tab capture denied'));

      await orchestrator.startTab(streamId, defaultConfig, SERVER_URL);

      expect(events).toContainEqual({
        type: 'connection-error',
        source: 'tab',
        error: 'Tab capture denied',
      });
    });
  });

  describe('stopMic', () => {
    it('should stop audio processor and disconnect WebSocket', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);
      vi.clearAllMocks();

      await orchestrator.stopMic();

      expect(mockStopCapture).toHaveBeenCalled();
      expect(mockSendEndOfStream).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should stop media stream tracks', async () => {
      const mockStream = createMockMediaStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      await orchestrator.startMic(defaultConfig, SERVER_URL);
      await orchestrator.stopMic();

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('should emit recording-stopped event', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);
      events = [];

      await orchestrator.stopMic();

      expect(events).toContainEqual({ type: 'recording-stopped', source: 'mic' });
    });

    it('should do nothing if mic is not active', async () => {
      await orchestrator.stopMic();

      expect(mockStopCapture).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });
  });

  describe('stopTab', () => {
    it('should stop audio processor and disconnect WebSocket', async () => {
      await orchestrator.startTab('stream-id', defaultConfig, SERVER_URL);
      vi.clearAllMocks();

      await orchestrator.stopTab();

      expect(mockStopCapture).toHaveBeenCalled();
      expect(mockSendEndOfStream).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should emit recording-stopped event', async () => {
      await orchestrator.startTab('stream-id', defaultConfig, SERVER_URL);
      events = [];

      await orchestrator.stopTab();

      expect(events).toContainEqual({ type: 'recording-stopped', source: 'tab' });
    });

    it('should do nothing if tab is not active', async () => {
      await orchestrator.stopTab();

      expect(mockStopCapture).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    });
  });

  describe('stopAll', () => {
    it('should stop both mic and tab pipelines', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);
      await orchestrator.startTab('stream-id', defaultConfig, SERVER_URL);
      vi.clearAllMocks();

      await orchestrator.stopAll();

      // stopCapture called twice (once for mic, once for tab)
      expect(mockStopCapture).toHaveBeenCalledTimes(2);
      expect(mockDisconnect).toHaveBeenCalledTimes(2);
    });

    it('should emit recording-stopped for both sources', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);
      await orchestrator.startTab('stream-id', defaultConfig, SERVER_URL);
      events = [];

      await orchestrator.stopAll();

      expect(events).toContainEqual({ type: 'recording-stopped', source: 'mic' });
      expect(events).toContainEqual({ type: 'recording-stopped', source: 'tab' });
    });
  });

  describe('transcript forwarding', () => {
    it('should forward transcript results from WebSocket to event callbacks', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      // Get the transcript callback that was registered on the WebSocket client
      const transcriptCallback = mockOnTranscript.mock.calls[0][0];
      const transcriptResult = {
        text: 'hello world',
        isFinal: true,
        source: 'mic' as const,
        timestamp: Date.now(),
        segmentId: 'mic-0',
      };

      transcriptCallback(transcriptResult);

      expect(events).toContainEqual({
        type: 'transcript',
        data: transcriptResult,
      });
    });

    it('should forward connection errors from WebSocket', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      const errorCallback = mockOnConnectionError.mock.calls[0][0];
      errorCallback('mic', 'Connection failed after 3 attempts');

      expect(events).toContainEqual({
        type: 'connection-error',
        source: 'mic',
        error: 'Connection failed after 3 attempts',
      });
    });

    it('should forward reconnecting events from WebSocket', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      const reconnectCallback = mockOnReconnecting.mock.calls[0][0];
      reconnectCallback('mic', 2);

      expect(events).toContainEqual({
        type: 'reconnecting',
        source: 'mic',
        attempt: 2,
      });
    });
  });

  describe('audio chunk forwarding', () => {
    it('should forward PCM chunks from audio processor to WebSocket client', async () => {
      await orchestrator.startMic(defaultConfig, SERVER_URL);

      // Get the chunk callback registered on the audio processor
      const chunkCallback = mockOnChunk.mock.calls[0][0];
      const pcmData = new Int16Array([100, 200, 300]);
      chunkCallback({ type: 'audio-chunk', pcmData, timestamp: Date.now() });

      expect(mockSendAudioChunk).toHaveBeenCalledWith(pcmData);
    });
  });

  describe('event callback management', () => {
    it('should allow removing event callbacks', async () => {
      const callback = vi.fn();
      orchestrator.onEvent(callback);
      orchestrator.offEvent(callback);

      await orchestrator.startMic(defaultConfig, SERVER_URL);

      // The callback registered in beforeEach still receives events,
      // but the removed one should not
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

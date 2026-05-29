# Implementation Plan: STT Zipformer Extension

## Overview

Chrome Extension (Manifest V3) cho Speech-to-Text sử dụng model Zipformer streaming trên localhost. Implementation theo modular architecture: Service Worker orchestrator, Offscreen Document cho audio processing + WebSocket, AudioWorklet cho resampling, Chat UI cho hiển thị transcript, và Docker container cho STT server backend.

## Tasks

- [x] 1. Set up project structure, manifest, and shared types
  - [x] 1.1 Create project directory structure and configuration files
    - Create `src/modules/` directories: `service-worker/`, `offscreen/`, `audio-processor/`, `websocket-client/`, `chat-ui/`, `config/`, `stt-server/`
    - Create `src/shared/` directories: `interfaces/`, `types/`, `utils/`, `constants/`
    - Set up `package.json` with Vitest, fast-check, TypeScript dependencies
    - Create `tsconfig.json` for Chrome Extension environment
    - Create `vitest.config.ts`
    - _Requirements: 7.1_

  - [x] 1.2 Create Chrome Extension manifest.json
    - Define Manifest V3 with permissions: `tabCapture`, `offscreen`, `storage`
    - Configure service worker background script
    - Configure popup action
    - _Requirements: 1.1, 2.1, 3.1_

  - [x] 1.3 Define shared types and interfaces
    - Create `src/shared/types/audio.types.ts` with `AudioSource`, `AudioConfig`, `AudioChunkMessage`
    - Create `src/shared/types/messages.types.ts` with `PopupMessage`, `ServiceWorkerMessage`, `OffscreenCommand`, `OffscreenEvent`
    - Create `src/shared/types/chat.types.ts` with `ChatMessage`, `ChatSession`, `UIState`
    - Create `src/shared/types/server.types.ts` with `ServerConfig`, `ServerStatus`
    - _Requirements: 4.1, 4.2, 5.1, 5.2_

  - [x] 1.4 Create shared error classes
    - Create `src/shared/errors.ts` with abstract `ExtensionError` base class
    - Define `ServerUnavailableError`, `ServerUnresponsiveError`, `ConnectionLostError`, `ReconnectionFailedError`, `MicrophoneNotFoundError`, `TabCaptureError`
    - _Requirements: 1.5, 1.6, 2.5, 3.5, 4.4, 4.5_

- [x] 2. Implement configuration validation module
  - [x] 2.1 Create config validator service
    - Create `src/modules/config/config.validator.ts`
    - Implement `validatePort(value)`: reject non-integer or outside [1, 65535]
    - Implement `validateHost(value)`: reject empty strings
    - Implement `validateAudioChunkSizeMs(value)`: reject outside [100, 2000]
    - Implement `validateModelPath(value)`: reject empty strings
    - Export `validateConfig(partial)` that validates all provided fields
    - _Requirements: 7.2, 7.3_

  - [x] 2.2 Write property test for config validation (Property 7)
    - **Property 7: Configuration validation correctly classifies inputs**
    - Test with arbitrary strings/numbers for port, host, audioChunkSizeMs
    - Verify: port outside [1, 65535] or non-integer → rejected; empty host → rejected; audioChunkSizeMs outside [100, 2000] → rejected; valid values → accepted
    - **Validates: Requirements 7.2**

  - [x] 2.3 Write unit tests for config validator
    - Test specific edge cases: port 0, port 65536, port 6006, empty host, valid host
    - Test audioChunkSizeMs boundaries: 99, 100, 2000, 2001
    - Test model path validation
    - _Requirements: 7.2, 7.3_

  - [x] 2.4 Create config storage service
    - Create `src/modules/config/config.service.ts`
    - Implement `loadConfig()`: read from `chrome.storage.local` with defaults
    - Implement `saveConfig(partial)`: validate then persist
    - Implement `getDefaults()`: return default ExtensionConfig
    - Create `src/modules/config/index.ts` public API
    - _Requirements: 7.1, 7.4_

- [x] 3. Checkpoint - Ensure project structure and config module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement audio processor module (AudioWorklet)
  - [x] 4.1 Create AudioWorklet processor for resampling
    - Create `src/modules/audio-processor/audio-processor.worklet.ts`
    - Implement linear interpolation resampling from source rate (44100/48000) to 16kHz
    - Convert Float32 samples to Int16 PCM
    - Buffer samples until chunk size reached (8000 samples = 500ms at 16kHz)
    - Post `AudioChunkMessage` to main thread when chunk is full
    - _Requirements: 2.2, 3.2_

  - [x] 4.2 Create audio processor service (main thread side)
    - Create `src/modules/audio-processor/audio-processor.service.ts`
    - Implement `startCapture(stream: MediaStream, config: AudioConfig)`: create AudioContext, connect MediaStreamSource → AudioWorkletNode
    - Implement `stopCapture()`: disconnect nodes, close AudioContext
    - Implement `onChunk(callback)`: register handler for PCM chunks from worklet
    - Create `src/modules/audio-processor/index.ts` public API
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

  - [x] 4.3 Write property test for audio resampling (Property 1)
    - **Property 1: Audio resampling preserves duration and produces correct format**
    - Generate arbitrary Float32Arrays at 44100Hz and 48000Hz
    - Verify: output sample count equals `inputSamples * (16000 / sourceSampleRate)` (±1 sample)
    - Verify: all output values within Int16 range [-32768, 32767]
    - **Validates: Requirements 2.2, 3.2**

  - [x] 4.4 Write property test for audio chunking (Property 2)
    - **Property 2: Audio chunking emits at correct boundaries**
    - Generate arbitrary-length Int16Arrays as PCM input
    - Verify: each emitted chunk has exactly 8000 samples
    - Verify: total emitted samples = total input - remainder (< 8000)
    - **Validates: Requirements 4.3**

  - [x] 4.5 Write unit tests for audio processor
    - Test AudioWorklet registration and message passing
    - Test edge case: empty input buffer
    - Test edge case: input exactly 8000 samples
    - Test edge case: input 7999 samples (no chunk emitted)
    - _Requirements: 2.2, 3.2, 4.3_

- [x] 5. Implement WebSocket client module
  - [x] 5.1 Create WebSocket client service
    - Create `src/modules/websocket-client/websocket-client.service.ts`
    - Implement `connect(url: string, source: AudioSource)`: establish WebSocket connection
    - Implement `sendAudioChunk(data: Int16Array)`: send binary frame
    - Implement `sendEndOfStream()`: send text frame "Done"
    - Implement `disconnect()`: close connection gracefully
    - Implement `onTranscript(callback)`: register handler for `TranscriptResult`
    - Parse sherpa-onnx JSON responses, detect segment changes for `isFinal`
    - _Requirements: 4.1, 4.2, 4.6_

  - [x] 5.2 Implement reconnection logic
    - Add auto-reconnect on connection loss: max 3 attempts, 1-second interval
    - Track reconnection state: `disconnected` → `connecting` → `connected` / `reconnecting`
    - After 3 consecutive failures, transition to `failed` state, stop reconnection
    - Emit `connection-error` event on final failure
    - Create `src/modules/websocket-client/index.ts` public API
    - _Requirements: 4.4, 4.5_

  - [x] 5.3 Write property test for WebSocket reconnection (Property 3)
    - **Property 3: WebSocket reconnection respects retry limits**
    - Generate arbitrary sequences of connect/disconnect failure events
    - Verify: at most 3 reconnection attempts per failure sequence
    - Verify: after 3 consecutive failures, state is 'failed' with no further attempts
    - **Validates: Requirements 4.4**

  - [x] 5.4 Write unit tests for WebSocket client
    - Test successful connection and binary frame sending
    - Test JSON response parsing (partial vs final via segment change)
    - Test end-of-stream "Done" signal
    - Test graceful disconnect
    - _Requirements: 4.1, 4.2, 4.6_

- [x] 6. Checkpoint - Ensure audio processor and WebSocket tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement chat UI module (logic layer)
  - [x] 7.1 Create chat session service
    - Create `src/modules/chat-ui/chat-ui.service.ts`
    - Implement `addMessage(message: ChatMessage)`: insert maintaining chronological order by timestamp
    - Implement `updateInterim(segmentId, text)`: update partial transcript for in-progress message
    - Implement `finalizeMessage(segmentId)`: mark message as final
    - Implement `clearSession()`: remove all messages from current session
    - Implement `startNewSession()`: create new ChatSession, preserve previous
    - _Requirements: 5.1, 5.4, 5.5, 5.8, 5.9_

  - [x] 7.2 Create chat message renderer
    - Create `src/modules/chat-ui/chat-ui.renderer.ts`
    - Implement `renderMessage(message: ChatMessage)`: produce HTML with sender label ("You"/"Sesame"), text, formatted timestamp
    - Implement `renderTypingIndicator(segmentId, text)`: show interim result as typing bubble
    - User messages right-aligned, Sesame messages left-aligned with color coding
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 7.3 Create clipboard formatter
    - Create `src/modules/chat-ui/chat-ui.clipboard.ts`
    - Implement `formatForClipboard(messages: ChatMessage[])`: produce text in format "You: ...\nSesame: ..." in chronological order
    - Implement `copyToClipboard(session: ChatSession)`: write formatted text to system clipboard
    - Create `src/modules/chat-ui/index.ts` public API
    - _Requirements: 5.7_

  - [x] 7.4 Write property test for chronological ordering (Property 4)
    - **Property 4: Chat messages are always chronologically ordered**
    - Generate lists of ChatMessages with arbitrary timestamps and mixed sources
    - Verify: displayed order is sorted by timestamp ascending
    - Verify: inserting a new message maintains sorted invariant
    - **Validates: Requirements 5.1, 6.3**

  - [x] 7.5 Write property test for message rendering (Property 5)
    - **Property 5: Rendered chat message contains all required fields**
    - Generate arbitrary ChatMessage with sender ('user'/'sesame'), non-empty text, valid timestamp
    - Verify: rendered output contains sender label ("You" or "Sesame"), transcript text, formatted timestamp
    - **Validates: Requirements 5.2**

  - [x] 7.6 Write property test for clipboard formatting (Property 6)
    - **Property 6: Clipboard format is a faithful representation of the conversation**
    - Generate non-empty lists of ChatMessages
    - Verify: one line per message in format "SenderLabel: text"
    - Verify: lines in same chronological order as messages
    - **Validates: Requirements 5.7**

  - [x] 7.7 Write unit tests for chat UI service
    - Test addMessage inserts in correct position
    - Test updateInterim updates existing interim message
    - Test finalizeMessage commits message
    - Test clearSession removes all messages
    - Test startNewSession preserves previous session
    - _Requirements: 5.1, 5.4, 5.5, 5.8, 5.9_

- [x] 8. Implement Docker backend and health checker module
  - [x] 8.1 Create Dockerfile for sherpa-onnx server
    - Create `docker/Dockerfile` with Python 3.11 base image
    - Install sherpa-onnx package
    - Download and configure `sherpa-onnx-streaming-zipformer-en-2023-06-21` model
    - Set entrypoint to run sherpa-onnx streaming WebSocket server on port 6006
    - _Requirements: 1.1, 1.2_

  - [x] 8.2 Create docker-compose.yml
    - Create `docker-compose.yml` with stt-server service
    - Configure port mapping 6006:6006
    - Set memory limit (1G) and restart policy (unless-stopped)
    - Add volume mount for model files (optional, for custom models)
    - _Requirements: 1.1_

  - [x] 8.3 Create health checker service
    - Create `src/modules/stt-server/stt-server.service.ts`
    - Implement `checkHealth(host, port)`: attempt WebSocket connection to verify server is running
    - Implement `startHealthPolling(interval)`: poll every 5s, update ServerStatus
    - Implement `getStatus()`: return current ServerStatus
    - If server unresponsive for 10s → update status to 'unresponsive' and notify user
    - Create `src/modules/stt-server/index.ts` public API
    - _Requirements: 1.3, 1.4, 1.5, 8.5_

  - [x] 8.4 Write unit tests for health checker
    - Test health check success → status 'ready'
    - Test health check failure → status 'error' with user message
    - Test 10s unresponsive timeout detection
    - Test polling interval behavior
    - _Requirements: 1.3, 1.4, 1.5, 8.5_

- [x] 9. Checkpoint - Ensure chat UI and server manager tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Offscreen Document (audio + WebSocket orchestration)
  - [x] 10.1 Create offscreen document HTML and entry script
    - Create `src/modules/offscreen/offscreen.html` (minimal HTML for offscreen document)
    - Create `src/modules/offscreen/offscreen.ts` (entry point)
    - Register message listener for `OffscreenCommand` messages from service worker
    - _Requirements: 2.1, 3.1_

  - [x] 10.2 Implement offscreen audio orchestration
    - Handle `start-mic` command: call `navigator.mediaDevices.getUserMedia({ audio: true })`, create AudioProcessor, connect to WebSocket client for mic source
    - Handle `start-tab` command: call `navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } })`, create AudioProcessor, connect to WebSocket client for tab source
    - Handle `stop-mic` / `stop-tab` / `stop-all` commands: stop processors, disconnect WebSockets
    - Forward `TranscriptResult` from WebSocket clients back to service worker as `OffscreenEvent`
    - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.4, 4.1, 4.2_

  - [x] 10.3 Write unit tests for offscreen orchestration
    - Test message routing for each OffscreenCommand type
    - Test mic stream setup with correct audio constraints
    - Test tab stream setup with streamId constraint
    - Test stop commands release resources
    - Test transcript forwarding to service worker
    - _Requirements: 2.1, 3.1, 4.1, 4.2_

- [x] 11. Implement Service Worker (orchestrator)
  - [x] 11.1 Create service worker with state management
    - Create `src/modules/service-worker/service-worker.ts`
    - Implement `ExtensionState` management (serverStatus, micRecording, tabRecording, activeTabId, config)
    - Register `chrome.runtime.onMessage` listener for `PopupMessage` handling
    - Register `chrome.runtime.onMessage` listener for `OffscreenEvent` handling
    - _Requirements: 1.3, 1.4, 6.1_

  - [x] 11.2 Implement offscreen document lifecycle management
    - Implement `ensureOffscreenDocument()`: create offscreen document if not exists using `chrome.offscreen.createDocument()`
    - Implement `closeOffscreenDocument()`: close when no longer needed
    - Send `OffscreenCommand` messages to offscreen document
    - _Requirements: 2.1, 3.1_

  - [x] 11.3 Implement tab capture flow
    - Handle `start-tab-recording` message: call `chrome.tabCapture.getMediaStreamId({ targetTabId })` to get streamId
    - Forward streamId to offscreen document via `start-tab` command
    - Handle tab selection for capture
    - _Requirements: 3.1, 3.6_

  - [x] 11.4 Implement conversation mode orchestration
    - Handle `start-conversation` message: start both mic + tab recording, create new session
    - Handle `stop-conversation` message: stop both sources, finalize session
    - Route `transcript-update` events from offscreen to popup
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 11.5 Implement server health check integration
    - On extension activation: check STT server availability via health checker
    - If server not running: display "Server not running" with instructions to start Docker container
    - On extension deactivation: stop all recordings, close WebSockets
    - Forward server status updates to popup
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 8.1, 8.4_

  - [x] 11.6 Write unit tests for service worker
    - Test state management transitions
    - Test message routing from popup to offscreen
    - Test tab capture streamId flow
    - Test conversation mode starts both sources
    - Test deactivation stops all resources
    - _Requirements: 6.1, 6.4, 8.1, 8.2, 8.3, 8.4_

- [x] 12. Checkpoint - Ensure offscreen and service worker tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement Popup/Chat UI (presentation layer)
  - [x] 13.1 Create popup HTML structure
    - Create `src/modules/chat-ui/popup.html` with chat container, control buttons, status bar
    - Create `src/modules/chat-ui/popup.css` with styles for chat bubbles (right-aligned user, left-aligned Sesame), color coding, recording indicators, status indicators
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 13.2 Create popup controller script
    - Create `src/modules/chat-ui/popup.ts` (entry point for popup)
    - Connect to service worker via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`
    - Implement UI event handlers: start/stop mic, start/stop tab, conversation mode, copy, clear
    - Render server status indicator (loading/ready/error)
    - Render recording indicators ("Your Voice" / "Sesame Voice")
    - _Requirements: 1.3, 1.4, 2.3, 3.3, 5.6, 5.7, 5.8, 6.4_

  - [x] 13.3 Implement real-time transcript rendering
    - Listen for `transcript-update` messages from service worker
    - Render interim results as typing indicator in current bubble
    - Commit final results as completed chat bubbles
    - Auto-scroll to latest message
    - _Requirements: 5.4, 5.5, 5.6_

  - [x] 13.4 Implement session management UI
    - Add "New Session" button that starts fresh conversation
    - Preserve previous sessions in storage (max 50)
    - Add "Conversation Mode" button that starts both recorders simultaneously
    - _Requirements: 5.9, 6.4_

  - [x] 13.5 Write unit tests for popup controller
    - Test UI state rendering for each server status
    - Test recording indicator visibility
    - Test conversation mode button triggers correct messages
    - Test copy button calls clipboard formatter
    - Test clear button removes messages
    - _Requirements: 1.3, 1.4, 2.3, 3.3, 5.7, 5.8_

- [x] 14. Wire all components together and integration
  - [x] 14.1 Create build configuration
    - Set up bundler (esbuild/webpack) for Chrome Extension output
    - Configure separate entry points: service-worker.js, offscreen.js, popup.js, audio-processor.worklet.js
    - Configure output to `dist/` directory with manifest.json copy
    - _Requirements: 1.1_

  - [x] 14.2 Wire service worker imports and initialization
    - Import and initialize all modules in service worker entry point
    - Wire server manager → state updates → popup notifications
    - Wire offscreen events → chat session service → popup updates
    - Ensure all message types are handled end-to-end
    - _Requirements: 1.1, 6.1, 6.2_

  - [x] 14.3 Wire offscreen document imports and initialization
    - Import audio processor and WebSocket client modules
    - Wire audio chunk output → WebSocket binary send
    - Wire WebSocket transcript events → service worker message
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 14.4 Write integration tests for end-to-end flows
    - Test: mic recording start → audio chunks → WebSocket send → transcript received → chat message displayed
    - Test: conversation mode → both sources active → interleaved messages
    - Test: server start → ready status → recording enabled
    - Test: deactivation → all resources released
    - _Requirements: 2.1, 3.1, 4.1, 6.1, 8.1_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify build produces valid Chrome Extension in `dist/`
  - Verify manifest.json is correct and complete

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All audio processing uses 16kHz mono Int16 PCM format
- WebSocket protocol follows sherpa-onnx conventions (binary PCM in, JSON text out, "Done" to end)
- STT server runs in Docker container — user starts with `docker compose up -d`, extension only checks availability
- Module diagram at `docs/module-diagram.md` should be updated as modules are completed

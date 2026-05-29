# Module Block Diagram

## STT Zipformer Extension - Architecture Overview

```mermaid
flowchart LR
  UI["<b>Chat UI</b><br/>IN: ServiceWorkerMessage<br/>OUT: PopupMessage"]
  SW["<b>Service Worker</b><br/>IN: PopupMessage, OffscreenEvent<br/>OUT: ServiceWorkerMessage, OffscreenCommand"]
  Off["<b>Offscreen Document</b><br/>IN: OffscreenCommand, MediaStream<br/>OUT: OffscreenEvent, PCM Binary"]
  AP["<b>Audio Processor</b><br/>IN: Float32 AudioBuffer<br/>OUT: Int16 PCM Chunks"]
  WS["<b>WebSocket Client</b><br/>IN: Int16 PCM, ServerResponse<br/>OUT: TranscriptResult"]
  Config["<b>Config Module</b><br/>IN: Partial&lt;ExtensionConfig&gt;<br/>OUT: ExtensionConfig, ConfigValidationResult"]
  HC["<b>Health Checker</b><br/>IN: host, port<br/>OUT: ServerStatus"]
  ChatSvc["<b>Chat Session Service</b><br/>IN: ChatMessage, segmentId<br/>OUT: ChatSession, formatted text"]
  Errors["<b>Shared Errors</b><br/>IN: ErrorContext<br/>OUT: ExtensionError"]

  UI -->|PopupMessage| SW
  SW -->|OffscreenCommand| Off
  Off -->|AudioBuffer| AP
  AP -->|PCM Chunks| WS
  WS -->|TranscriptResult| Off
  Off -->|OffscreenEvent| SW
  SW -->|ServiceWorkerMessage| UI
  SW -->|host, port| HC
  SW -->|Partial&lt;ExtensionConfig&gt;| Config
  SW -->|ChatMessage| ChatSvc
  Errors -.->|ExtensionError| SW
  Errors -.->|ExtensionError| WS
  Errors -.->|ExtensionError| AP
```

## Module Status

| Module | Status | Notes |
|--------|--------|-------|
| Config | ✅ Complete | Validator + Storage service (`config.validator.ts`, `config.service.ts`) |
| Audio Processor | ✅ Complete | AudioWorklet resampling + service + chunker (`audio-processor.worklet.ts`, `audio-processor.service.ts`, `internal/resampler.ts`, `internal/chunker.ts`) |
| WebSocket Client | ✅ Complete | Service with reconnection logic (`websocket-client.service.ts`) |
| Chat UI | ✅ Complete | Session service + renderer + clipboard formatter + popup controller (`chat-ui.service.ts`, `chat-ui.renderer.ts`, `chat-ui.clipboard.ts`, `popup.ts`, `popup.html`, `popup.css`) |
| STT Server (Health Checker) | ✅ Complete | Docker health checking service (`stt-server.service.ts`) |
| Offscreen | ✅ Complete | Audio + WebSocket orchestration (`offscreen.ts`, `offscreen.orchestrator.ts`) |
| Service Worker | ✅ Complete | State management + message routing + tab capture + conversation mode + health check integration + deactivation (`service-worker.ts`) |

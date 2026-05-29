# STT Zipformer Extension

Chrome Extension (Manifest V3) cho Speech-to-Text sử dụng model Zipformer streaming trên localhost. Hỗ trợ nhận dạng giọng nói tiếng Anh từ microphone và tab audio (Sesame AI), hiển thị kết quả dạng chat session.

## Mục đích

Hỗ trợ luyện tập tiếng Anh:
- **Listening** — Hiển thị transcript của Sesame AI để đọc và hiểu nội dung
- **Speaking** — Hiển thị transcript giọng nói của bạn để đánh giá phát âm

## Tính năng

- 🎤 Thu âm microphone (Your Voice)
- 🔊 Thu âm tab audio từ Sesame AI (Sesame Voice)
- 💬 Hiển thị transcript dạng chat (You / Sesame)
- 🔄 Conversation Mode — ghi âm đồng thời cả hai nguồn
- 📋 Copy transcript ra clipboard
- ⚡ Streaming real-time với latency thấp
- 🐳 STT server chạy local trong Docker container

## Yêu cầu hệ thống

- Windows 10/11
- Google Chrome (phiên bản mới nhất)
- Docker Desktop
- Node.js 18+ (để build)

## Cài đặt

### 1. Clone và build extension

```bash
npm install
npm run build
```

Extension được build vào thư mục `dist/`.

### 2. Khởi động STT Server

```bash
docker compose up -d
```

Server sẽ chạy tại `ws://localhost:6006`. Lần đầu build image sẽ tải model (~200MB).

Kiểm tra server đang chạy:

```bash
docker compose ps
```

Dừng server:

```bash
docker compose down
```

### 3. Load extension vào Chrome

1. Mở `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked**
4. Chọn thư mục `dist/`

## Sử dụng

1. Đảm bảo STT server đang chạy (icon extension hiện trạng thái "Ready")
2. Click icon extension để mở popup
3. Chọn chế độ:
   - **Mic** — Ghi âm giọng nói của bạn
   - **Tab** — Ghi âm audio từ tab đang mở Sesame AI
   - **Conversation Mode** — Ghi âm cả hai đồng thời
4. Transcript hiển thị real-time dạng chat
5. Click **Copy** để copy toàn bộ hội thoại ra clipboard

## Kiến trúc

```
┌─────────────────────────────────────────────────┐
│              Chrome Extension (MV3)              │
├─────────────┬──────────────────┬────────────────┤
│  Popup UI   │  Service Worker  │   Offscreen    │
│  (Chat)     │  (Orchestrator)  │  (Audio + WS)  │
└─────────────┴──────────────────┴────────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │  Docker Container       │
         │  sherpa-onnx server     │
         │  ws://localhost:6006    │
         └─────────────────────────┘
```

### Modules

| Module | Chức năng |
|--------|-----------|
| `service-worker` | Orchestrator, quản lý lifecycle, message routing |
| `offscreen` | Audio capture + WebSocket trong background |
| `audio-processor` | AudioWorklet resample 44.1/48kHz → 16kHz PCM |
| `websocket-client` | Kết nối WebSocket đến STT server, reconnection |
| `chat-ui` | Hiển thị transcript, session management, clipboard |
| `config` | Validation và lưu trữ cấu hình |
| `stt-server` | Health check server availability |

Chi tiết kiến trúc: xem [docs/module-diagram.md](docs/module-diagram.md)

## Development

### Scripts

```bash
npm run build        # Build extension → dist/
npm run build:watch  # Build với watch mode
npm test             # Chạy tất cả tests (252 tests)
npm run test:watch   # Chạy tests với watch mode
npm run typecheck    # Type checking
npm run clean        # Xóa dist/
```

### Cấu trúc thư mục

```
src/
  modules/
    audio-processor/   # AudioWorklet + resampling
    chat-ui/           # Popup UI + chat logic
    config/            # Config validation + storage
    offscreen/         # Offscreen document orchestration
    service-worker/    # Background service worker
    stt-server/        # Health checker
    websocket-client/  # WebSocket client + reconnection
  shared/
    types/             # Shared TypeScript types
    errors.ts          # Custom error classes
    constants/         # Shared constants
    interfaces/        # Module contracts
    utils/             # Utility functions
docker/
  Dockerfile           # STT server image
```

### Testing

Project sử dụng Vitest với hai loại test:

- **Unit tests** — Test specific edge cases và behavior
- **Property-based tests** — Test correctness properties với [fast-check](https://github.com/dubzzz/fast-check)

7 correctness properties được kiểm tra:
1. Audio resampling preserves duration and format
2. Audio chunking emits at correct boundaries
3. WebSocket reconnection respects retry limits
4. Chat messages are always chronologically ordered
5. Rendered chat message contains all required fields
6. Clipboard format is faithful representation
7. Configuration validation correctly classifies inputs

## Cấu hình

Extension hỗ trợ cấu hình qua popup settings:

| Tùy chọn | Mặc định | Mô tả |
|-----------|----------|-------|
| Server Host | `localhost` | Host của STT server |
| Server Port | `6006` | Port của STT server |
| Audio Chunk Size | `500ms` | Kích thước chunk gửi đến server |
| Model Path | — | Đường dẫn model (cần restart server) |

## Giao thức WebSocket

Extension giao tiếp với sherpa-onnx server qua WebSocket:

- **Client → Server**: Binary frames (PCM int16, 16kHz, mono, little-endian)
- **Server → Client**: Text frames (JSON với kết quả nhận dạng)
- **End of stream**: Client gửi text frame `"Done"`

## Model

Sử dụng model `sherpa-onnx-streaming-zipformer-en-2023-06-21` (int8):
- Trained trên LibriSpeech + GigaSpeech
- Encoder: 179MB (int8 quantized)
- RTF: ~0.062 (real-time factor)
- Streaming với endpoint detection tự động

## License

Private project.

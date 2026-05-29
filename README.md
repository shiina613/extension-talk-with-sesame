# STT Zipformer Extension

Chrome Extension (Manifest V3) cho Speech-to-Text sử dụng model Zipformer streaming trên localhost. Nhận dạng giọng nói tiếng Anh từ microphone và audio của bất kỳ tab nào đang mở, hiển thị kết quả dạng chat session.

## Tính năng

- 🎤 Thu âm microphone (Your Voice)
- 🔊 Thu âm audio từ bất kỳ tab nào (Tab Voice) — YouTube, Google Meet, Sesame AI, podcast, v.v.
- 💬 Hiển thị transcript dạng chat (You / Tab)
- 🔄 Conversation Mode — ghi âm đồng thời cả hai nguồn
- 📋 Copy transcript ra clipboard
- ⚡ Streaming real-time với latency thấp
- 🐳 STT server chạy local trong Docker — không cần internet
- 🔒 Hoàn toàn offline — audio không rời khỏi máy bạn

## Use Cases

- Luyện phát âm tiếng Anh với AI voice assistants (Sesame, ChatGPT Voice, etc.)
- Tạo transcript cho video YouTube
- Ghi chú cuộc họp Google Meet / Zoom
- Transcribe podcast hoặc audiobook
- Bất kỳ nguồn audio nào phát trong browser

## Yêu cầu hệ thống

- Google Chrome (phiên bản mới nhất)
- Docker Desktop
- Node.js 18+ (để build)
- ~1GB RAM cho STT server

## Cài đặt

### 1. Clone và build extension

```bash
git clone https://github.com/shiina613/extension-talk-with-sesame.git
cd extension-talk-with-sesame
npm install
npm run build
```

### 2. Khởi động STT Server

```bash
docker compose up -d
```

Lần đầu build image sẽ tải model (~200MB). Các lần sau chỉ start container, không tải lại.

Kiểm tra server:

```bash
docker compose ps        # Xem trạng thái
docker compose down      # Dừng server
docker compose up -d     # Start lại
```

### 3. Load extension vào Chrome

1. Mở `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked**
4. Chọn thư mục `dist/`

## Sử dụng

1. Start Docker server: `docker compose up -d`
2. Click icon extension — đợi "Server ready" (vài giây)
3. Chọn chế độ:
   - **🎤 Mic** — Ghi âm giọng nói của bạn
   - **🔊 Tab** — Ghi âm audio từ tab đang active
   - **💬 Conversation** — Ghi âm cả hai đồng thời
4. Transcript hiển thị real-time
5. **📋 Copy** để copy hội thoại | **🗑️ Clear** để xóa | **➕ New** để tạo session mới

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
| `service-worker` | Orchestrator, lifecycle, message routing |
| `offscreen` | Audio capture + WebSocket trong background |
| `audio-processor` | AudioWorklet resample → 16kHz PCM |
| `websocket-client` | WebSocket streaming + reconnection |
| `chat-ui` | Chat display, session management, clipboard |
| `config` | Config validation + storage |
| `stt-server` | Health check server availability |

## Development

```bash
npm run build        # Build extension → dist/
npm run build:watch  # Build với watch mode
npm test             # Chạy tests (258 tests)
npm run test:watch   # Tests với watch mode
npm run typecheck    # Type checking
npm run clean        # Xóa dist/
```

### Testing

- **Unit tests** — Vitest
- **Property-based tests** — fast-check (7 correctness properties)
- Coverage: audio resampling, chunking, WebSocket reconnection, chat ordering, rendering, clipboard, config validation

## Cấu hình

| Tùy chọn | Mặc định | Mô tả |
|-----------|----------|-------|
| Server Host | `localhost` | Host của STT server |
| Server Port | `6006` | Port của STT server |
| Audio Chunk Size | `500ms` | Kích thước chunk gửi đến server |

## Model

`sherpa-onnx-streaming-zipformer-en-2023-06-21` (int8):
- Trained trên LibriSpeech + GigaSpeech
- Encoder: 179MB (int8 quantized)
- RTF: ~0.062
- Streaming với endpoint detection tự động
- Chỉ hỗ trợ tiếng Anh

## License

MIT

# Requirements Document

## Introduction

Extension Speech-to-Text (STT) sử dụng model Zipformer chạy trên localhost. Extension này cho phép người dùng chuyển đổi giọng nói thành văn bản từ hai nguồn: giọng nói của người dùng (qua microphone) và giọng nói của Sesame AI (qua system audio). Mục đích chính là hỗ trợ người dùng cải thiện kỹ năng tiếng Anh:
- **Listening**: Hiển thị transcript của Sesame để người dùng đọc và hiểu nội dung
- **Speaking**: Hiển thị transcript giọng nói của người dùng để đánh giá chất lượng phát âm

Model Zipformer tiếng Anh (từ dự án k2-fsa/icefall) được triển khai cục bộ trên máy Windows, không cần kết nối internet. Extension ưu tiên nhận dạng tiếng Anh để phục vụ mục đích luyện tập.

## Glossary

- **Extension**: Phần mở rộng phần mềm cung cấp chức năng Speech-to-Text
- **STT_Server**: Server chạy trên localhost phục vụ model Zipformer để nhận dạng giọng nói
- **Zipformer_Model**: Model nhận dạng giọng nói tiếng Anh Zipformer từ dự án k2-fsa/icefall. Model khuyến nghị: `sherpa-onnx-streaming-zipformer-en-2023-06-21` (int8) - trained trên LibriSpeech + GigaSpeech, encoder 179MB, RTF ~0.062
- **Microphone_Recorder**: Thành phần thu âm giọng nói người dùng từ microphone
- **Tab_Audio_Recorder**: Thành phần thu âm audio từ tab/browser đang chạy Sesame AI (sử dụng chrome.tabCapture hoặc chrome.tabCapture.getMediaStreamId API)
- **Transcript**: Văn bản kết quả sau khi nhận dạng giọng nói
- **User_Transcript**: Transcript từ giọng nói của người dùng
- **Sesame_Transcript**: Transcript từ giọng nói của Sesame AI
- **WebSocket_Client**: Thành phần kết nối đến STT_Server qua giao thức WebSocket để streaming audio
- **Audio_Stream**: Luồng dữ liệu âm thanh được gửi từ recorder đến STT_Server
- **Chat_Session**: Giao diện hiển thị transcript dạng hội thoại, các message được sắp xếp theo thứ tự thời gian với nhãn người nói (You/Sesame)
- **Chat_Message**: Một đơn vị transcript trong Chat_Session, bao gồm sender label, nội dung text, và timestamp

## Requirements

### Requirement 1: Khởi động STT Server

**User Story:** As a user, I want the STT server with the Zipformer model to run in a Docker container on my machine, so that I can use speech recognition locally without complex setup.

#### Acceptance Criteria

1. THE Extension SHALL connect to the STT_Server running in a Docker container on localhost with a configurable port (default: 6006)
2. THE STT_Server Docker container SHALL use the `sherpa-onnx-streaming-zipformer-en-2023-06-21` model with int8 quantization
3. WHEN the Extension is activated, IT SHALL check if the STT_Server is available by performing a WebSocket health check
4. WHEN the STT_Server is available, THE Extension SHALL display a ready status notification
5. IF the STT_Server is not running, THEN THE Extension SHALL display an error message with instructions to start the Docker container (`docker compose up -d`)
6. IF the configured port is not responding, THEN THE Extension SHALL notify the user and suggest checking the Docker container status

### Requirement 2: Thu âm giọng nói người dùng (User Microphone Recording)

**User Story:** As a user, I want to record my voice through the microphone, so that I can see how my English pronunciation is recognized and improve my speaking skills.

#### Acceptance Criteria

1. WHEN the user activates the microphone recording function, THE Microphone_Recorder SHALL capture audio from the default system microphone
2. THE Microphone_Recorder SHALL capture audio in 16kHz sample rate, mono channel, 16-bit PCM format
3. WHILE microphone recording is active, THE Extension SHALL display a visual recording indicator labeled "Your Voice"
4. WHEN the user deactivates the microphone recording function, THE Microphone_Recorder SHALL stop capturing audio
5. IF no microphone is detected, THEN THE Extension SHALL display an error message indicating that a microphone is required

### Requirement 3: Thu âm Tab Audio (Sesame Voice Capture)

**User Story:** As a user, I want to capture Sesame's voice output from the browser tab, so that I can see the transcript of what Sesame says without capturing unrelated system sounds.

#### Acceptance Criteria

1. WHEN the user activates the tab audio capture function, THE Tab_Audio_Recorder SHALL capture audio output from the active browser tab running Sesame AI (using chrome.tabCapture API)
2. THE Tab_Audio_Recorder SHALL capture tab audio in 16kHz sample rate, mono channel, 16-bit PCM format
3. WHILE tab audio capture is active, THE Extension SHALL display a visual indicator labeled "Sesame Voice"
4. WHEN the user deactivates the tab audio capture function, THE Tab_Audio_Recorder SHALL stop capturing tab audio
5. IF tab audio capture permission is denied or the API is unavailable, THEN THE Extension SHALL display an error message with instructions to grant tab capture permission
6. THE Extension SHALL allow the user to select which tab to capture audio from if multiple tabs are open

### Requirement 4: Streaming Audio đến STT Server

**User Story:** As a user, I want both audio sources to be streamed to the STT server in real-time, so that I can receive transcription results with low latency for both my voice and Sesame's voice.

#### Acceptance Criteria

1. WHEN microphone recording starts, THE WebSocket_Client SHALL establish a dedicated connection to the STT_Server for User_Transcript
2. WHEN system audio capture starts, THE WebSocket_Client SHALL establish a separate dedicated connection to the STT_Server for Sesame_Transcript
3. WHILE recording is active, THE WebSocket_Client SHALL stream Audio_Stream data to the STT_Server in chunks of 0.5 seconds
4. IF a WebSocket connection is lost during recording, THEN THE WebSocket_Client SHALL attempt to reconnect up to 3 times with 1-second intervals
5. IF reconnection fails after 3 attempts, THEN THE Extension SHALL stop the corresponding recording source and notify the user of the connection failure
6. WHEN recording stops, THE WebSocket_Client SHALL send an end-of-stream signal to the STT_Server and close the connection gracefully

### Requirement 5: Hiển thị kết quả nhận dạng dạng Chat Session (Transcription Display)

**User Story:** As a user, I want to see transcription results displayed as a chat conversation, so that I can follow the dialogue flow between myself and Sesame naturally.

#### Acceptance Criteria

1. THE Extension SHALL display transcription results as a chat session with messages ordered chronologically
2. EACH chat message SHALL display: sender label ("You" or "Sesame"), transcript text, and timestamp
3. THE Extension SHALL visually distinguish messages from different speakers using different alignment (user messages right-aligned, Sesame messages left-aligned) and color coding
4. WHEN the STT_Server returns a partial Transcript, THE Extension SHALL display the interim result as a typing indicator in the current message bubble
5. WHEN the STT_Server returns a final Transcript, THE Extension SHALL commit the message as a completed chat bubble in the conversation
6. THE Extension SHALL auto-scroll to the latest message when new transcript arrives
7. WHEN the user clicks the copy button, THE Extension SHALL copy the full conversation transcript to the system clipboard in a readable format (e.g., "You: ... \n Sesame: ...")
8. WHEN the user clicks the clear button, THE Extension SHALL remove all messages from the chat session
9. THE Extension SHALL support starting a new conversation session while preserving the option to review previous sessions

### Requirement 6: Chế độ ghi âm đồng thời (Simultaneous Recording Mode)

**User Story:** As a user, I want to record both my voice and Sesame's voice at the same time, so that I can have a natural conversation with Sesame while seeing both transcripts in the chat session.

#### Acceptance Criteria

1. THE Extension SHALL support recording from Microphone_Recorder and Tab_Audio_Recorder simultaneously
2. WHEN simultaneous recording is active, THE Extension SHALL process both Audio_Streams independently through separate WebSocket connections
3. THE Extension SHALL interleave both User and Sesame messages in the chat session in real-time chronological order during simultaneous recording
4. WHEN the user activates the "Conversation Mode" button, THE Extension SHALL start both Microphone_Recorder and Tab_Audio_Recorder simultaneously and begin a new chat session

### Requirement 7: Cấu hình Extension (Configuration)

**User Story:** As a user, I want to configure the STT extension settings, so that I can customize the behavior to match my environment.

#### Acceptance Criteria

1. THE Extension SHALL provide configuration options for: server host (default: localhost), server port (default: 6006), model path, and audio chunk size
2. WHEN the user changes a configuration value, THE Extension SHALL validate the new value before applying
3. IF an invalid configuration value is provided, THEN THE Extension SHALL display a validation error and retain the previous valid value
4. WHEN the model path configuration is changed, THE Extension SHALL require a server restart to apply the new model

### Requirement 8: Quản lý vòng đời Extension (Lifecycle Management)

**User Story:** As a user, I want the extension to properly manage its resources, so that it does not consume system resources when not in use.

#### Acceptance Criteria

1. WHEN the Extension is deactivated, THE Extension SHALL stop all active recordings and release audio resources
2. WHEN the Extension is deactivated, THE Microphone_Recorder SHALL stop recording and release the microphone
3. WHEN the Extension is deactivated, THE Tab_Audio_Recorder SHALL stop capturing and release tab audio resources
4. WHEN the Extension is deactivated, THE WebSocket_Client SHALL close all open connections
5. IF the STT_Server becomes unresponsive for more than 10 seconds, THEN THE Extension SHALL notify the user and suggest restarting the Docker container

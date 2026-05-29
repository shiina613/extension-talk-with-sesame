/** Audio source identifier */
export type AudioSource = 'mic' | 'tab';

/** Configuration for audio capture and processing */
export interface AudioConfig {
  sampleRate: number;       // 16000
  channels: number;         // 1 (mono)
  bitDepth: number;         // 16
  chunkSizeMs: number;      // 500
}

/** Message emitted by AudioWorklet when a chunk is ready */
export interface AudioChunkMessage {
  type: 'audio-chunk';
  pcmData: Int16Array;       // 16-bit PCM samples
  timestamp: number;
}

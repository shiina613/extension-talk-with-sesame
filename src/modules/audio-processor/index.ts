// Audio Processor module - AudioWorklet for capture and resampling
// Public API

export { resampleLinear, float32ToInt16 } from './internal/resampler';
export { AudioChunker, computeChunkMetrics } from './internal/chunker';
export { AudioProcessorService } from './audio-processor.service';
export type { AudioChunkCallback, StartCaptureOptions } from './audio-processor.service';
export { ensureAudioContextRunning } from './audio-context.util';

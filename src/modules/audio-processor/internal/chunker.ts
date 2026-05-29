/**
 * Audio chunker - buffers PCM samples and emits fixed-size chunks.
 * Extracted from AudioWorklet for independent testability.
 */

const DEFAULT_CHUNK_SIZE = 8000; // 500ms at 16kHz

export interface ChunkEmitResult {
  chunks: Int16Array[];
  remainderSize: number;
}

/**
 * Stateful audio chunker that buffers Int16 PCM samples
 * and emits chunks of a fixed size.
 */
export class AudioChunker {
  private buffer: Int16Array;
  private bufferIndex: number = 0;
  private readonly chunkSize: number;

  constructor(chunkSize: number = DEFAULT_CHUNK_SIZE) {
    this.chunkSize = chunkSize;
    this.buffer = new Int16Array(chunkSize);
  }

  /**
   * Feed PCM samples into the chunker.
   * Returns all complete chunks that were filled.
   *
   * @param samples - Int16Array of PCM samples to buffer
   * @returns Array of complete chunks (each exactly chunkSize samples)
   */
  feed(samples: Int16Array): Int16Array[] {
    const chunks: Int16Array[] = [];

    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.bufferIndex++] = samples[i];

      if (this.bufferIndex >= this.chunkSize) {
        chunks.push(new Int16Array(this.buffer));
        this.bufferIndex = 0;
      }
    }

    return chunks;
  }

  /**
   * Flush any remaining buffered samples as a partial chunk.
   * Returns null if buffer is empty.
   */
  flush(): Int16Array | null {
    if (this.bufferIndex === 0) {
      return null;
    }

    const partial = new Int16Array(this.bufferIndex);
    partial.set(this.buffer.subarray(0, this.bufferIndex));
    this.bufferIndex = 0;
    return partial;
  }

  /**
   * Get the number of samples currently buffered (not yet emitted).
   */
  getBufferedCount(): number {
    return this.bufferIndex;
  }

  /**
   * Get the configured chunk size.
   */
  getChunkSize(): number {
    return this.chunkSize;
  }

  /**
   * Reset the chunker, discarding any buffered samples.
   */
  reset(): void {
    this.bufferIndex = 0;
  }
}

/**
 * Pure function: given an array of PCM samples and a chunk size,
 * compute how many complete chunks would be emitted and the remainder.
 *
 * @param totalSamples - Total number of input samples
 * @param chunkSize - Size of each chunk
 * @returns Object with chunk count and remainder size
 */
export function computeChunkMetrics(
  totalSamples: number,
  chunkSize: number,
): { chunkCount: number; remainderSize: number } {
  return {
    chunkCount: Math.floor(totalSamples / chunkSize),
    remainderSize: totalSamples % chunkSize,
  };
}

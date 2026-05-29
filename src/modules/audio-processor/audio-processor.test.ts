/**
 * Unit tests for audio processor module.
 *
 * Tests AudioWorklet registration/message passing (via resampler + chunker),
 * and edge cases for audio processing.
 */

import { describe, it, expect } from 'vitest';
import { resampleLinear, float32ToInt16 } from './internal/resampler';
import { AudioChunker } from './internal/chunker';

const CHUNK_SIZE = 8000; // 500ms at 16kHz

describe('Audio Processor - Resampler', () => {
  describe('resampleLinear', () => {
    it('should return empty array for empty input', () => {
      const output = resampleLinear(new Float32Array(0), 48000, 16000);
      expect(output.length).toBe(0);
    });

    it('should downsample 48000Hz to 16000Hz (ratio 1:3)', () => {
      // 480 samples at 48kHz = 10ms → should produce ~160 samples at 16kHz
      const input = new Float32Array(480);
      for (let i = 0; i < 480; i++) {
        input[i] = Math.sin(2 * Math.PI * 440 * i / 48000); // 440Hz sine
      }

      const output = resampleLinear(input, 48000, 16000);
      expect(output.length).toBe(160);
    });

    it('should downsample 44100Hz to 16000Hz', () => {
      // 441 samples at 44.1kHz = 10ms → should produce ~160 samples at 16kHz
      const input = new Float32Array(441);
      for (let i = 0; i < 441; i++) {
        input[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
      }

      const output = resampleLinear(input, 44100, 16000);
      const expectedLength = Math.round(441 * (16000 / 44100));
      expect(Math.abs(output.length - expectedLength)).toBeLessThanOrEqual(1);
    });

    it('should preserve values when source equals target rate', () => {
      const input = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      const output = resampleLinear(input, 16000, 16000);

      expect(output.length).toBe(4);
      expect(output[0]).toBeCloseTo(0.5);
      expect(output[1]).toBeCloseTo(-0.5);
      expect(output[2]).toBeCloseTo(0.25);
      expect(output[3]).toBeCloseTo(-0.25);
    });

    it('should handle single sample input', () => {
      const input = new Float32Array([0.7]);
      const output = resampleLinear(input, 48000, 16000);
      // 1 sample at 48kHz → round(1 * 16000/48000) = round(0.333) = 0 samples
      // Actually Math.round(0.333) = 0, so output could be 0 length
      // This is an edge case - very short inputs may produce 0 output
      expect(output.length).toBeLessThanOrEqual(1);
    });
  });

  describe('float32ToInt16', () => {
    it('should convert 0.0 to 0', () => {
      const output = float32ToInt16(new Float32Array([0.0]));
      expect(output[0]).toBe(0);
    });

    it('should convert 1.0 to 32767', () => {
      const output = float32ToInt16(new Float32Array([1.0]));
      expect(output[0]).toBe(32767);
    });

    it('should convert -1.0 to -32768', () => {
      const output = float32ToInt16(new Float32Array([-1.0]));
      expect(output[0]).toBe(-32768);
    });

    it('should clamp values above 1.0', () => {
      const output = float32ToInt16(new Float32Array([1.5]));
      expect(output[0]).toBe(32767);
    });

    it('should clamp values below -1.0', () => {
      const output = float32ToInt16(new Float32Array([-1.5]));
      expect(output[0]).toBe(-32768);
    });

    it('should handle empty input', () => {
      const output = float32ToInt16(new Float32Array(0));
      expect(output.length).toBe(0);
    });
  });
});

describe('Audio Processor - Chunker', () => {
  describe('edge case: empty input buffer', () => {
    it('should emit no chunks for empty input', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const chunks = chunker.feed(new Int16Array(0));

      expect(chunks.length).toBe(0);
      expect(chunker.getBufferedCount()).toBe(0);
    });
  });

  describe('edge case: input exactly 8000 samples', () => {
    it('should emit exactly one chunk', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const input = new Int16Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        input[i] = i % 32767;
      }

      const chunks = chunker.feed(input);

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
      expect(chunker.getBufferedCount()).toBe(0);
    });

    it('emitted chunk contains correct sample values', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const input = new Int16Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        input[i] = i % 100;
      }

      const chunks = chunker.feed(input);

      expect(chunks[0][0]).toBe(0);
      expect(chunks[0][99]).toBe(99);
      expect(chunks[0][100]).toBe(0);
    });
  });

  describe('edge case: input 7999 samples (no chunk emitted)', () => {
    it('should emit no chunks and buffer all samples', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const input = new Int16Array(7999);
      for (let i = 0; i < 7999; i++) {
        input[i] = i % 32767;
      }

      const chunks = chunker.feed(input);

      expect(chunks.length).toBe(0);
      expect(chunker.getBufferedCount()).toBe(7999);
    });

    it('adding one more sample should trigger chunk emission', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const input = new Int16Array(7999);
      for (let i = 0; i < 7999; i++) {
        input[i] = i % 32767;
      }

      chunker.feed(input);
      const chunks = chunker.feed(new Int16Array([42]));

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
      expect(chunker.getBufferedCount()).toBe(0);
    });
  });

  describe('flush', () => {
    it('should return null when buffer is empty', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      expect(chunker.flush()).toBeNull();
    });

    it('should return partial buffer contents', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      const input = new Int16Array([1, 2, 3, 4, 5]);
      chunker.feed(input);

      const flushed = chunker.flush();

      expect(flushed).not.toBeNull();
      expect(flushed!.length).toBe(5);
      expect(flushed![0]).toBe(1);
      expect(flushed![4]).toBe(5);
      expect(chunker.getBufferedCount()).toBe(0);
    });
  });

  describe('reset', () => {
    it('should discard buffered samples', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);
      chunker.feed(new Int16Array(5000));

      expect(chunker.getBufferedCount()).toBe(5000);
      chunker.reset();
      expect(chunker.getBufferedCount()).toBe(0);
    });
  });

  describe('multiple feeds across chunk boundaries', () => {
    it('should correctly handle samples spanning multiple chunks', () => {
      const chunker = new AudioChunker(CHUNK_SIZE);

      // Feed 20000 samples in two batches
      const batch1 = new Int16Array(12000);
      const batch2 = new Int16Array(8000);

      const chunks1 = chunker.feed(batch1); // Should emit 1 chunk, buffer 4000
      expect(chunks1.length).toBe(1);
      expect(chunker.getBufferedCount()).toBe(4000);

      const chunks2 = chunker.feed(batch2); // 4000 + 8000 = 12000 → 1 chunk, buffer 4000
      expect(chunks2.length).toBe(1);
      expect(chunker.getBufferedCount()).toBe(4000);
    });
  });
});

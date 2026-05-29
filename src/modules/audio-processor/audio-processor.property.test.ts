/**
 * Property-based tests for audio processor module.
 *
 * Property 1: Audio resampling preserves duration and produces correct format
 * Property 2: Audio chunking emits at correct boundaries
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resampleLinear, float32ToInt16 } from './internal/resampler';

const TARGET_SAMPLE_RATE = 16000;
const SUPPORTED_SOURCE_RATES = [44100, 48000];

describe('Feature: stt-zipformer-extension, Property 1: Audio resampling preserves duration and produces correct format', () => {
  it('output sample count equals inputSamples * (16000 / sourceSampleRate) ±1 for 44100Hz', () => {
    fc.assert(
      fc.property(
        fc.float32Array({ minLength: 1, maxLength: 4410, noNaN: true }),
        (input) => {
          const sourceSampleRate = 44100;
          const output = resampleLinear(input, sourceSampleRate, TARGET_SAMPLE_RATE);

          const expectedLength = Math.round(input.length * (TARGET_SAMPLE_RATE / sourceSampleRate));
          expect(Math.abs(output.length - expectedLength)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('output sample count equals inputSamples * (16000 / sourceSampleRate) ±1 for 48000Hz', () => {
    fc.assert(
      fc.property(
        fc.float32Array({ minLength: 1, maxLength: 4800, noNaN: true }),
        (input) => {
          const sourceSampleRate = 48000;
          const output = resampleLinear(input, sourceSampleRate, TARGET_SAMPLE_RATE);

          const expectedLength = Math.round(input.length * (TARGET_SAMPLE_RATE / sourceSampleRate));
          expect(Math.abs(output.length - expectedLength)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all output values are within Int16 range [-32768, 32767] after conversion', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(44100), fc.constant(48000)),
        fc.float32Array({ minLength: 1, maxLength: 4800, min: -1.0, max: 1.0, noNaN: true }),
        (sourceSampleRate, input) => {
          const resampled = resampleLinear(input, sourceSampleRate, TARGET_SAMPLE_RATE);
          const pcm = float32ToInt16(resampled);

          for (let i = 0; i < pcm.length; i++) {
            expect(pcm[i]).toBeGreaterThanOrEqual(-32768);
            expect(pcm[i]).toBeLessThanOrEqual(32767);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty input produces empty output', () => {
    for (const rate of SUPPORTED_SOURCE_RATES) {
      const output = resampleLinear(new Float32Array(0), rate, TARGET_SAMPLE_RATE);
      expect(output.length).toBe(0);
    }
  });

  it('same source and target rate produces same length output', () => {
    fc.assert(
      fc.property(
        fc.float32Array({ minLength: 1, maxLength: 1000, noNaN: true }),
        (input) => {
          const output = resampleLinear(input, TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE);
          expect(output.length).toBe(input.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

import { AudioChunker, computeChunkMetrics } from './internal/chunker';

const CHUNK_SIZE = 8000; // 500ms at 16kHz

describe('Feature: stt-zipformer-extension, Property 2: Audio chunking emits at correct boundaries', () => {
  it('each emitted chunk has exactly 8000 samples', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50000 }),
        (length) => {
          const input = new Int16Array(length);
          // Fill with arbitrary values
          for (let i = 0; i < length; i++) {
            input[i] = (i % 65536) - 32768;
          }

          const chunker = new AudioChunker(CHUNK_SIZE);
          const chunks = chunker.feed(input);

          for (const chunk of chunks) {
            expect(chunk.length).toBe(CHUNK_SIZE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('total emitted samples equals total input minus remainder (< 8000)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50000 }),
        (length) => {
          const input = new Int16Array(length);
          for (let i = 0; i < length; i++) {
            input[i] = (i % 65536) - 32768;
          }

          const chunker = new AudioChunker(CHUNK_SIZE);
          const chunks = chunker.feed(input);
          const totalEmitted = chunks.length * CHUNK_SIZE;
          const remainder = chunker.getBufferedCount();

          expect(totalEmitted + remainder).toBe(length);
          expect(remainder).toBeLessThan(CHUNK_SIZE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('multiple feeds accumulate correctly across boundaries', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 10 }),
        (lengths) => {
          const chunker = new AudioChunker(CHUNK_SIZE);
          let totalInput = 0;
          let totalChunks = 0;

          for (const len of lengths) {
            const input = new Int16Array(len);
            for (let i = 0; i < len; i++) {
              input[i] = i % 32767;
            }
            const chunks = chunker.feed(input);
            totalInput += len;
            totalChunks += chunks.length;

            for (const chunk of chunks) {
              expect(chunk.length).toBe(CHUNK_SIZE);
            }
          }

          const remainder = chunker.getBufferedCount();
          expect(totalChunks * CHUNK_SIZE + remainder).toBe(totalInput);
          expect(remainder).toBeLessThan(CHUNK_SIZE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('computeChunkMetrics matches actual chunker behavior', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        (totalSamples) => {
          const metrics = computeChunkMetrics(totalSamples, CHUNK_SIZE);

          expect(metrics.chunkCount * CHUNK_SIZE + metrics.remainderSize).toBe(totalSamples);
          expect(metrics.remainderSize).toBeGreaterThanOrEqual(0);
          expect(metrics.remainderSize).toBeLessThan(CHUNK_SIZE);
        },
      ),
      { numRuns: 100 },
    );
  });
});

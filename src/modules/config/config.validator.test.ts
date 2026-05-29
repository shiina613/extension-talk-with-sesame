import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validatePort,
  validateHost,
  validateAudioChunkSizeMs,
  validateModelPath,
  validateConfig,
} from './config.validator';

/**
 * Feature: stt-zipformer-extension, Property 7: Configuration validation correctly classifies inputs
 * Validates: Requirements 7.2
 */
describe('Property 7: Configuration validation correctly classifies inputs', () => {
  describe('validatePort', () => {
    it('accepts integers in [1, 65535]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 65535 }),
          (port) => {
            const result = validatePort(port);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects integers outside [1, 65535]', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1_000_000, max: 0 }),
            fc.integer({ min: 65536, max: 1_000_000 })
          ),
          (port) => {
            const result = validatePort(port);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-integer numbers', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 65535, noInteger: true, noNaN: true }),
          (port) => {
            const result = validatePort(port);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-number values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined)
          ),
          (port) => {
            const result = validatePort(port);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('validateHost', () => {
    it('accepts non-empty strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          (host) => {
            const result = validateHost(host);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects empty strings', () => {
      fc.assert(
        fc.property(
          fc.constant(''),
          (host) => {
            const result = validateHost(host);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects whitespace-only strings', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constant(' '), { minLength: 1 }),
          (host) => {
            const result = validateHost(host);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-string values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined)
          ),
          (host) => {
            const result = validateHost(host);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('validateAudioChunkSizeMs', () => {
    it('accepts integers in [100, 2000]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 2000 }),
          (chunkSize) => {
            const result = validateAudioChunkSizeMs(chunkSize);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects integers outside [100, 2000]', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1_000_000, max: 99 }),
            fc.integer({ min: 2001, max: 1_000_000 })
          ),
          (chunkSize) => {
            const result = validateAudioChunkSizeMs(chunkSize);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-integer numbers', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 2000, noInteger: true, noNaN: true }),
          (chunkSize) => {
            const result = validateAudioChunkSizeMs(chunkSize);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-number values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined)
          ),
          (chunkSize) => {
            const result = validateAudioChunkSizeMs(chunkSize);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('validateModelPath', () => {
    it('accepts non-empty strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          (modelPath) => {
            const result = validateModelPath(modelPath);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects empty strings', () => {
      fc.assert(
        fc.property(
          fc.constant(''),
          (modelPath) => {
            const result = validateModelPath(modelPath);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects whitespace-only strings', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constant(' '), { minLength: 1 }),
          (modelPath) => {
            const result = validateModelPath(modelPath);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects non-string values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.constant(undefined)
          ),
          (modelPath) => {
            const result = validateModelPath(modelPath);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * Unit tests: Config validator edge cases
 * Validates: Requirements 7.2, 7.3
 */
describe('Unit tests: Config validator edge cases', () => {
  describe('validatePort', () => {
    it('rejects port 0 (below minimum)', () => {
      const result = validatePort(0);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects port 65536 (above maximum)', () => {
      const result = validatePort(65536);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('accepts port 6006 (default port)', () => {
      const result = validatePort(6006);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts port 1 (min boundary)', () => {
      const result = validatePort(1);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts port 65535 (max boundary)', () => {
      const result = validatePort(65535);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects non-integer port 3.14', () => {
      const result = validatePort(3.14);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validateHost', () => {
    it('rejects empty string', () => {
      const result = validateHost('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('accepts localhost', () => {
      const result = validateHost('localhost');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts IP address 192.168.1.1', () => {
      const result = validateHost('192.168.1.1');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('validateAudioChunkSizeMs', () => {
    it('rejects 99 (below minimum)', () => {
      const result = validateAudioChunkSizeMs(99);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('accepts 100 (min boundary)', () => {
      const result = validateAudioChunkSizeMs(100);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts 2000 (max boundary)', () => {
      const result = validateAudioChunkSizeMs(2000);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects 2001 (above maximum)', () => {
      const result = validateAudioChunkSizeMs(2001);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('accepts 500 (default value)', () => {
      const result = validateAudioChunkSizeMs(500);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('validateModelPath', () => {
    it('rejects empty string', () => {
      const result = validateModelPath('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('accepts valid path /path/to/model', () => {
      const result = validateModelPath('/path/to/model');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('validateConfig', () => {
    it('returns partial errors for mixed valid/invalid fields', () => {
      const result = validateConfig({
        serverHost: '',
        serverPort: 6006,
        audioChunkSizeMs: 9999,
        modelPath: '/valid/path',
      });
      expect(result.valid).toBe(false);
      expect(result.errors['serverHost']).toBeDefined();
      expect(result.errors['serverPort']).toBeUndefined();
      expect(result.errors['audioChunkSizeMs']).toBeDefined();
      expect(result.errors['modelPath']).toBeUndefined();
    });

    it('returns valid: true when all fields are valid', () => {
      const result = validateConfig({
        serverHost: 'localhost',
        serverPort: 6006,
        audioChunkSizeMs: 500,
        modelPath: '/path/to/model',
      });
      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });
});

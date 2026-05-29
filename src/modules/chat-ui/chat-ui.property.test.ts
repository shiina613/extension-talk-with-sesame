import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  addMessage,
  getMessages,
  resetState,
} from './chat-ui.service';
import { renderMessage, formatTimestamp, getSenderLabel } from './chat-ui.renderer';
import { formatForClipboard } from './chat-ui.clipboard';
import { ChatMessage } from '@shared/types';

// Arbitrary generator for ChatMessage
const chatMessageArb = (overrides?: Partial<ChatMessage>) =>
  fc.record({
    id: fc.uuid(),
    sender: fc.constantFrom('user' as const, 'sesame' as const),
    text: fc.string({ minLength: 1, maxLength: 200 }),
    timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    isFinal: fc.boolean(),
    segmentId: fc.uuid(),
  }).map((msg) => ({ ...msg, ...overrides }));

/**
 * Feature: stt-zipformer-extension, Property 4: Chat messages are always chronologically ordered
 *
 * For any list of ChatMessages with arbitrary timestamps and mixed sources (user/sesame),
 * the displayed message order SHALL be sorted by timestamp in ascending order.
 * Inserting a new message SHALL maintain this sorted invariant.
 *
 * Validates: Requirements 5.1, 6.3
 */
describe('Property 4: Chat messages are always chronologically ordered', () => {
  beforeEach(() => {
    resetState();
  });

  it('should maintain chronological order for any sequence of inserted messages', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 1, maxLength: 50 }),
        (messages) => {
          resetState();

          for (const msg of messages) {
            addMessage(msg);
          }

          const result = getMessages();
          for (let i = 1; i < result.length; i++) {
            expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain sorted invariant when inserting a new message into existing list', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 1, maxLength: 30 }),
        chatMessageArb(),
        (existingMessages, newMessage) => {
          resetState();

          // Insert existing messages
          for (const msg of existingMessages) {
            addMessage(msg);
          }

          // Insert one more message
          addMessage(newMessage);

          const result = getMessages();
          for (let i = 1; i < result.length; i++) {
            expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain all inserted messages regardless of insertion order', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 1, maxLength: 30 }),
        (messages) => {
          resetState();

          for (const msg of messages) {
            addMessage(msg);
          }

          const result = getMessages();
          expect(result).toHaveLength(messages.length);

          // Every inserted message should be present
          for (const msg of messages) {
            expect(result.find((m) => m.id === msg.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: stt-zipformer-extension, Property 5: Rendered chat message contains all required fields
 *
 * For any ChatMessage with a sender ('user' or 'sesame'), non-empty text, and a valid timestamp,
 * the rendered output SHALL contain the sender label ("You" or "Sesame"), the transcript text,
 * and a formatted timestamp string.
 *
 * Validates: Requirements 5.2
 */
describe('Property 5: Rendered chat message contains all required fields', () => {
  it('should always contain sender label, text, and formatted timestamp', () => {
    fc.assert(
      fc.property(
        chatMessageArb(),
        (message) => {
          const html = renderMessage(message);
          const expectedLabel = getSenderLabel(message.sender);
          const expectedTime = formatTimestamp(message.timestamp);

          expect(html).toContain(expectedLabel);
          expect(html).toContain(message.text);
          expect(html).toContain(expectedTime);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use correct alignment based on sender', () => {
    fc.assert(
      fc.property(
        chatMessageArb(),
        (message) => {
          const html = renderMessage(message);

          if (message.sender === 'user') {
            expect(html).toContain('message--right');
            expect(html).toContain('message--user');
          } else {
            expect(html).toContain('message--left');
            expect(html).toContain('message--sesame');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include message id and segment id as data attributes', () => {
    fc.assert(
      fc.property(
        chatMessageArb(),
        (message) => {
          const html = renderMessage(message);

          expect(html).toContain(`data-id="${message.id}"`);
          expect(html).toContain(`data-segment="${message.segmentId}"`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: stt-zipformer-extension, Property 6: Clipboard format is a faithful representation of the conversation
 *
 * For any non-empty list of ChatMessages, the clipboard-formatted text SHALL contain one line
 * per message in the format "SenderLabel: text", and the lines SHALL appear in the same
 * chronological order as the messages in the session.
 *
 * Validates: Requirements 5.7
 */
describe('Property 6: Clipboard format is a faithful representation of the conversation', () => {
  it('should produce one line per message in "SenderLabel: text" format', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 1, maxLength: 30 }),
        (messages) => {
          const result = formatForClipboard(messages);
          const lines = result.split('\n');

          expect(lines).toHaveLength(messages.length);

          for (const line of lines) {
            // Each line must match "You: ..." or "Sesame: ..."
            expect(
              line.startsWith('You: ') || line.startsWith('Sesame: ')
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should maintain chronological order by timestamp', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 2, maxLength: 30 }),
        (messages) => {
          const result = formatForClipboard(messages);
          const lines = result.split('\n');

          // Sort messages by timestamp to get expected order
          const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);

          for (let i = 0; i < sorted.length; i++) {
            const expectedLabel = sorted[i].sender === 'user' ? 'You' : 'Sesame';
            const expectedLine = `${expectedLabel}: ${sorted[i].text}`;
            expect(lines[i]).toBe(expectedLine);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should contain the exact text of each message', () => {
    fc.assert(
      fc.property(
        fc.array(chatMessageArb(), { minLength: 1, maxLength: 20 }),
        (messages) => {
          const result = formatForClipboard(messages);

          for (const msg of messages) {
            expect(result).toContain(msg.text);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

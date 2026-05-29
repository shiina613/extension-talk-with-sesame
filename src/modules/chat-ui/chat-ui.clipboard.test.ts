import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatForClipboard, copyToClipboard } from './chat-ui.clipboard';
import { ChatMessage, ChatSession } from '@shared/types';

function createTestMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sender: 'user',
    text: 'Hello world',
    timestamp: 1000,
    isFinal: true,
    segmentId: 'seg-1',
    ...overrides,
  };
}

describe('chat-ui.clipboard', () => {
  describe('formatForClipboard', () => {
    it('should format a single user message', () => {
      const messages = [createTestMessage({ sender: 'user', text: 'Hi there' })];
      expect(formatForClipboard(messages)).toBe('You: Hi there');
    });

    it('should format a single sesame message', () => {
      const messages = [createTestMessage({ sender: 'sesame', text: 'Hello!' })];
      expect(formatForClipboard(messages)).toBe('Sesame: Hello!');
    });

    it('should format multiple messages in chronological order', () => {
      const messages = [
        createTestMessage({ sender: 'user', text: 'Hi', timestamp: 100 }),
        createTestMessage({ sender: 'sesame', text: 'Hello', timestamp: 200 }),
        createTestMessage({ sender: 'user', text: 'How are you?', timestamp: 300 }),
      ];

      const result = formatForClipboard(messages);
      expect(result).toBe('You: Hi\nSesame: Hello\nYou: How are you?');
    });

    it('should sort messages by timestamp regardless of insertion order', () => {
      const messages = [
        createTestMessage({ sender: 'sesame', text: 'Second', timestamp: 200 }),
        createTestMessage({ sender: 'user', text: 'First', timestamp: 100 }),
        createTestMessage({ sender: 'sesame', text: 'Third', timestamp: 300 }),
      ];

      const result = formatForClipboard(messages);
      const lines = result.split('\n');
      expect(lines[0]).toBe('You: First');
      expect(lines[1]).toBe('Sesame: Second');
      expect(lines[2]).toBe('Sesame: Third');
    });

    it('should return empty string for empty messages array', () => {
      expect(formatForClipboard([])).toBe('');
    });

    it('should handle messages with same timestamp', () => {
      const messages = [
        createTestMessage({ sender: 'user', text: 'A', timestamp: 100 }),
        createTestMessage({ sender: 'sesame', text: 'B', timestamp: 100 }),
      ];

      const result = formatForClipboard(messages);
      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should not mutate the original messages array', () => {
      const messages = [
        createTestMessage({ sender: 'user', text: 'B', timestamp: 200 }),
        createTestMessage({ sender: 'sesame', text: 'A', timestamp: 100 }),
      ];
      const originalOrder = [...messages];

      formatForClipboard(messages);

      expect(messages[0].timestamp).toBe(originalOrder[0].timestamp);
      expect(messages[1].timestamp).toBe(originalOrder[1].timestamp);
    });
  });

  describe('copyToClipboard', () => {
    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });
    });

    it('should write formatted text to clipboard', async () => {
      const session: ChatSession = {
        id: 'session-1',
        messages: [
          createTestMessage({ sender: 'user', text: 'Hello', timestamp: 100 }),
          createTestMessage({ sender: 'sesame', text: 'Hi!', timestamp: 200 }),
        ],
        startedAt: 100,
        isActive: true,
      };

      await copyToClipboard(session);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'You: Hello\nSesame: Hi!'
      );
    });

    it('should write empty string for session with no messages', async () => {
      const session: ChatSession = {
        id: 'session-1',
        messages: [],
        startedAt: 100,
        isActive: true,
      };

      await copyToClipboard(session);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    });
  });
});

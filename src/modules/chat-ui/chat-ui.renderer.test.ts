import { describe, it, expect } from 'vitest';
import {
  renderMessage,
  renderTypingIndicator,
  formatTimestamp,
  getSenderLabel,
  getAlignmentClass,
  getSenderClass,
} from './chat-ui.renderer';
import { ChatMessage } from '@shared/types';

function createTestMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sender: 'user',
    text: 'Hello world',
    timestamp: new Date('2024-01-15T10:30:00').getTime(),
    isFinal: true,
    segmentId: 'seg-1',
    ...overrides,
  };
}

describe('chat-ui.renderer', () => {
  describe('formatTimestamp', () => {
    it('should format timestamp as HH:MM', () => {
      const ts = new Date('2024-01-15T09:05:00').getTime();
      expect(formatTimestamp(ts)).toBe('09:05');
    });

    it('should pad single-digit hours and minutes', () => {
      const ts = new Date('2024-01-15T01:03:00').getTime();
      expect(formatTimestamp(ts)).toBe('01:03');
    });

    it('should handle midnight', () => {
      const ts = new Date('2024-01-15T00:00:00').getTime();
      expect(formatTimestamp(ts)).toBe('00:00');
    });

    it('should handle end of day', () => {
      const ts = new Date('2024-01-15T23:59:00').getTime();
      expect(formatTimestamp(ts)).toBe('23:59');
    });
  });

  describe('getSenderLabel', () => {
    it('should return "You" for user sender', () => {
      expect(getSenderLabel('user')).toBe('You');
    });

    it('should return "Sesame" for sesame sender', () => {
      expect(getSenderLabel('sesame')).toBe('Sesame');
    });
  });

  describe('getAlignmentClass', () => {
    it('should return right alignment for user', () => {
      expect(getAlignmentClass('user')).toBe('message--right');
    });

    it('should return left alignment for sesame', () => {
      expect(getAlignmentClass('sesame')).toBe('message--left');
    });
  });

  describe('getSenderClass', () => {
    it('should return user class for user sender', () => {
      expect(getSenderClass('user')).toBe('message--user');
    });

    it('should return sesame class for sesame sender', () => {
      expect(getSenderClass('sesame')).toBe('message--sesame');
    });
  });

  describe('renderMessage', () => {
    it('should render user message with "You" label and right alignment', () => {
      const msg = createTestMessage({ sender: 'user', text: 'Hi there' });
      const html = renderMessage(msg);

      expect(html).toContain('You');
      expect(html).toContain('Hi there');
      expect(html).toContain('message--right');
      expect(html).toContain('message--user');
    });

    it('should render sesame message with "Sesame" label and left alignment', () => {
      const msg = createTestMessage({ sender: 'sesame', text: 'Hello!' });
      const html = renderMessage(msg);

      expect(html).toContain('Sesame');
      expect(html).toContain('Hello!');
      expect(html).toContain('message--left');
      expect(html).toContain('message--sesame');
    });

    it('should include formatted timestamp', () => {
      const msg = createTestMessage({
        timestamp: new Date('2024-01-15T14:25:00').getTime(),
      });
      const html = renderMessage(msg);

      expect(html).toContain('14:25');
    });

    it('should include message id as data attribute', () => {
      const msg = createTestMessage({ id: 'test-id-123' });
      const html = renderMessage(msg);

      expect(html).toContain('data-id="test-id-123"');
    });

    it('should include segment id as data attribute', () => {
      const msg = createTestMessage({ segmentId: 'seg-abc' });
      const html = renderMessage(msg);

      expect(html).toContain('data-segment="seg-abc"');
    });

    it('should contain all required elements: sender label, text, timestamp', () => {
      const msg = createTestMessage({
        sender: 'sesame',
        text: 'Test message content',
        timestamp: new Date('2024-06-01T08:15:00').getTime(),
      });
      const html = renderMessage(msg);

      expect(html).toContain('message__sender');
      expect(html).toContain('message__text');
      expect(html).toContain('message__timestamp');
      expect(html).toContain('Sesame');
      expect(html).toContain('Test message content');
      expect(html).toContain('08:15');
    });
  });

  describe('renderTypingIndicator', () => {
    it('should render with typing class', () => {
      const html = renderTypingIndicator('seg-1', 'partial text');

      expect(html).toContain('message--typing');
    });

    it('should render with left alignment (sesame style)', () => {
      const html = renderTypingIndicator('seg-1', 'partial');

      expect(html).toContain('message--left');
      expect(html).toContain('message--sesame');
    });

    it('should include the interim text', () => {
      const html = renderTypingIndicator('seg-1', 'hello wor');

      expect(html).toContain('hello wor');
    });

    it('should include segment id as data attribute', () => {
      const html = renderTypingIndicator('seg-xyz', 'text');

      expect(html).toContain('data-segment="seg-xyz"');
    });

    it('should include typing dots indicator', () => {
      const html = renderTypingIndicator('seg-1', 'text');

      expect(html).toContain('message__typing-dots');
    });

    it('should show "Sesame" as sender label', () => {
      const html = renderTypingIndicator('seg-1', 'text');

      expect(html).toContain('Sesame');
    });
  });
});

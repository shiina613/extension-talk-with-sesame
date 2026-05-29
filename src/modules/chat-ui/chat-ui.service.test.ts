import { describe, it, expect, beforeEach } from 'vitest';
import {
  addMessage,
  updateInterim,
  finalizeMessage,
  clearSession,
  startNewSession,
  getCurrentSession,
  getPreviousSessions,
  getMessages,
  resetState,
} from './chat-ui.service';
import { ChatMessage } from '@shared/types';

function createTestMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    sender: 'user',
    text: 'hello',
    timestamp: Date.now(),
    isFinal: false,
    segmentId: 'seg-1',
    ...overrides,
  };
}

describe('ChatUIService', () => {
  beforeEach(() => {
    resetState();
  });

  describe('addMessage', () => {
    it('should add a message to the current session', () => {
      const msg = createTestMessage();
      addMessage(msg);
      expect(getMessages()).toHaveLength(1);
      expect(getMessages()[0]).toBe(msg);
    });

    it('should insert messages in chronological order by timestamp', () => {
      const msg1 = createTestMessage({ timestamp: 100, text: 'first' });
      const msg2 = createTestMessage({ timestamp: 300, text: 'third' });
      const msg3 = createTestMessage({ timestamp: 200, text: 'second' });

      addMessage(msg1);
      addMessage(msg2);
      addMessage(msg3);

      const messages = getMessages();
      expect(messages[0].text).toBe('first');
      expect(messages[1].text).toBe('second');
      expect(messages[2].text).toBe('third');
    });

    it('should insert at the beginning when timestamp is earliest', () => {
      const msg1 = createTestMessage({ timestamp: 200 });
      const msg2 = createTestMessage({ timestamp: 100 });

      addMessage(msg1);
      addMessage(msg2);

      expect(getMessages()[0].timestamp).toBe(100);
      expect(getMessages()[1].timestamp).toBe(200);
    });
  });

  describe('updateInterim', () => {
    it('should update text of a non-final message with matching segmentId', () => {
      const msg = createTestMessage({ segmentId: 'seg-1', isFinal: false });
      addMessage(msg);

      updateInterim('seg-1', 'updated text');

      expect(getMessages()[0].text).toBe('updated text');
    });

    it('should not update a finalized message', () => {
      const msg = createTestMessage({ segmentId: 'seg-1', isFinal: true, text: 'original' });
      addMessage(msg);

      updateInterim('seg-1', 'should not change');

      expect(getMessages()[0].text).toBe('original');
    });

    it('should do nothing if segmentId not found', () => {
      const msg = createTestMessage({ segmentId: 'seg-1' });
      addMessage(msg);

      updateInterim('seg-unknown', 'new text');

      expect(getMessages()[0].text).toBe('hello');
    });
  });

  describe('finalizeMessage', () => {
    it('should mark a non-final message as final', () => {
      const msg = createTestMessage({ segmentId: 'seg-1', isFinal: false });
      addMessage(msg);

      finalizeMessage('seg-1');

      expect(getMessages()[0].isFinal).toBe(true);
    });

    it('should do nothing if segmentId not found', () => {
      const msg = createTestMessage({ segmentId: 'seg-1', isFinal: false });
      addMessage(msg);

      finalizeMessage('seg-unknown');

      expect(getMessages()[0].isFinal).toBe(false);
    });

    it('should not affect already finalized messages', () => {
      const msg = createTestMessage({ segmentId: 'seg-1', isFinal: true });
      addMessage(msg);

      // Should not throw or cause issues
      finalizeMessage('seg-1');

      expect(getMessages()[0].isFinal).toBe(true);
    });
  });

  describe('clearSession', () => {
    it('should remove all messages from current session', () => {
      addMessage(createTestMessage());
      addMessage(createTestMessage());

      clearSession();

      expect(getMessages()).toHaveLength(0);
    });

    it('should keep the session object intact', () => {
      const sessionBefore = getCurrentSession();
      addMessage(createTestMessage());

      clearSession();

      expect(getCurrentSession().id).toBe(sessionBefore.id);
    });
  });

  describe('startNewSession', () => {
    it('should create a new active session', () => {
      const oldSession = getCurrentSession();
      const newSession = startNewSession();

      expect(newSession.id).not.toBe(oldSession.id);
      expect(newSession.isActive).toBe(true);
      expect(newSession.messages).toHaveLength(0);
    });

    it('should preserve the previous session', () => {
      const oldSession = getCurrentSession();
      addMessage(createTestMessage());

      startNewSession();

      const previous = getPreviousSessions();
      expect(previous).toHaveLength(1);
      expect(previous[0].id).toBe(oldSession.id);
      expect(previous[0].messages).toHaveLength(1);
    });

    it('should mark previous session as inactive', () => {
      startNewSession();

      const previous = getPreviousSessions();
      expect(previous[0].isActive).toBe(false);
    });

    it('should accumulate multiple previous sessions', () => {
      startNewSession();
      startNewSession();
      startNewSession();

      expect(getPreviousSessions()).toHaveLength(3);
    });
  });
});

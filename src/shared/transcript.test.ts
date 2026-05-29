import { describe, it, expect, beforeEach } from 'vitest';
import { applyTranscriptToStore, liveSegmentId } from './transcript';
import type { ChatMessage, TranscriptResult } from './types';

describe('applyTranscriptToStore', () => {
  let messages: ChatMessage[];

  const store = {
    getMessages: () => messages,
    addMessage: (m: ChatMessage) => messages.push(m),
    updateInterim: (segmentId: string, text: string) => {
      const m = messages.find((x) => x.segmentId === segmentId && !x.isFinal);
      if (m) m.text = text;
    },
    finalizeMessage: (segmentId: string) => {
      const m = messages.find((x) => x.segmentId === segmentId && !x.isFinal);
      if (m) m.isFinal = true;
    },
    removeBySegmentId: (segmentId: string) => {
      messages = messages.filter((m) => m.segmentId !== segmentId);
    },
  };

  beforeEach(() => {
    messages = [];
  });

  it('keeps one live interim per source', () => {
    const base: Omit<TranscriptResult, 'text' | 'isFinal'> = {
      source: 'tab',
      timestamp: 1,
      segmentId: 'tab-0',
    };

    applyTranscriptToStore({ ...base, text: 'HELLO', isFinal: false }, store);
    applyTranscriptToStore({ ...base, text: 'HELLO WORLD', isFinal: false }, store);

    expect(messages).toHaveLength(1);
    expect(messages[0].segmentId).toBe(liveSegmentId('tab'));
    expect(messages[0].text).toBe('HELLO WORLD');
  });

  it('replaces live interim with final segment', () => {
    applyTranscriptToStore(
      { source: 'tab', timestamp: 1, segmentId: 'tab-0', text: 'DRAFT', isFinal: false },
      store,
    );
    applyTranscriptToStore(
      { source: 'tab', timestamp: 2, segmentId: 'tab-0', text: 'FINAL TEXT', isFinal: true },
      store,
    );

    expect(messages.some((m) => m.segmentId === liveSegmentId('tab'))).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].segmentId).toBe('tab-0');
    expect(messages[0].text).toBe('FINAL TEXT');
    expect(messages[0].isFinal).toBe(true);
  });
});

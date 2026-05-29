import type { ChatMessage, TranscriptResult } from './types';

/** One in-progress caption per audio source (avoids many interim bubbles). */
export function liveSegmentId(source: TranscriptResult['source']): string {
  return `${source}-live`;
}

export function transcriptToChatMessage(data: TranscriptResult): ChatMessage {
  return {
    id: `${data.source}-${data.segmentId}-${data.timestamp}`,
    sender: data.source === 'mic' ? 'user' : 'sesame',
    text: data.text,
    timestamp: data.timestamp,
    isFinal: data.isFinal,
    segmentId: data.isFinal ? data.segmentId : liveSegmentId(data.source),
  };
}

export interface TranscriptMessageStore {
  getMessages(): ChatMessage[];
  addMessage(message: ChatMessage): void;
  updateInterim(segmentId: string, text: string): void;
  finalizeMessage(segmentId: string): void;
  removeBySegmentId(segmentId: string): void;
}

/** Apply a streaming transcript to the session; returns the message for UI sync. */
export function applyTranscriptToStore(
  data: TranscriptResult,
  store: TranscriptMessageStore,
): ChatMessage {
  if (data.isFinal) {
    store.removeBySegmentId(liveSegmentId(data.source));

    const finalMsg: ChatMessage = {
      id: `${data.source}-${data.segmentId}-${data.timestamp}`,
      sender: data.source === 'mic' ? 'user' : 'sesame',
      text: data.text,
      timestamp: data.timestamp,
      isFinal: true,
      segmentId: data.segmentId,
    };

    const existing = store.getMessages().find((m) => m.segmentId === data.segmentId);
    if (existing) {
      store.updateInterim(data.segmentId, finalMsg.text);
      store.finalizeMessage(data.segmentId);
    } else {
      store.addMessage(finalMsg);
    }
    return finalMsg;
  }

  const interimMsg = transcriptToChatMessage(data);
  const existing = store
    .getMessages()
    .find((m) => m.segmentId === interimMsg.segmentId && !m.isFinal);
  if (existing) {
    store.updateInterim(interimMsg.segmentId, interimMsg.text);
  } else {
    store.addMessage(interimMsg);
  }
  return interimMsg;
}

// Chat UI service - Session and message management

import { ChatMessage, ChatSession } from '@shared/types';

let currentSession: ChatSession = createSession();
let previousSessions: ChatSession[] = [];

function createSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    messages: [],
    startedAt: Date.now(),
    isActive: true,
  };
}

function findInsertIndex(messages: ChatMessage[], timestamp: number): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].timestamp <= timestamp) return i + 1;
  }
  return 0;
}

export function addMessage(message: ChatMessage): void {
  const index = findInsertIndex(currentSession.messages, message.timestamp);
  currentSession.messages.splice(index, 0, message);
}

export function updateInterim(segmentId: string, text: string): void {
  const message = currentSession.messages.find(
    (m) => m.segmentId === segmentId && !m.isFinal
  );
  if (!message) return;
  message.text = text;
}

export function finalizeMessage(segmentId: string): void {
  const message = currentSession.messages.find(
    (m) => m.segmentId === segmentId && !m.isFinal
  );
  if (!message) return;
  message.isFinal = true;
}

export function removeBySegmentId(segmentId: string): void {
  currentSession.messages = currentSession.messages.filter(
    (m) => m.segmentId !== segmentId,
  );
}

export function clearSession(): void {
  currentSession.messages = [];
}

export function startNewSession(): ChatSession {
  currentSession.isActive = false;
  previousSessions.push(currentSession);
  currentSession = createSession();
  return currentSession;
}

export function getCurrentSession(): ChatSession {
  return currentSession;
}

export function getPreviousSessions(): ChatSession[] {
  return previousSessions;
}

export function getMessages(): ChatMessage[] {
  return currentSession.messages;
}

/** Replace popup session messages with copies from the service worker */
export function loadMessages(messages: ChatMessage[]): void {
  currentSession.messages = messages.map((m) => ({ ...m }));
}

// Reset state - useful for testing
export function resetState(): void {
  currentSession = createSession();
  previousSessions = [];
}

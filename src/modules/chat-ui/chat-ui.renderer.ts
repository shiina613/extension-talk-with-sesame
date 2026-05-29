// Chat UI renderer - Produces HTML for chat messages and typing indicators

import { ChatMessage } from '@shared/types';

/**
 * Format a timestamp (ms since epoch) into a human-readable time string (HH:MM).
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Get the display label for a sender.
 */
export function getSenderLabel(sender: 'user' | 'sesame'): string {
  return sender === 'user' ? 'You' : 'Sesame';
}

/**
 * Get the CSS alignment class for a sender.
 * User messages are right-aligned, Sesame messages are left-aligned.
 */
export function getAlignmentClass(sender: 'user' | 'sesame'): string {
  return sender === 'user' ? 'message--right' : 'message--left';
}

/**
 * Get the CSS color class for a sender.
 */
export function getSenderClass(sender: 'user' | 'sesame'): string {
  return sender === 'user' ? 'message--user' : 'message--sesame';
}

/**
 * Render a chat message as an HTML string.
 * Includes sender label, text content, and formatted timestamp.
 */
export function renderMessage(message: ChatMessage): string {
  const label = getSenderLabel(message.sender);
  const alignment = getAlignmentClass(message.sender);
  const senderClass = getSenderClass(message.sender);
  const time = formatTimestamp(message.timestamp);

  return `<div class="message ${alignment} ${senderClass}" data-id="${message.id}" data-segment="${message.segmentId}">
  <span class="message__sender">${label}</span>
  <p class="message__text">${message.text}</p>
  <span class="message__timestamp">${time}</span>
</div>`;
}

/**
 * Render a typing indicator for an interim (partial) transcript result.
 * Displayed as a typing bubble with the current partial text.
 */
export function renderTypingIndicator(segmentId: string, text: string): string {
  return `<div class="message message--left message--sesame message--typing" data-segment="${segmentId}">
  <span class="message__sender">Sesame</span>
  <p class="message__text">${text}</p>
  <span class="message__typing-dots"><span>.</span><span>.</span><span>.</span></span>
</div>`;
}

// Chat UI clipboard formatter - Formats chat messages for clipboard export

import { ChatMessage, ChatSession } from '@shared/types';

/**
 * Get the display label for a sender for clipboard output.
 */
function senderLabel(sender: 'user' | 'sesame'): string {
  return sender === 'user' ? 'You' : 'Sesame';
}

/**
 * Format a list of chat messages for clipboard export.
 * Produces text in format "You: ...\nSesame: ..." in chronological order.
 * Messages are sorted by timestamp ascending before formatting.
 */
export function formatForClipboard(messages: ChatMessage[]): string {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  return sorted
    .map((msg) => `${senderLabel(msg.sender)}: ${msg.text}`)
    .join('\n');
}

/**
 * Copy the full conversation transcript to the system clipboard.
 * Uses the Clipboard API to write formatted text.
 */
export async function copyToClipboard(session: ChatSession): Promise<void> {
  const text = formatForClipboard(session.messages);
  await navigator.clipboard.writeText(text);
}

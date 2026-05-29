// Chat UI module - Transcript display and session management
// Public API

export {
  addMessage,
  updateInterim,
  finalizeMessage,
  clearSession,
  startNewSession,
  getCurrentSession,
  getPreviousSessions,
  getMessages,
  loadMessages,
  resetState,
  removeBySegmentId,
} from './chat-ui.service';

export {
  renderMessage,
  renderTypingIndicator,
  formatTimestamp,
  getSenderLabel,
  getAlignmentClass,
  getSenderClass,
} from './chat-ui.renderer';

export { formatForClipboard, copyToClipboard } from './chat-ui.clipboard';

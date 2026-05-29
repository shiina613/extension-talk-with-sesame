/** A single chat message in the transcript */
export interface ChatMessage {
  id: string;
  sender: 'user' | 'sesame';
  text: string;
  timestamp: number;
  isFinal: boolean;
  segmentId: string;
}

/** A conversation session containing messages */
export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  startedAt: number;
  isActive: boolean;
}

/** Current UI state for the popup */
export interface UIState {
  session: ChatSession;
  serverStatus: 'stopped' | 'starting' | 'ready' | 'error';
  micRecording: boolean;
  tabRecording: boolean;
  conversationMode: boolean;
}

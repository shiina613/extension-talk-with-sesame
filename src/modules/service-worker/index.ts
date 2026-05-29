// Service Worker module - Orchestrator
// Public API

export {
  getState,
  updateState,
  initializeState,
  registerMessageListeners,
  ensureOffscreenDocument,
  closeOffscreenDocument,
  sendOffscreenCommand,
  startHealthCheckIntegration,
  deactivate,
  getHealthChecker,
} from './service-worker';

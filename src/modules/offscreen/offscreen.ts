/**
 * Offscreen Document entry point.
 *
 * Listens for OffscreenCommand messages from the service worker and
 * orchestrates audio capture (mic/tab) through AudioProcessorService
 * and WebSocket streaming to the STT server.
 */

import type {
  OffscreenCommand,
  OffscreenCommandResponse,
  OffscreenEvent,
} from '../../shared/types';
import { OffscreenOrchestrator } from './offscreen.orchestrator';

console.log('[offscreen] Offscreen document loaded');

const orchestrator = new OffscreenOrchestrator();

/**
 * Send an OffscreenEvent back to the service worker.
 */
function sendEvent(event: OffscreenEvent): void {
  chrome.runtime.sendMessage(event).catch((err) => {
    console.error('[offscreen] Failed to send event:', err);
  });
}

// Wire orchestrator events to service worker messages
orchestrator.onEvent(sendEvent);

const COMMAND_TYPES = new Set([
  'start-mic',
  'start-tab',
  'stop-mic',
  'stop-tab',
  'stop-all',
]);

/**
 * Handle incoming OffscreenCommand messages from the service worker.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return false;
  }

  const command = message as OffscreenCommand;
  if (!COMMAND_TYPES.has(command.type)) {
    return false;
  }

  console.log('[offscreen] Received command:', command.type);

  handleCommand(command)
    .then((response) => {
      console.log('[offscreen] Command finished:', command.type, response);
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[offscreen] Command failed:', command.type, errorMessage);
      sendResponse({ ok: false, error: errorMessage } satisfies OffscreenCommandResponse);
    });

  return true;
});

async function handleCommand(command: OffscreenCommand): Promise<OffscreenCommandResponse> {
  switch (command.type) {
    case 'start-mic': {
      const result = await orchestrator.startMic(command.config, command.serverUrl);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case 'start-tab': {
      const result = await orchestrator.startTab(
        command.streamId,
        command.config,
        command.serverUrl,
      );
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    case 'stop-mic':
      await orchestrator.stopMic();
      return { ok: true };
    case 'stop-tab':
      await orchestrator.stopTab();
      return { ok: true };
    case 'stop-all':
      await orchestrator.stopAll();
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown command' };
  }
}

/** Whether Chrome tabCapture can attach to this URL. */
export function isCapturablePageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

export function formatTabCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/permission dismissed/i.test(message)) {
    return 'Tab audio cancelled — click again, then choose Share tab audio';
  }
  if (/permission denied|not allowed/i.test(message)) {
    return 'Tab audio denied — allow in the Chrome prompt';
  }
  if (/active stream|already captur/i.test(message)) {
    return 'Tab audio is busy — stop Tab/Conversation, wait a second, try again';
  }
  if (/invoked for the current page|activeTab|extension must be invoked/i.test(message)) {
    return 'Click the extension icon on the YouTube tab you want, then try Conversation again';
  }
  if (/chrome:\/\/|chrome-extension:|edge:\/\/|about:|webstore/i.test(message)) {
    return 'Cannot capture browser internal pages — open YouTube (https://) first';
  }
  if (/cannot capture/i.test(message)) {
    return `Tab capture failed: ${message}`;
  }
  return `Tab capture: ${message}`;
}

export function validateTabForCapture(tab: chrome.tabs.Tab): void {
  if (!tab.id) {
    throw new Error('No active tab found');
  }
  const url = tab.url ?? '';
  if (isCapturablePageUrl(url)) {
    return;
  }
  let host = 'this page';
  try {
    if (url) host = new URL(url).hostname || host;
  } catch {
    // ignore invalid URL
  }
  if (/^(chrome|edge|about|chrome-extension):/i.test(url)) {
    throw new Error(
      `Cannot capture ${host} — open YouTube (or your target site), then click the extension icon on that tab`,
    );
  }
  throw new Error(`Page not ready (${host}) — wait until the tab finishes loading`);
}

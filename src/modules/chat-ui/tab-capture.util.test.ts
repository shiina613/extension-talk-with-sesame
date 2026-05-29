import { describe, it, expect } from 'vitest';
import {
  formatTabCaptureError,
  isCapturablePageUrl,
  validateTabForCapture,
} from './tab-capture.util';

describe('tab-capture.util', () => {
  describe('isCapturablePageUrl', () => {
    it('accepts https pages', () => {
      expect(isCapturablePageUrl('https://www.youtube.com/watch?v=1')).toBe(true);
    });

    it('rejects chrome internal pages', () => {
      expect(isCapturablePageUrl('chrome://extensions')).toBe(false);
    });
  });

  describe('formatTabCaptureError', () => {
    it('maps active stream errors to a retry hint', () => {
      expect(
        formatTabCaptureError(new Error('Cannot capture a tab with an active stream')),
      ).toMatch(/busy/i);
    });

    it('does not mislabel active stream as chrome:// page', () => {
      const msg = formatTabCaptureError(
        new Error('Cannot capture a tab with an active stream'),
      );
      expect(msg).not.toMatch(/chrome:\/\/ pages/i);
    });

    it('maps permission dismissed', () => {
      expect(formatTabCaptureError(new Error('Permission dismissed'))).toMatch(/cancelled/i);
    });
  });

  describe('validateTabForCapture', () => {
    it('allows YouTube tabs', () => {
      expect(() =>
        validateTabForCapture({
          id: 1,
          url: 'https://www.youtube.com/watch?v=abc',
        } as chrome.tabs.Tab),
      ).not.toThrow();
    });

    it('rejects chrome:// tabs with a clear message', () => {
      expect(() =>
        validateTabForCapture({
          id: 1,
          url: 'chrome://extensions',
        } as chrome.tabs.Tab),
      ).toThrow(/YouTube/i);
    });
  });
});

/**
 * Vitest global setup — polyfills browser APIs missing in Node.
 */

if (typeof globalThis.CloseEvent === 'undefined') {
  class CloseEventPolyfill extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;

    constructor(
      type: string,
      eventInitDict?: { code?: number; reason?: string; wasClean?: boolean },
    ) {
      super(type);
      this.code = eventInitDict?.code ?? 0;
      this.reason = eventInitDict?.reason ?? '';
      this.wasClean = eventInitDict?.wasClean ?? false;
    }
  }
  globalThis.CloseEvent = CloseEventPolyfill as typeof CloseEvent;
}

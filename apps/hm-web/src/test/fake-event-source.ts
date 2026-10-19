import type { EventSourceLike } from "../events/sse";

/** An EventSource the test drives by hand. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** The browser is retrying by itself. */
  dropRetrying() {
    this.readyState = 0;
    this.onerror?.();
  }
  /** The browser gave up (a 401, a 502 while the server restarts). */
  dropClosed() {
    this.readyState = 2;
    this.onerror?.();
  }
  emit(type: string, data: string, lastEventId = "") {
    this.listeners.get(type)?.(new MessageEvent(type, { data, lastEventId }));
  }
}

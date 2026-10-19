export type SseStatus = "connecting" | "open" | "reconnecting" | "closed";

/** The slice of the browser's EventSource that is used, so tests can supply a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface EventSourceConstructor {
  new (url: string): EventSourceLike;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EventsOptions {
  url: string;
  /** Names of the SSE `event:` fields to listen to (the server names each event by its type). */
  eventTypes: readonly string[];
  /** Asks the server something cheap, for its HTTP status (0 when it did not answer). */
  probe: () => Promise<number>;
  onEvent: (type: string, data: string, lastEventId: string) => void;
  onStatus: (status: SseStatus) => void;
  /** After a drop and a reconnection, events may have been missed: refetch what is on screen. */
  onResync: () => void;
  /** The probe got a 401: the session is gone and retrying is pointless. */
  onUnauthorized: () => void;
  EventSource?: EventSourceConstructor;
  clock?: Clock;
  /** In [0, 1): the share of `JITTER_MS` added to each retry delay. */
  random?: () => number;
}

export interface EventsConnection {
  readonly status: SseStatus;
  close(): void;
}

const READY_CLOSED = 2;
const BASE_MS = 1_000;
const MAX_MS = 30_000;
const JITTER_MS = 1_000;

/**
 * A native EventSource reconnects by itself after a network drop and sends Last-Event-ID, but when
 * the answer is not a 200 (a 401, or a 502 while the server restarts) it gives up for good. This
 * recreates it after a backoff, checking with `probe` first so an expired session stops the loop
 * instead of hammering the server.
 */
export function connectEvents(options: EventsOptions): EventsConnection {
  const Source = options.EventSource ?? (globalThis.EventSource as EventSourceConstructor);
  const clock: Clock = options.clock ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  };
  const random = options.random ?? Math.random;

  let status: SseStatus = "connecting";
  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let dropped = false;
  let disposed = false;

  function setStatus(next: SseStatus) {
    if (status === next) return;
    status = next;
    options.onStatus(next);
  }

  function open() {
    const current = new Source(options.url);
    source = current;
    const alive = () => !disposed && source === current;

    current.onopen = () => {
      if (!alive()) return;
      attempt = 0;
      setStatus("open");
      if (dropped) {
        dropped = false;
        options.onResync();
      }
    };
    current.onerror = () => {
      if (!alive()) return;
      dropped = true;
      setStatus("reconnecting");
      // Still CONNECTING: the browser is retrying on its own, nothing to do.
      if (current.readyState === READY_CLOSED) schedule();
    };
    for (const type of ["message", ...options.eventTypes]) {
      current.addEventListener(type, (event) => {
        if (alive()) options.onEvent(type, event.data, event.lastEventId);
      });
    }
  }

  function schedule() {
    const delay = Math.min(MAX_MS, BASE_MS * 2 ** attempt) + Math.floor(random() * JITTER_MS);
    attempt += 1;
    timer = clock.setTimeout(() => void retry(), delay);
  }

  async function retry() {
    timer = null;
    if (disposed) return;
    const code = await options.probe().catch(() => 0);
    if (disposed) return;
    if (code === 401) {
      dispose();
      options.onUnauthorized();
    } else if (code >= 200 && code < 300) {
      open();
    } else {
      schedule();
    }
  }

  function dispose() {
    disposed = true;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    setStatus("closed");
  }

  options.onStatus(status);
  open();

  return {
    get status() {
      return status;
    },
    close: dispose,
  };
}

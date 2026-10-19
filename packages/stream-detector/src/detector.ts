import {
  classifyPlaylistBody,
  classifyRequest,
  pickBest,
  type Candidate,
  type StreamKind,
} from "./candidates.ts";
import { Semaphore } from "./semaphore.ts";

/** Structurally the same as hm-server's `DetectedStream`; declared here so there is no import cycle. */
export interface DetectedStream {
  url: string;
  kind: StreamKind;
  headers: Record<string, string>;
}

/** Why a detection failed. `timeout` and `navigation` are worth retrying; `aborted` is not. */
export class StreamDetectionError extends Error {
  readonly reason: "timeout" | "navigation" | "aborted";

  constructor(reason: StreamDetectionError["reason"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StreamDetectionError";
    this.reason = reason;
  }

  /** hm-server maps `true` to its RetryableError and `false` to AbortedError. */
  get retryable(): boolean {
    return this.reason !== "aborted";
  }
}

/** The slice of Playwright this adapter uses; tests fake it, `playwright` satisfies it. */
export interface RequestLike {
  url(): string;
  resourceType(): string;
  allHeaders(): Promise<Record<string, string>>;
}
export interface ResponseLike {
  request(): RequestLike;
  headers(): Record<string, string>;
  text(): Promise<string>;
}
export interface PageLike {
  on(event: "request", listener: (request: RequestLike) => void): void;
  on(event: "response", listener: (response: ResponseLike) => void): void;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
}
export interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
export interface BrowserLike {
  newContext(options: { userAgent?: string }): Promise<ContextLike>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  args?: string[];
}

export interface PlaywrightStreamDetectorOptions {
  /** How many pages may be open at the same time. */
  maxConcurrent: number;
  /** Give up when no manifest has been requested after this long. */
  timeoutMs: number;
  /** After the first candidate, keep listening this long so a master can overtake a variant. */
  settleMs: number;
  userAgent?: string;
  launchOptions?: LaunchOptions;
  /** Replaces the Playwright launch. Meant for tests. */
  launch?: () => Promise<BrowserLike>;
}

/** The only request headers a downloader needs to be let through; the rest is browser noise. */
const FORWARDED_HEADERS = ["Referer", "Cookie", "Origin", "User-Agent"] as const;

function forwardedHeaders(all: Record<string, string>): Record<string, string> {
  const lower = new Map(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
  const out: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = lower.get(name.toLowerCase());
    if (value !== undefined) out[name] = value;
  }
  return out;
}

async function defaultLaunch(options: LaunchOptions | undefined): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  return (await chromium.launch({ headless: true, ...options })) as unknown as BrowserLike;
}

/** Watches what a page requests inside a headless Chromium and returns the streams it found. */
export class PlaywrightStreamDetector {
  private readonly semaphore: Semaphore;
  private browser: Promise<BrowserLike> | null = null;
  private readonly options: PlaywrightStreamDetectorOptions;

  constructor(options: PlaywrightStreamDetectorOptions) {
    this.options = options;
    this.semaphore = new Semaphore(options.maxConcurrent);
  }

  async detect(pageUrl: string, { signal }: { signal: AbortSignal }): Promise<DetectedStream[]> {
    const aborted = () =>
      new StreamDetectionError("aborted", "Stream detection aborted", { cause: signal.reason });
    if (signal.aborted) throw aborted();

    let release: () => void;
    try {
      release = await this.semaphore.acquire(signal);
    } catch {
      throw aborted();
    }
    let closeContext: (() => Promise<void>) | undefined;
    try {
      if (signal.aborted) throw aborted();
      const browser = await this.launched();
      const context = await browser.newContext(
        this.options.userAgent === undefined ? {} : { userAgent: this.options.userAgent },
      );
      // One close per context, whoever asks first: the abort handler or the cleanup below.
      let closing: Promise<void> | undefined;
      closeContext = () => (closing ??= context.close().catch(() => undefined));
      const found = await this.watch(context, closeContext, pageUrl, signal, aborted);
      return pickBest(found).map(({ url, kind, headers }) => ({ url, kind, headers }));
    } finally {
      await closeContext?.();
      release();
    }
  }

  /** Closes the shared browser. Call it when the server stops. */
  async dispose(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser).close();
  }

  private launched(): Promise<BrowserLike> {
    this.browser ??= (this.options.launch ?? (() => defaultLaunch(this.options.launchOptions)))();
    this.browser.catch(() => {
      this.browser = null;
    });
    return this.browser;
  }

  private async watch(
    context: ContextLike,
    closeContext: () => Promise<void>,
    pageUrl: string,
    signal: AbortSignal,
    aborted: () => StreamDetectionError,
  ): Promise<Candidate[]> {
    const page = await context.newPage();
    const { timeoutMs, settleMs } = this.options;

    return new Promise<Candidate[]>((resolve, reject) => {
      const found = new Map<string, Candidate>();
      const pending = new Set<Promise<unknown>>();
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      let done = false;

      const finish = (outcome: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        clearTimeout(settleTimer);
        signal.removeEventListener("abort", onAbort);
        outcome();
      };
      const onAbort = () => {
        void closeContext();
        finish(() => reject(aborted()));
      };
      const deadline = setTimeout(() => {
        finish(() =>
          reject(
            new StreamDetectionError(
              "timeout",
              `No media stream requested by ${pageUrl} within ${timeoutMs} ms`,
            ),
          ),
        );
      }, timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });

      const track = (work: Promise<unknown>) => {
        pending.add(work);
        void work.finally(() => pending.delete(work));
      };
      const startSettling = () => {
        if (settleTimer !== undefined) return;
        settleTimer = setTimeout(() => {
          void Promise.allSettled([...pending]).then(() =>
            finish(() => resolve([...found.values()])),
          );
        }, settleMs);
      };
      const register = (request: RequestLike, kind: StreamKind): Candidate => {
        const url = request.url();
        let candidate = found.get(url);
        if (!candidate) {
          candidate = { url, kind, playlist: "unknown", headers: {} };
          found.set(url, candidate);
          const entry = candidate;
          track(
            request
              .allHeaders()
              .then((all) => {
                entry.headers = forwardedHeaders(all);
              })
              .catch(() => undefined),
          );
          startSettling();
        }
        return candidate;
      };

      page.on("request", (request) => {
        const kind = classifyRequest({ url: request.url(), resourceType: request.resourceType() });
        if (kind) register(request, kind);
      });
      page.on("response", (response) => {
        const request = response.request();
        const kind = classifyRequest({
          url: request.url(),
          resourceType: request.resourceType(),
          contentType: response.headers()["content-type"],
        });
        if (!kind) return;
        const candidate = register(request, kind);
        if (kind !== "hls") return;
        track(
          response
            .text()
            .then((body) => {
              candidate.playlist = classifyPlaylistBody(body);
            })
            .catch(() => undefined),
        );
      });

      page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch((cause) => {
        if (found.size > 0) return;
        finish(() =>
          reject(new StreamDetectionError("navigation", `Could not open ${pageUrl}`, { cause })),
        );
      });
    });
  }
}

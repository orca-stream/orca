import {
  adMediaUrls,
  classifyPlaylistBody,
  classifyRequest,
  mayDescribeAds,
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

/**
 * Why a detection failed. `timeout`, `navigation` and `browser` (it died or could not open a page)
 * are worth retrying; `aborted` and `blocked` (the address is not allowed) are not.
 */
export class StreamDetectionError extends Error {
  readonly reason: "timeout" | "navigation" | "browser" | "aborted" | "blocked";

  constructor(reason: StreamDetectionError["reason"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StreamDetectionError";
    this.reason = reason;
  }

  /** hm-server maps `true` to its RetryableError; an abort becomes AbortedError, a block permanent. */
  get retryable(): boolean {
    return this.reason !== "aborted" && this.reason !== "blocked";
  }
}

/** The slice of Playwright this adapter uses; tests fake it, `playwright` satisfies it. */
export interface RequestLike {
  url(): string;
  resourceType(): string;
  allHeaders(): Promise<Record<string, string>>;
  /** The request this one is a redirect of. Absent in fakes that don't redirect. */
  redirectedFrom?(): RequestLike | null;
}
export interface ResponseLike {
  request(): RequestLike;
  headers(): Record<string, string>;
  text(): Promise<string>;
}
/** A request the browser is about to make, as a route handler sees it. */
export interface RouteLike {
  request(): { url(): string };
  continue(): Promise<unknown>;
  abort(errorCode?: string): Promise<unknown>;
}
export interface WebSocketRouteLike {
  url(): string;
  connectToServer(): unknown;
  close(): unknown;
}
export interface PageLike {
  on(event: "request", listener: (request: RequestLike) => void): void;
  on(event: "response", listener: (response: ResponseLike) => void): void;
  /** A window the page opens (players open ads on the first click). */
  on(event: "popup", listener: (popup: { close(): Promise<unknown> }) => void): void;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number; referer?: string },
  ): Promise<unknown>;
  /** Clicks for players that wait for one before they play. Absent in fakes that don't need it. */
  mouse?: { click(x: number, y: number): Promise<unknown> };
}
export interface ContextLike {
  newPage(): Promise<PageLike>;
  route(url: string, handler: (route: RouteLike) => Promise<void> | void): Promise<unknown>;
  routeWebSocket(url: string, handler: (ws: WebSocketRouteLike) => void): Promise<unknown>;
  close(): Promise<void>;
}
export interface BrowserLike {
  /** Fires when the browser process dies or is closed from outside. */
  on?(event: "disconnected", listener: () => void): unknown;
  newContext(options: {
    userAgent?: string;
    serviceWorkers?: "allow" | "block";
  }): Promise<ContextLike>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  args?: string[];
  proxy?: { server: string; bypass?: string; username?: string; password?: string };
}

/** Chromium switches that would let a page or the launcher go around the proxy. */
const FORBIDDEN_ARGS = ["--no-proxy-server", "--proxy-bypass-list", "--proxy-server"];
/** Keeps WebRTC from opening UDP sockets (and learning addresses) around the proxy. */
const WEBRTC_ARGS = [
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy",
];

/**
 * How Chromium is started: everything through the guarded proxy, with `<-loopback>` so that loopback
 * addresses go through it too (Chromium otherwise sends them straight out), and nothing in the
 * caller's own arguments able to undo that.
 */
export function buildLaunchOptions(
  base: Pick<LaunchOptions, "executablePath" | "args"> | undefined,
  proxyUrl: string,
): LaunchOptions {
  const own = (base?.args ?? []).filter(
    (arg) =>
      !FORBIDDEN_ARGS.some((forbidden) => arg === forbidden || arg.startsWith(`${forbidden}=`)),
  );
  // Credentials ride in the proxy's address; Playwright takes them as separate fields.
  const url = new URL(proxyUrl);
  const { username, password } = url;
  url.username = "";
  url.password = "";
  return {
    headless: true,
    ...(base?.executablePath ? { executablePath: base.executablePath } : {}),
    args: [...own, ...WEBRTC_ARGS],
    proxy: {
      server: url.origin,
      bypass: "<-loopback>",
      ...(username !== "" ? { username: decodeURIComponent(username) } : {}),
      ...(password !== "" ? { password: decodeURIComponent(password) } : {}),
    },
  };
}

export interface PlaywrightStreamDetectorOptions {
  /** How many pages may be open at the same time. */
  maxConcurrent: number;
  /** Give up when no manifest has been requested after this long. */
  timeoutMs: number;
  /** After the first candidate, keep listening this long so a master can overtake a variant. */
  settleMs: number;
  userAgent?: string;
  /**
   * Whether the browser may reach an address. Every request, every WebSocket and the page itself go
   * through it, so a page cannot be used to read the server's own network. Required on purpose.
   */
  isAllowed: (url: string) => Promise<boolean>;
  /**
   * The guarded proxy Chromium is started behind (`GuardedProxy.url`). Redirects, WebRTC and
   * anything else the route cannot see still have to pass it. Required on purpose.
   */
  proxyUrl: string;
  launchOptions?: Pick<LaunchOptions, "executablePath" | "args">;
  /** After how long without a stream the page is clicked in the middle, once per entry. */
  playClickDelaysMs?: readonly number[];
  /** Replaces the Playwright launch. Meant for tests. */
  launch?: () => Promise<BrowserLike>;
}

/** The only request headers a downloader needs to be let through; the rest is browser noise. */
/** What the browser is told when a request is refused. */
const BLOCKED_ERROR_CODE = "blockedbyclient";

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

async function defaultLaunch(
  options: PlaywrightStreamDetectorOptions["launchOptions"],
  proxyUrl: string,
): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  return (await chromium.launch(buildLaunchOptions(options, proxyUrl))) as unknown as BrowserLike;
}

/**
 * When a player has not asked for a stream this long after the page opened, it is clicked in the
 * middle (where players put their play button): the first click often only opens an ad, so twice.
 */
const DEFAULT_PLAY_CLICK_DELAYS_MS = [2_000, 5_000];
/** The middle of Playwright's default 1280×720 viewport. */
const PLAY_CLICK_POINT = { x: 640, y: 360 };

export interface DetectOptions {
  signal: AbortSignal;
  /** Sent as the Referer of the page: players embedded in another site often refuse to play without it. */
  referer?: string;
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

  async detect(pageUrl: string, { signal, referer }: DetectOptions): Promise<DetectedStream[]> {
    const aborted = () =>
      new StreamDetectionError("aborted", "Stream detection aborted", { cause: signal.reason });
    if (signal.aborted) throw aborted();

    if (!(await this.safelyAllowed(pageUrl))) {
      throw new StreamDetectionError("blocked", `The address ${pageUrl} is not allowed`);
    }

    let release: () => void;
    try {
      release = await this.semaphore.acquire(signal);
    } catch {
      throw aborted();
    }
    let closeContext: (() => Promise<void>) | undefined;
    try {
      if (signal.aborted) throw aborted();
      const handle = this.launched();
      const browser = await handle;
      let context: ContextLike;
      try {
        context = await browser.newContext({
          ...(this.options.userAgent === undefined ? {} : { userAgent: this.options.userAgent }),
          // A service worker fetches on its own, outside the context's routing.
          serviceWorkers: "block",
        });
      } catch (cause) {
        this.forget(handle);
        throw new StreamDetectionError("browser", "The browser could not open a context", {
          cause,
        });
      }
      // One close per context, whoever asks first: the abort handler or the cleanup below.
      let closing: Promise<void> | undefined;
      closeContext = () => (closing ??= context.close().catch(() => undefined));
      try {
        await this.confine(context);
      } catch (cause) {
        this.forget(handle);
        throw new StreamDetectionError("browser", "The browser could not be confined", { cause });
      }
      const found = await this.watch(context, closeContext, pageUrl, referer, signal, aborted, () =>
        this.forget(handle),
      );
      return pickBest(found).map(({ url, kind, headers }) => ({ url, kind, headers }));
    } finally {
      await closeContext?.();
      release();
    }
  }

  private async safelyAllowed(url: string): Promise<boolean> {
    try {
      return await this.options.isAllowed(url);
    } catch {
      // A check that cannot answer is a "no": nothing leaves on a maybe.
      return false;
    }
  }

  /** Every request and WebSocket of the context passes the address check, or is cut. */
  private async confine(context: ContextLike): Promise<void> {
    await context.route("**/*", async (route) => {
      if (await this.safelyAllowed(route.request().url())) await route.continue();
      else await route.abort(BLOCKED_ERROR_CODE);
    });
    await context.routeWebSocket("**/*", (ws) => {
      void this.safelyAllowed(ws.url()).then((allowed) => {
        if (allowed) void ws.connectToServer();
        else void ws.close();
      });
    });
  }

  /** Closes the shared browser. Call it when the server stops. */
  async dispose(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser).close();
  }

  private launched(): Promise<BrowserLike> {
    if (this.browser) return this.browser;
    const handle = (
      this.options.launch ??
      (() => defaultLaunch(this.options.launchOptions, this.options.proxyUrl))
    )();
    this.browser = handle;
    handle.then(
      (browser) => {
        // A browser that dies on its own must not stay cached: the next job launches a new one.
        browser.on?.("disconnected", () => this.forget(handle));
      },
      () => this.forget(handle),
    );
    return handle;
  }

  /** Drops the cached browser, but only if it is still this one (a late event must not drop a new one). */
  private forget(handle: Promise<BrowserLike>): void {
    if (this.browser === handle) this.browser = null;
  }

  private async watch(
    context: ContextLike,
    closeContext: () => Promise<void>,
    pageUrl: string,
    referer: string | undefined,
    signal: AbortSignal,
    aborted: () => StreamDetectionError,
    browserLost: () => void,
  ): Promise<Candidate[]> {
    let page: PageLike;
    try {
      page = await context.newPage();
    } catch (cause) {
      browserLost();
      throw new StreamDetectionError("browser", "The browser could not open a page", { cause });
    }
    const { timeoutMs, settleMs } = this.options;

    return new Promise<Candidate[]>((resolve, reject) => {
      const found = new Map<string, Candidate>();
      // Every address each candidate went through, redirects included: an ad is named by its first.
      const chains = new Map<string, string[]>();
      // Video files that VAST/VMAP documents the page read play as ads.
      const ads = new Set<string>();
      const isAd = (url: string) => (chains.get(url) ?? [url]).some((hop) => ads.has(hop));
      /** The candidates that are not ads: an ad starts first and must not stand for the episode. */
      const streams = () => [...found.values()].filter((candidate) => !isAd(candidate.url));
      const pending = new Set<Promise<unknown>>();
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const clickTimers: ReturnType<typeof setTimeout>[] = [];
      let done = false;

      const finish = (outcome: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        clearTimeout(settleTimer);
        for (const timer of clickTimers) clearTimeout(timer);
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
          void Promise.allSettled([...pending]).then(() => {
            const real = streams();
            // Only ads so far: the episode comes after them, so keep watching until the deadline.
            if (real.length === 0) settleTimer = undefined;
            else finish(() => resolve(real));
          });
        }, settleMs);
      };
      const register = (request: RequestLike, kind: StreamKind): Candidate => {
        const url = request.url();
        let candidate = found.get(url);
        if (!candidate) {
          candidate = { url, kind, playlist: "unknown", headers: {} };
          found.set(url, candidate);
          const chain: string[] = [];
          for (let hop: RequestLike | null = request; hop; hop = hop.redirectedFrom?.() ?? null) {
            chain.push(hop.url());
          }
          chains.set(url, chain);
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
        if (mayDescribeAds(request.url(), response.headers()["content-type"])) {
          track(
            response
              .text()
              .then((body) => {
                for (const url of adMediaUrls(body)) ads.add(url);
              })
              .catch(() => undefined),
          );
          return;
        }
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

      // Ads a player opens are closed at once: nothing in them is the stream.
      page.on("popup", (popup) => {
        void popup.close().catch(() => undefined);
      });

      const { mouse } = page;
      page
        .goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
          ...(referer === undefined ? {} : { referer }),
        })
        .then(() => {
          if (!mouse) return;
          for (const delay of this.options.playClickDelaysMs ?? DEFAULT_PLAY_CLICK_DELAYS_MS) {
            clickTimers.push(
              setTimeout(() => {
                if (done || streams().length > 0) return;
                void mouse.click(PLAY_CLICK_POINT.x, PLAY_CLICK_POINT.y).catch(() => undefined);
              }, delay),
            );
          }
        })
        .catch((cause) => {
          if (found.size > 0) return;
          finish(() =>
            reject(new StreamDetectionError("navigation", `Could not open ${pageUrl}`, { cause })),
          );
        });
    });
  }
}

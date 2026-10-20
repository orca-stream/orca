import { describe, expect, it } from "vite-plus/test";
import {
  buildLaunchOptions,
  PlaywrightStreamDetector,
  StreamDetectionError,
  type BrowserLike,
  type ContextLike,
  type PageLike,
  type RequestLike,
  type ResponseLike,
  type RouteLike,
  type WebSocketRouteLike,
} from "./detector.ts";

type Listener = (arg: never) => void;

class FakePage implements PageLike {
  private readonly listeners = new Map<string, Listener[]>();
  gotoCalls: string[] = [];
  gotoReferers: (string | undefined)[] = [];
  gotoImpl: (url: string) => Promise<unknown> = () => Promise.resolve(null);
  clicks: { x: number; y: number }[] = [];
  /** Set to make the page clickable, as a real one is. */
  mouse: PageLike["mouse"];

  on(event: "request" | "response" | "popup", listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  goto(url: string, options?: { referer?: string }): Promise<unknown> {
    this.gotoCalls.push(url);
    this.gotoReferers.push(options?.referer);
    return this.gotoImpl(url);
  }
  clickable(onClick: (page: FakePage) => void = () => {}): void {
    this.mouse = {
      click: async (x, y) => {
        this.clicks.push({ x, y });
        onClick(this);
      },
    };
  }
  emit(event: "request", arg: RequestLike): void;
  emit(event: "response", arg: ResponseLike): void;
  emit(event: "popup", arg: { close(): Promise<unknown> }): void;
  emit(event: string, arg: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(arg as never);
  }
}

class FakeContext implements ContextLike {
  closed = 0;
  readonly page = new FakePage();
  routes: { pattern: string; handler: (route: RouteLike) => Promise<void> | void }[] = [];
  socketRoutes: { pattern: string; handler: (ws: WebSocketRouteLike) => void }[] = [];
  newPageImpl: () => Promise<PageLike> = () => Promise.resolve(this.page);
  newPage(): Promise<PageLike> {
    return this.newPageImpl();
  }
  route(pattern: string, handler: (route: RouteLike) => Promise<void> | void): Promise<void> {
    this.routes.push({ pattern, handler });
    return Promise.resolve();
  }
  routeWebSocket(pattern: string, handler: (ws: WebSocketRouteLike) => void): Promise<void> {
    this.socketRoutes.push({ pattern, handler });
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

class FakeBrowser implements BrowserLike {
  readonly contexts: FakeContext[] = [];
  closed = false;
  newContextError: Error | null = null;
  contextOptions: unknown[] = [];
  private disconnectListeners: (() => void)[] = [];
  onNewContext: (context: FakeContext) => void = () => {};
  on(_event: "disconnected", listener: () => void): void {
    this.disconnectListeners.push(listener);
  }
  disconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
  newContext(contextOptions: unknown): Promise<ContextLike> {
    this.contextOptions.push(contextOptions);
    if (this.newContextError) return Promise.reject(this.newContextError);
    const context = new FakeContext();
    this.contexts.push(context);
    this.onNewContext(context);
    return Promise.resolve(context);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

const request = (
  url: string,
  headers: Record<string, string>,
  resourceType = "xhr",
): RequestLike => ({
  url: () => url,
  resourceType: () => resourceType,
  allHeaders: () => Promise.resolve(headers),
});

const response = (req: RequestLike, contentType: string, body: string): ResponseLike => ({
  request: () => req,
  headers: () => ({ "content-type": contentType }),
  text: () => Promise.resolve(body),
});

const allowAll = (_url: string) => Promise.resolve(true);
const PROXY = "http://127.0.0.1:3128";
const options = {
  maxConcurrent: 1,
  timeoutMs: 40,
  settleMs: 5,
  isAllowed: allowAll,
  proxyUrl: PROXY,
};
const noSignal = () => new AbortController().signal;

function detectorWith(browser: FakeBrowser, overrides: Partial<typeof options> = {}) {
  return new PlaywrightStreamDetector({
    ...options,
    ...overrides,
    launch: () => Promise.resolve(browser),
  });
}

describe("PlaywrightStreamDetector", () => {
  it("returns the manifest with only the headers a downloader needs", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.page.gotoImpl = () => {
        const req = request("https://cdn.test/master.m3u8", {
          referer: "https://site.test/watch",
          cookie: "sid=1",
          origin: "https://site.test",
          "user-agent": "UA/1",
          accept: "*/*",
          "sec-fetch-mode": "cors",
        });
        context.page.emit("request", req);
        return Promise.resolve(null);
      };
    };
    const found = await detectorWith(browser).detect("https://site.test/watch", {
      signal: noSignal(),
    });
    expect(found).toEqual([
      {
        url: "https://cdn.test/master.m3u8",
        kind: "hls",
        headers: {
          Referer: "https://site.test/watch",
          Cookie: "sid=1",
          Origin: "https://site.test",
          "User-Agent": "UA/1",
        },
      },
    ]);
    expect(browser.contexts).toHaveLength(1);
    expect(browser.contexts[0]!.closed).toBe(1);
  });

  it("sorts a master ahead of the variant it saw first, using response bodies", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.page.gotoImpl = () => {
        const variant = request("https://cdn.test/v720.m3u8", {});
        const master = request("https://cdn.test/play?id=1", {}, "fetch");
        context.page.emit("request", variant);
        context.page.emit(
          "response",
          response(variant, "application/vnd.apple.mpegurl", "#EXTM3U\n#EXTINF:4,\ns.ts"),
        );
        context.page.emit(
          "response",
          response(master, "application/x-mpegURL", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv"),
        );
        context.page.emit("request", request("https://cdn.test/seg-1.ts", {}, "media"));
        return Promise.resolve(null);
      };
    };
    const found = await detectorWith(browser).detect("https://site.test/", { signal: noSignal() });
    expect(found.map((s) => s.url)).toEqual([
      "https://cdn.test/play?id=1",
      "https://cdn.test/v720.m3u8",
    ]);
  });

  it("fails with a retryable timeout when no manifest ever shows up, and closes the context", async () => {
    const browser = new FakeBrowser();
    const error = await detectorWith(browser)
      .detect("https://site.test/", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamDetectionError);
    expect((error as StreamDetectionError).reason).toBe("timeout");
    expect((error as StreamDetectionError).retryable).toBe(true);
    expect(browser.contexts[0]!.closed).toBe(1);
  });

  it("turns a navigation failure into a retryable error", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.page.gotoImpl = () => Promise.reject(new Error("net::ERR_CONNECTION_REFUSED"));
    };
    const error = await detectorWith(browser, { timeoutMs: 500 })
      .detect("https://site.test/", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect((error as StreamDetectionError).reason).toBe("navigation");
    expect((error as StreamDetectionError).retryable).toBe(true);
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("closes the context as soon as the signal aborts", async () => {
    const browser = new FakeBrowser();
    const controller = new AbortController();
    const pending = detectorWith(browser, { timeoutMs: 5_000 })
      .detect("https://site.test/", { signal: controller.signal })
      .catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(browser.contexts[0]!.closed).toBe(0);
    controller.abort();
    const error = await pending;
    expect((error as StreamDetectionError).reason).toBe("aborted");
    expect((error as StreamDetectionError).retryable).toBe(false);
    expect(browser.contexts[0]!.closed).toBe(1);
  });

  it("rejects without opening a context when already aborted", async () => {
    const browser = new FakeBrowser();
    const controller = new AbortController();
    controller.abort();
    const error = await detectorWith(browser)
      .detect("https://site.test/", { signal: controller.signal })
      .catch((e: unknown) => e);
    expect((error as StreamDetectionError).reason).toBe("aborted");
    expect(browser.contexts).toHaveLength(0);
  });

  it("runs at most maxConcurrent jobs at once", async () => {
    const browser = new FakeBrowser();
    let live = 0;
    let peak = 0;
    browser.onNewContext = (context) => {
      live += 1;
      peak = Math.max(peak, live);
      const close = context.close.bind(context);
      context.close = async () => {
        live -= 1;
        await close();
      };
    };
    const detector = detectorWith(browser, { maxConcurrent: 2, timeoutMs: 15 });
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        detector.detect(`https://site.test/${n}`, { signal: noSignal() }).catch(() => null),
      ),
    );
    expect(browser.contexts).toHaveLength(4);
    expect(peak).toBe(2);
  });

  it("launches the browser once, and dispose() closes it", async () => {
    const browser = new FakeBrowser();
    let launches = 0;
    const detector = new PlaywrightStreamDetector({
      ...options,
      timeoutMs: 10,
      launch: () => {
        launches += 1;
        return Promise.resolve(browser);
      },
    });
    await detector.detect("https://a.test/", { signal: noSignal() }).catch(() => null);
    await detector.detect("https://b.test/", { signal: noSignal() }).catch(() => null);
    expect(launches).toBe(1);
    await detector.dispose();
    expect(browser.closed).toBe(true);
  });
});

/** A route as Playwright hands it over: the request, and the three things a handler can do. */
function fakeRoute(url: string) {
  const calls: string[] = [];
  const route: RouteLike = {
    request: () => ({ url: () => url }),
    continue: () => {
      calls.push("continue");
      return Promise.resolve();
    },
    abort: (code) => {
      calls.push(`abort:${code}`);
      return Promise.resolve();
    },
  };
  return { route, calls };
}

describe("PlaywrightStreamDetector keeps the browser inside the allowed addresses", () => {
  const seen: string[] = [];
  const guarded = (browser: FakeBrowser, allowed: (url: string) => boolean) =>
    detectorWith(browser, {
      isAllowed: (url: string) => {
        seen.push(url);
        return Promise.resolve(allowed(url));
      },
    });
  const publicOnly = (url: string) => !url.includes("10.0.0.");

  it("routes every request through the check: allowed ones continue, others are aborted", async () => {
    const browser = new FakeBrowser();
    await guarded(browser, publicOnly)
      .detect("https://site.test/", { signal: noSignal() })
      .catch(() => null);
    const [{ pattern, handler }] = browser.contexts[0]!.routes as [FakeContext["routes"][number]];
    expect(pattern).toBe("**/*");

    const ok = fakeRoute("https://cdn.test/a.js");
    await handler(ok.route);
    expect(ok.calls).toEqual(["continue"]);

    const inside = fakeRoute("http://10.0.0.9:8096/System/Info");
    await handler(inside.route);
    expect(inside.calls).toEqual(["abort:blockedbyclient"]);
    expect(seen).toContain("http://10.0.0.9:8096/System/Info");
  });

  it("aborts when the check itself blows up, rather than letting the request out", async () => {
    const browser = new FakeBrowser();
    const detector = detectorWith(browser, {
      isAllowed: (url) =>
        url.includes("cdn") ? Promise.reject(new Error("dns down")) : Promise.resolve(true),
    });
    await detector.detect("https://site.test/", { signal: noSignal() }).catch(() => null);
    const inside = fakeRoute("https://cdn.test/x");
    await browser.contexts[0]!.routes[0]!.handler(inside.route);
    expect(inside.calls).toEqual(["abort:blockedbyclient"]);
  });

  it("does the same for WebSockets: connects the allowed, closes the others", async () => {
    const browser = new FakeBrowser();
    await guarded(browser, publicOnly)
      .detect("https://site.test/", { signal: noSignal() })
      .catch(() => null);
    const [{ pattern, handler }] = browser.contexts[0]!.socketRoutes as [
      FakeContext["socketRoutes"][number],
    ];
    expect(pattern).toBe("**/*");
    const make = (url: string) => {
      const calls: string[] = [];
      const ws: WebSocketRouteLike = {
        url: () => url,
        connectToServer: () => void calls.push("connect"),
        close: () => void calls.push("close"),
      };
      return { ws, calls };
    };
    const good = make("wss://cdn.test/live");
    const bad = make("ws://10.0.0.9/socket");
    handler(good.ws);
    handler(bad.ws);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(good.calls).toEqual(["connect"]);
    expect(bad.calls).toEqual(["close"]);
  });

  it("does not even open a page whose own address is not allowed", async () => {
    const browser = new FakeBrowser();
    const error = await guarded(browser, publicOnly)
      .detect("http://10.0.0.9/admin", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect((error as StreamDetectionError).reason).toBe("blocked");
    expect((error as StreamDetectionError).retryable).toBe(false);
    expect(browser.contexts[0]?.page.gotoCalls ?? []).toEqual([]);
    expect(browser.contexts.every((context) => context.closed === 1)).toBe(true);
  });
});

describe("PlaywrightStreamDetector recovers from a browser that went away", () => {
  it("launches a new browser after the old one disconnected", async () => {
    let launches = 0;
    const browsers: FakeBrowser[] = [];
    const detector = new PlaywrightStreamDetector({
      ...options,
      timeoutMs: 10,
      launch: () => {
        launches += 1;
        const browser = new FakeBrowser();
        browsers.push(browser);
        return Promise.resolve(browser);
      },
    });
    await detector.detect("https://a.test/", { signal: noSignal() }).catch(() => null);
    browsers[0]!.disconnect();
    await detector.detect("https://b.test/", { signal: noSignal() }).catch(() => null);
    expect(launches).toBe(2);
  });

  it("does not let a late disconnect of an old browser drop the new one", async () => {
    let launches = 0;
    const browsers: FakeBrowser[] = [];
    const detector = new PlaywrightStreamDetector({
      ...options,
      timeoutMs: 10,
      launch: () => {
        launches += 1;
        const browser = new FakeBrowser();
        browsers.push(browser);
        return Promise.resolve(browser);
      },
    });
    await detector.detect("https://a.test/", { signal: noSignal() }).catch(() => null);
    browsers[0]!.disconnect();
    await detector.detect("https://b.test/", { signal: noSignal() }).catch(() => null);
    browsers[0]!.disconnect();
    await detector.detect("https://c.test/", { signal: noSignal() }).catch(() => null);
    expect(launches).toBe(2);
  });

  it("turns a context that cannot be created into a retryable error and relaunches next time", async () => {
    let launches = 0;
    const first = new FakeBrowser();
    first.newContextError = new Error("Target page, context or browser has been closed");
    const detector = new PlaywrightStreamDetector({
      ...options,
      timeoutMs: 10,
      launch: () => {
        launches += 1;
        return Promise.resolve(launches === 1 ? first : new FakeBrowser());
      },
    });
    const error = await detector
      .detect("https://a.test/", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamDetectionError);
    expect((error as StreamDetectionError).reason).toBe("browser");
    expect((error as StreamDetectionError).retryable).toBe(true);
    await detector.detect("https://b.test/", { signal: noSignal() }).catch(() => null);
    expect(launches).toBe(2);
  });

  it("treats a context that cannot be confined as a lost browser, not as an open door", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.route = () => Promise.reject(new Error("browser has been closed"));
    };
    const error = await detectorWith(browser)
      .detect("https://a.test/", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect((error as StreamDetectionError).reason).toBe("browser");
    expect(browser.contexts[0]!.page.gotoCalls).toEqual([]);
    expect(browser.contexts[0]!.closed).toBe(1);
  });

  it("turns a page that cannot be opened into a retryable error and closes its context", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.newPageImpl = () => Promise.reject(new Error("browser has been closed"));
    };
    const error = await detectorWith(browser)
      .detect("https://a.test/", { signal: noSignal() })
      .catch((e: unknown) => e);
    expect((error as StreamDetectionError).reason).toBe("browser");
    expect(browser.contexts[0]!.closed).toBe(1);
  });
});

describe("PlaywrightStreamDetector and what a page can do around the route", () => {
  it("blocks service workers, which would fetch outside the context's routing", async () => {
    const browser = new FakeBrowser();
    await new PlaywrightStreamDetector({
      ...options,
      userAgent: "UA/9",
      launch: () => Promise.resolve(browser),
    })
      .detect("https://site.test/", { signal: noSignal() })
      .catch(() => null);
    expect(browser.contexts).toHaveLength(1);
    expect(browser.contextOptions).toEqual([{ userAgent: "UA/9", serviceWorkers: "block" }]);
  });
});

describe("buildLaunchOptions", () => {
  it("sends every request through the proxy, loopback included, and keeps WebRTC from leaking", () => {
    const launch = buildLaunchOptions(undefined, "http://127.0.0.1:4040");
    expect(launch).toMatchObject({
      headless: true,
      proxy: { server: "http://127.0.0.1:4040", bypass: "<-loopback>" },
    });
    expect(launch.args).toContain("--webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(launch.args).toContain("--force-webrtc-ip-handling-policy");
  });

  it("hands Chromium the proxy's credentials separately, as Playwright wants them", () => {
    const launch = buildLaunchOptions(undefined, "http://u%40ser:p%3Ass@127.0.0.1:4040");
    expect(launch.proxy).toEqual({
      server: "http://127.0.0.1:4040",
      bypass: "<-loopback>",
      username: "u@ser",
      password: "p:ss",
    });
  });

  it("keeps the caller's executable and arguments, and cannot be given a way around the proxy", () => {
    const launch = buildLaunchOptions(
      { executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--no-proxy-server"] },
      "http://127.0.0.1:4040",
    );
    expect(launch.executablePath).toBe("/usr/bin/chromium");
    expect(launch.args).toContain("--no-sandbox");
    expect(launch.args).not.toContain("--no-proxy-server");
  });
});

describe("PlaywrightStreamDetector: players embedded in another site", () => {
  const manifest = () => {
    const req = request("https://cdn.test/master.m3u8", {}, "fetch");
    return {
      req,
      res: response(req, "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-STREAM-INF"),
    };
  };

  it("opens the player with the page it is embedded in as the Referer", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.page.gotoImpl = () => {
        const { req, res } = manifest();
        context.page.emit("request", req);
        context.page.emit("response", res);
        return Promise.resolve(null);
      };
    };
    await detectorWith(browser).detect("https://player.test/e/1", {
      signal: noSignal(),
      referer: "https://site.test/watch/1",
    });
    expect(browser.contexts[0]!.page.gotoReferers).toEqual(["https://site.test/watch/1"]);
  });

  it("clicks the middle of a player that waits for a click, and closes the ads it opens", async () => {
    const browser = new FakeBrowser();
    const popupsClosed: number[] = [];
    browser.onNewContext = (context) => {
      context.page.clickable((page) => {
        if (page.clicks.length === 1) {
          // The first click opens an ad; the second one starts the video.
          page.emit("popup", { close: async () => popupsClosed.push(1) });
          return;
        }
        const { req, res } = manifest();
        page.emit("request", req);
        page.emit("response", res);
      });
    };
    const detector = new PlaywrightStreamDetector({
      ...options,
      timeoutMs: 500,
      playClickDelaysMs: [5, 15],
      launch: () => Promise.resolve(browser),
    });
    const streams = await detector.detect("https://player.test/e/1", { signal: noSignal() });
    expect(streams.map((stream) => stream.url)).toEqual(["https://cdn.test/master.m3u8"]);
    expect(browser.contexts[0]!.page.clicks).toEqual([
      { x: 640, y: 360 },
      { x: 640, y: 360 },
    ]);
    expect(popupsClosed).toEqual([1]);
  });

  it("does not click a player that already asked for its stream", async () => {
    const browser = new FakeBrowser();
    browser.onNewContext = (context) => {
      context.page.clickable();
      context.page.gotoImpl = () => {
        const { req, res } = manifest();
        context.page.emit("request", req);
        context.page.emit("response", res);
        return Promise.resolve(null);
      };
    };
    const detector = new PlaywrightStreamDetector({
      ...options,
      settleMs: 30,
      playClickDelaysMs: [1],
      launch: () => Promise.resolve(browser),
    });
    await detector.detect("https://player.test/e/1", { signal: noSignal() });
    expect(browser.contexts[0]!.page.clicks).toEqual([]);
  });
});

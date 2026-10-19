import { describe, expect, it } from "vite-plus/test";
import {
  PlaywrightStreamDetector,
  StreamDetectionError,
  type BrowserLike,
  type ContextLike,
  type PageLike,
  type RequestLike,
  type ResponseLike,
} from "./detector.ts";

type Listener = (arg: never) => void;

class FakePage implements PageLike {
  private readonly listeners = new Map<string, Listener[]>();
  gotoCalls: string[] = [];
  gotoImpl: (url: string) => Promise<unknown> = () => Promise.resolve(null);

  on(event: "request" | "response", listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  goto(url: string): Promise<unknown> {
    this.gotoCalls.push(url);
    return this.gotoImpl(url);
  }
  emit(event: "request", arg: RequestLike): void;
  emit(event: "response", arg: ResponseLike): void;
  emit(event: string, arg: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(arg as never);
  }
}

class FakeContext implements ContextLike {
  closed = 0;
  readonly page = new FakePage();
  newPage(): Promise<PageLike> {
    return Promise.resolve(this.page);
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

class FakeBrowser implements BrowserLike {
  readonly contexts: FakeContext[] = [];
  closed = false;
  onNewContext: (context: FakeContext) => void = () => {};
  newContext(): Promise<ContextLike> {
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

const options = { maxConcurrent: 1, timeoutMs: 40, settleMs: 5 };
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

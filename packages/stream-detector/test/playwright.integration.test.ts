import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  buildLaunchOptions,
  GuardedProxy,
  PlaywrightStreamDetector,
  StreamDetectionError,
} from "../src/index.ts";

// Opt-in: needs `HM_PLAYWRIGHT=1` and a Chromium installed (`pnpm exec playwright install chromium`).
// CI installs no browser, so the whole file is skipped there.
const enabled = process.env["HM_PLAYWRIGHT"] === "1" && existsSync(chromium.executablePath());

const COOKIE = "sid=abc123";
const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n";

const PAGES: Record<string, string> = {
  "/plays": `<script>document.cookie = "${COOKIE}"; fetch("/media/master.m3u8");</script>`,
  "/silent": "<p>nothing to see</p>",
  // A player that waits for a click: the first one only opens an ad, the second one plays.
  "/player": `<body style="margin:0"><div style="width:100vw;height:100vh"></div><script>
    let clicks = 0;
    document.addEventListener("click", () => {
      clicks += 1;
      if (clicks === 1) window.open("/ad");
      else fetch("/media/master.m3u8");
    });
  </script></body>`,
  "/ad": "<p>an ad</p>",
};
/** The player only plays inside the site that embeds it. */
const EMBEDDER = "https://site.test/watch/1";

describe.skipIf(!enabled)("PlaywrightStreamDetector against real Chromium", () => {
  let server: Server;
  let origin: string;
  let browser: Browser;
  const detector = (overrides: { timeoutMs?: number; playClickDelaysMs?: number[] } = {}) =>
    new PlaywrightStreamDetector({
      maxConcurrent: 2,
      timeoutMs: 8_000,
      settleMs: 300,
      // The test pages live on 127.0.0.1, which a real server would refuse.
      isAllowed: () => Promise.resolve(true),
      ...overrides,
      proxyUrl: "http://127.0.0.1:1",
      launch: () => Promise.resolve(browser),
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/player" && req.headers.referer !== EMBEDDER) {
        res.writeHead(403).end();
      } else if (path === "/media/master.m3u8") {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(MASTER);
      } else if (path in PAGES) {
        res.writeHead(200, { "content-type": "text/html" }).end(PAGES[path]);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it("returns the manifest with the Referer and Cookie the page used", async () => {
    const found = await detector().detect(`${origin}/plays`, {
      signal: new AbortController().signal,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ url: `${origin}/media/master.m3u8`, kind: "hls" });
    expect(found[0]!.headers["Referer"]).toBe(`${origin}/plays`);
    expect(found[0]!.headers["Cookie"]).toBe(COOKIE);
    expect(found[0]!.headers["User-Agent"]).toBeTruthy();
    expect(browser.contexts()).toHaveLength(0);
  });

  it("opens a player with its embedder as Referer, clicks it until it plays, and closes the ad", async () => {
    const found = await detector({ playClickDelaysMs: [500, 1_500] }).detect(`${origin}/player`, {
      signal: new AbortController().signal,
      referer: EMBEDDER,
    });
    expect(found.map((stream) => stream.url)).toEqual([`${origin}/media/master.m3u8`]);
    expect(found[0]!.headers["Referer"]).toBe(`${origin}/player`);
    expect(browser.contexts()).toHaveLength(0);
  });

  it("times out with a retryable error when the page never asks for a manifest", async () => {
    const error = await detector({ timeoutMs: 1_500 })
      .detect(`${origin}/silent`, { signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamDetectionError);
    expect((error as StreamDetectionError).reason).toBe("timeout");
    expect((error as StreamDetectionError).retryable).toBe(true);
    expect(browser.contexts()).toHaveLength(0);
  });

  it("closes the browser context when aborted midway", async () => {
    const controller = new AbortController();
    const pending = detector({ timeoutMs: 30_000 })
      .detect(`${origin}/silent`, { signal: controller.signal })
      .catch((e: unknown) => e);
    await expect.poll(() => browser.contexts().length, { timeout: 5_000 }).toBe(1);
    controller.abort();
    const error = await pending;
    expect((error as StreamDetectionError).reason).toBe("aborted");
    expect(browser.contexts()).toHaveLength(0);
  });
});

// The real thing the proxy is for: Chromium follows a redirect on its own, and `context.route` only
// ever sees the first URL. Here the "public" site is 127.0.0.2 and the "private" one 127.0.0.1.
describe.skipIf(!enabled)("PlaywrightStreamDetector behind the guarded proxy", () => {
  const PUBLIC = "127.0.0.2";
  const PRIVATE = "127.0.0.1";
  let publicServer: Server;
  let privateServer: Server;
  let proxy: GuardedProxy;
  let browser: Browser;
  let privateHits: string[];
  let publicHits: string[];
  let refusals: { host: string; status: number }[];
  let publicPort: number;
  let privatePort: number;

  beforeAll(async () => {
    privateHits = [];
    privateServer = createServer((req, res) => {
      privateHits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(MASTER);
    });
    await new Promise<void>((resolve) => privateServer.listen(0, PRIVATE, resolve));
    privatePort = (privateServer.address() as AddressInfo).port;
    publicServer = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      publicHits.push(path);
      if (path === "/page") {
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<script>fetch("/hop.m3u8").catch(() => {});</script>`);
      } else if (path === "/hop.m3u8") {
        res.writeHead(302, { location: `http://${PRIVATE}:${privatePort}/inner.m3u8` }).end();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => publicServer.listen(0, PUBLIC, resolve));
    publicPort = (publicServer.address() as AddressInfo).port;
    refusals = [];
    publicHits = [];
    proxy = new GuardedProxy({
      isBlockedAddress: (address) => address !== PUBLIC,
      // The test servers listen on ephemeral ports.
      isPortAllowed: () => true,
      onRefused: (refusal) => refusals.push(refusal),
    });
    await proxy.start();
    browser = await chromium.launch(buildLaunchOptions(undefined, proxy.url));
  });
  afterAll(async () => {
    await browser?.close();
    await proxy?.close();
    publicServer?.close();
    privateServer?.close();
  });

  it("never lets a redirect from an allowed site reach the private one", async () => {
    const detector = new PlaywrightStreamDetector({
      maxConcurrent: 1,
      timeoutMs: 6_000,
      settleMs: 300,
      // The route lets the first URL by, as it only sees that one: the proxy is what stops the hop.
      isAllowed: () => Promise.resolve(true),
      proxyUrl: proxy.url,
      launch: () => Promise.resolve(browser as never),
    });
    await detector
      .detect(`http://${PUBLIC}:${publicPort}/page`, { signal: new AbortController().signal })
      .catch(() => null);
    // The page and the redirecting URL were fetched, through the proxy...
    expect(publicHits).toEqual(expect.arrayContaining(["/page", "/hop.m3u8"]));
    // ...and the hop to the private server was refused by it, not merely unanswered.
    expect(refusals).toContainEqual({ host: "127.0.0.1", status: 403 });
    expect(privateHits).toEqual([]);
  });
});

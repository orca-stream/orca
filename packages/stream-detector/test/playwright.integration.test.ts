import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PlaywrightStreamDetector, StreamDetectionError } from "../src/index.ts";

// Opt-in: needs `HM_PLAYWRIGHT=1` and a Chromium installed (`pnpm exec playwright install chromium`).
// CI installs no browser, so the whole file is skipped there.
const enabled = process.env["HM_PLAYWRIGHT"] === "1" && existsSync(chromium.executablePath());

const COOKIE = "sid=abc123";
const MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n";

const PAGES: Record<string, string> = {
  "/plays": `<script>document.cookie = "${COOKIE}"; fetch("/media/master.m3u8");</script>`,
  "/silent": "<p>nothing to see</p>",
};

describe.skipIf(!enabled)("PlaywrightStreamDetector against real Chromium", () => {
  let server: Server;
  let origin: string;
  let browser: Browser;
  const detector = (overrides: { timeoutMs?: number } = {}) =>
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
      if (path === "/media/master.m3u8") {
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

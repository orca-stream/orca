import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AbortedError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import type { Source } from "../src/domain/series.ts";
import { HttpDownloader } from "../src/infrastructure/download/http-downloader.ts";
import type { UrlGuard } from "../src/application/ports.ts";
import type { HostLimiter } from "../src/infrastructure/host-limiter.ts";
import { testLimiter } from "./helpers.ts";

const BODY = Buffer.from("0123456789".repeat(1000)); // 10 000 bytes
const MD5 = createHash("md5").update(BODY).digest("hex");

interface Seen {
  range: string | undefined;
  userAgent: string | undefined;
  url: string | undefined;
  cookie: string | undefined;
  referer: string | undefined;
  origin: string | undefined;
}

let server: Server;
let base: string;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;
let dir: string;
let live = 0;
let peak = 0;

function serveFile(req: IncomingMessage, res: ServerResponse, { ignoreRange = false } = {}) {
  const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
  if (match && !ignoreRange) {
    const start = Number(match[1]);
    if (start >= BODY.length) {
      res.writeHead(416, { "content-range": `bytes */${BODY.length}` }).end();
      return;
    }
    res.writeHead(206, {
      "content-range": `bytes ${start}-${BODY.length - 1}/${BODY.length}`,
      "content-length": BODY.length - start,
    });
    res.end(BODY.subarray(start));
    return;
  }
  res.writeHead(200, { "content-length": BODY.length, "accept-ranges": "bytes" });
  res.end(BODY);
}

beforeEach(async () => {
  seen = [];
  live = 0;
  peak = 0;
  handler = (req, res) => serveFile(req, res);
  server = createServer((req, res) => {
    seen.push({
      range: req.headers.range,
      userAgent: req.headers["user-agent"],
      url: req.url,
      cookie: req.headers.cookie,
      referer: req.headers.referer,
      origin: req.headers.origin,
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), "hm-dl-"));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const source = (extra: Partial<Extract<Source, { kind: "direct" }>> = {}): Source => ({
  kind: "direct",
  url: `${base}/video.mp4`,
  fileName: "video.mp4",
  sizeBytes: BODY.length,
  md5: MD5,
  ...extra,
});

/** The tests' server is on 127.0.0.1, which the real guard refuses: this one lets everything by. */
const allowAll: UrlGuard = { assertUrl: async (url) => new URL(url) };
const downloader = (options: { limiter?: HostLimiter; guard?: UrlGuard } = {}) =>
  new HttpDownloader({
    userAgent: "OrcaHM/test",
    limiter: testLimiter().limiter,
    guard: allowAll,
    ...options,
  });
const context = (signal = new AbortController().signal) => {
  const progress: { bytes: number; total?: number }[] = [];
  return {
    signal,
    onProgress: (p: { bytes: number; total?: number }) => void progress.push(p),
    progress,
  };
};

describe("HttpDownloader", () => {
  it("downloads through a .part, checks size and md5, then renames", async () => {
    const dest = join(dir, "out.mp4");
    const ctx = context();
    const result = await downloader().download(source(), dest, ctx);
    expect(result.bytes).toBe(BODY.length);
    expect((await readFile(dest)).equals(BODY)).toBe(true);
    await expect(stat(`${dest}.part`)).rejects.toThrow();
    expect(seen[0]).toMatchObject({ range: undefined, userAgent: "OrcaHM/test" });
    expect(ctx.progress.at(-1)).toMatchObject({ bytes: BODY.length, total: BODY.length });
  });

  it("resumes from a .part with a Range request", async () => {
    const dest = join(dir, "out.mp4");
    await writeFile(`${dest}.part`, BODY.subarray(0, 4000));
    await downloader().download(source(), dest, context());
    expect(seen[0]?.range).toBe("bytes=4000-");
    expect((await readFile(dest)).equals(BODY)).toBe(true);
  });

  it("starts over when the server ignores Range and answers 200", async () => {
    handler = (req, res) => serveFile(req, res, { ignoreRange: true });
    const dest = join(dir, "out.mp4");
    await writeFile(`${dest}.part`, BODY.subarray(0, 4000));
    await downloader().download(source(), dest, context());
    expect((await readFile(dest)).equals(BODY)).toBe(true);
  });

  it("accepts a complete .part the server answers 416 to", async () => {
    const dest = join(dir, "out.mp4");
    await writeFile(`${dest}.part`, BODY);
    await downloader().download(source(), dest, context());
    expect((await readFile(dest)).equals(BODY)).toBe(true);
  });

  it("fails permanently on 404", async () => {
    handler = (_req, res) => void res.writeHead(404).end();
    await expect(
      downloader().download(source(), join(dir, "o.mp4"), context()),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it("fails retryably on 503, with the Retry-After it was given", async () => {
    handler = (_req, res) => void res.writeHead(503, { "retry-after": "7" }).end();
    const error = await downloader()
      .download(source(), join(dir, "o.mp4"), context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryableError);
    expect((error as RetryableError).retryAfterMs).toBe(7000);
  });

  it("fails retryably on 429 and on a refused connection", async () => {
    handler = (_req, res) => void res.writeHead(429).end();
    await expect(
      downloader().download(source(), join(dir, "o.mp4"), context()),
    ).rejects.toBeInstanceOf(RetryableError);
    await expect(
      downloader().download(
        source({ url: "http://127.0.0.1:1/x.mp4" }),
        join(dir, "o2.mp4"),
        context(),
      ),
    ).rejects.toBeInstanceOf(RetryableError);
  });

  it("downloads again once on a checksum mismatch, then gives up for good and keeps no file", async () => {
    const dest = join(dir, "out.mp4");
    await expect(
      downloader().download(source({ md5: "0".repeat(32) }), dest, context()),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(seen).toHaveLength(2);
    await expect(stat(`${dest}.part`)).rejects.toThrow();
    await expect(stat(dest)).rejects.toThrow();
  });

  it("treats a size mismatch the same way", async () => {
    await expect(
      downloader().download(
        source({ sizeBytes: BODY.length + 1, md5: undefined }),
        join(dir, "o.mp4"),
        context(),
      ),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it("stops on abort and keeps the .part to resume from", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-length": BODY.length });
      res.write(BODY.subarray(0, 3000));
      // never finishes
    };
    const controller = new AbortController();
    const dest = join(dir, "out.mp4");
    const ctx = context(controller.signal);
    const done = downloader().download(source(), dest, {
      ...ctx,
      onProgress: (p) => {
        ctx.onProgress(p);
        if (p.bytes >= 3000) setTimeout(() => controller.abort(), 50);
      },
    });
    await expect(done).rejects.toBeInstanceOf(AbortedError);
    expect((await stat(`${dest}.part`)).size).toBeGreaterThan(0);
  });

  it("lets only the configured number of downloadss download concurrency hit one host at a time", async () => {
    handler = (_req, res) => {
      live++;
      peak = Math.max(peak, live);
      setTimeout(() => {
        live--;
        res.writeHead(200, { "content-length": BODY.length }).end(BODY);
      }, 30);
    };
    const d = downloader({ limiter: testLimiter({ download: { concurrency: 1 } }).limiter });
    await Promise.all([
      d.download(source({ md5: undefined }), join(dir, "a.mp4"), context()),
      d.download(source({ md5: undefined }), join(dir, "b.mp4"), context()),
    ]);
    expect(peak).toBe(1);
  });

  it("spaces the starts of downloads from one host by the limiter's interval", async () => {
    const { limiter, slept } = testLimiter({ download: { minIntervalMs: 2000 } });
    const d = downloader({ limiter });
    await d.download(source(), join(dir, "a.mp4"), context());
    await d.download(source(), join(dir, "b.mp4"), context());
    expect(slept).toEqual([2000]);
  });

  it("only handles direct sources", () => {
    const d = downloader();
    expect(d.canHandle(source())).toBe(true);
    expect(d.canHandle({ kind: "hls", url: "https://x/y.m3u8" })).toBe(false);
  });
});

describe("HttpDownloader and the address guard", () => {
  const refuseUrl = (predicate: (url: string) => boolean): UrlGuard => ({
    assertUrl: async (url) => {
      if (predicate(url)) throw new PermanentError("Refusing: private or internal address");
      return new URL(url);
    },
  });

  it("asks the guard before connecting, and never connects when it says no", async () => {
    const error = await downloader({ guard: refuseUrl(() => true) })
      .download(source(), join(dir, "o.mp4"), context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect(seen).toEqual([]);
  });

  it("follows a redirect itself, checking the guard on every hop", async () => {
    handler = (req, res) => {
      if (req.url === "/video.mp4") res.writeHead(302, { location: "/moved.mp4" }).end();
      else serveFile(req, res);
    };
    const checked: string[] = [];
    const guard = refuseUrl((url) => void checked.push(url) === undefined && false);
    await downloader({ guard }).download(source(), join(dir, "o.mp4"), context());
    expect(seen.map((s) => s.url)).toEqual(["/video.mp4", "/moved.mp4"]);
    expect(checked).toEqual([`${base}/video.mp4`, `${base}/moved.mp4`]);
  });

  it("refuses a redirect that leads inside, without ever asking for it", async () => {
    handler = (_req, res) => void res.writeHead(302, { location: "http://10.0.0.9/secret" }).end();
    const error = await downloader({ guard: refuseUrl((url) => url.includes("10.0.0.9")) })
      .download(source(), join(dir, "o.mp4"), context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect(seen).toHaveLength(1);
  });

  it("gives up on a redirect loop and on a redirect with nowhere to go", async () => {
    handler = (_req, res) => void res.writeHead(302, { location: "/video.mp4" }).end();
    await expect(
      downloader().download(source(), join(dir, "o.mp4"), context()),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(seen.length).toBeLessThanOrEqual(8);
    seen = [];
    handler = (_req, res) => void res.writeHead(302).end();
    await expect(
      downloader().download(source(), join(dir, "o2.mp4"), context()),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it("sends the Referer and Cookie a page used, and nothing else it was handed", async () => {
    await downloader().download(
      source({
        headers: {
          Referer: "https://site.example/watch",
          Cookie: "sid=1",
          Origin: "https://site.example",
          Host: "evil.example",
          "X-Forwarded-For": "1.2.3.4",
          "Bad\r\nName": "x",
        },
      }),
      join(dir, "o.mp4"),
      context(),
    );
    expect(seen[0]).toMatchObject({
      cookie: "sid=1",
      referer: "https://site.example/watch",
      origin: "https://site.example",
      userAgent: "OrcaHM/test",
    });
  });

  it("keeps the Cookie and Origin to the host they were meant for: a redirect elsewhere loses them", async () => {
    const other = base.replace("127.0.0.1", "localhost");
    handler = (req, res) => {
      if (req.url === "/video.mp4") res.writeHead(302, { location: `${other}/final.mp4` }).end();
      else serveFile(req, res);
    };
    await downloader().download(
      source({
        headers: { Referer: "https://site.example/", Cookie: "sid=1", Origin: "https://s" },
      }),
      join(dir, "o.mp4"),
      context(),
    );
    expect(seen[0]).toMatchObject({ cookie: "sid=1", origin: "https://s" });
    expect(seen[1]?.url).toBe("/final.mp4");
    expect(seen[1]?.cookie).toBeUndefined();
    expect(seen[1]?.origin).toBeUndefined();
    expect(seen[1]?.referer).toBe("https://site.example/");
  });

  it("makes the host wait out a 429 or 503 for everyone, using its Retry-After", async () => {
    handler = (_req, res) => void res.writeHead(429, { "retry-after": "20" }).end();
    const { limiter, slept } = testLimiter();
    await downloader({ limiter })
      .download(source(), join(dir, "o.mp4"), context())
      .catch(() => null);
    await limiter.run(new URL(base).host, "metadata", undefined, async () => undefined);
    expect(slept).toEqual([20_000]);
  });
});

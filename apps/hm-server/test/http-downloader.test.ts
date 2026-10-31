import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

// 10 000 bytes that never repeat at a range boundary, so ranges joined out of order would show.
const BODY = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 7 + (i >> 8)) & 255));
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
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (match && !ignoreRange) {
    const start = Number(match[1]);
    if (start >= BODY.length) {
      res.writeHead(416, { "content-range": `bytes */${BODY.length}` }).end();
      return;
    }
    const end = match[2] ? Math.min(Number(match[2]), BODY.length - 1) : BODY.length - 1;
    res.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${BODY.length}`,
      "content-length": end - start + 1,
    });
    res.end(BODY.subarray(start, end + 1));
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
const downloader = (
  options: {
    limiter?: HostLimiter;
    guard?: UrlGuard;
    connectionsFor?: (host: string) => number;
  } = {},
) =>
  new HttpDownloader({
    minSplitBytes: 1000,
    rangeRetryDelayMs: 1,
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

describe("HttpDownloader over several connections", () => {
  const four = { connectionsFor: () => 4 };
  const rangesAsked = () => seen.map((s) => s.range).filter((r) => r !== "bytes=0-0");

  it("splits the file in ranges fetched side by side and joins them in order", async () => {
    const dest = join(dir, "out.mp4");
    const ctx = context();
    await downloader(four).download(source(), dest, ctx);
    expect((await readFile(dest)).equals(BODY)).toBe(true);
    expect(seen[0]?.range).toBe("bytes=0-0");
    expect(new Set(rangesAsked())).toEqual(
      new Set(["bytes=0-2499", "bytes=2500-4999", "bytes=5000-7499", "bytes=7500-9999"]),
    );
    expect(await readdir(dir)).toEqual(["out.mp4"]);
    expect(ctx.progress.at(-1)).toMatchObject({ bytes: BODY.length, total: BODY.length });
  });

  it("fetches the file whole when the server ignores Range, or it is small", async () => {
    handler = (req, res) => serveFile(req, res, { ignoreRange: true });
    const dest = join(dir, "out.mp4");
    await downloader(four).download(source(), dest, context());
    expect((await readFile(dest)).equals(BODY)).toBe(true);

    seen = [];
    handler = (req, res) => serveFile(req, res);
    const small = BODY.subarray(0, 500);
    await downloader(four)
      .download(
        source({ sizeBytes: 500, md5: createHash("md5").update(small).digest("hex") }),
        join(dir, "small.mp4"),
        context(),
      )
      .catch(() => undefined);
    expect(seen.map((s) => s.range)).not.toContain("bytes=0-0");
  });

  it("asks nothing extra with one connection", async () => {
    await downloader({ connectionsFor: () => 1 }).download(source(), join(dir, "o.mp4"), context());
    expect(seen.map((s) => s.range)).toEqual([undefined]);
  });

  it("retries a range that drops, resuming it from what its file holds", async () => {
    let dropped = false;
    handler = (req, res) => {
      if (!dropped && req.headers.range === "bytes=2500-4999") {
        dropped = true;
        res.writeHead(206, {
          "content-range": `bytes 2500-4999/${BODY.length}`,
          "content-length": 2500,
        });
        res.write(BODY.subarray(2500, 3500));
        setTimeout(() => res.destroy(), 20);
        return;
      }
      serveFile(req, res);
    };
    const dest = join(dir, "out.mp4");
    await downloader(four).download(source(), dest, context());
    expect((await readFile(dest)).equals(BODY)).toBe(true);
    expect(rangesAsked()).toContain("bytes=3500-4999");
  });

  it("resumes the ranges an earlier attempt left on disk", async () => {
    const dest = join(dir, "out.mp4");
    await writeFile(`${dest}.part.0-of-4`, BODY.subarray(0, 2500));
    await writeFile(`${dest}.part.1-of-4`, BODY.subarray(2500, 3000));
    await writeFile(`${dest}.part.0-of-2`, BODY.subarray(0, 100));
    await downloader(four).download(source(), dest, context());
    expect((await readFile(dest)).equals(BODY)).toBe(true);
    expect(rangesAsked()).not.toContain("bytes=0-2499");
    expect(rangesAsked()).toContain("bytes=3000-4999");
    expect(await readdir(dir)).toEqual(["out.mp4"]);
  });

  it("gives up on a range that keeps failing, and stops the others", async () => {
    handler = (req, res) => {
      if (req.headers.range === "bytes=5000-7499") return void res.destroy();
      serveFile(req, res);
    };
    await expect(
      downloader(four).download(source(), join(dir, "out.mp4"), context()),
    ).rejects.toBeInstanceOf(RetryableError);
    expect(seen.filter((s) => s.range === "bytes=5000-7499")).toHaveLength(4);
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
    const guard: UrlGuard = {
      assertUrl: async (url) => {
        checked.push(url);
        return new URL(url);
      },
    };
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

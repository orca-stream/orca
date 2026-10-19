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
import type { HostLimiter } from "../src/infrastructure/host-limiter.ts";
import { testLimiter } from "./helpers.ts";

const BODY = Buffer.from("0123456789".repeat(1000)); // 10 000 bytes
const MD5 = createHash("md5").update(BODY).digest("hex");

interface Seen {
  range: string | undefined;
  userAgent: string | undefined;
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
    seen.push({ range: req.headers.range, userAgent: req.headers["user-agent"] });
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

const downloader = (options: { limiter?: HostLimiter } = {}) =>
  new HttpDownloader({ userAgent: "OrcaHM/test", limiter: testLimiter().limiter, ...options });
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
    expect(seen[0]).toEqual({ range: undefined, userAgent: "OrcaHM/test" });
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

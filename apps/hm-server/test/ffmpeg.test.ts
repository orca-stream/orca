import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vite-plus/test";
import { AbortedError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import {
  createProgressParser,
  outTimeSeconds,
} from "../src/infrastructure/download/ffmpeg-progress.ts";
import { FfmpegDownloader } from "../src/infrastructure/download/ffmpeg-downloader.ts";

// Recorded from `ffmpeg -progress pipe:1` (ffmpeg 6.1): two blocks.
const SAMPLE = `frame=0
fps=0.00
stream_0_0_q=0.0
bitrate=N/A
total_size=0
out_time_us=N/A
out_time_ms=N/A
out_time=N/A
dup_frames=0
drop_frames=0
speed=N/A
progress=continue
frame=20
fps=0.00
stream_0_0_q=-1.0
bitrate=  15.3kbits/s
total_size=3259
out_time_us=1700000
out_time_ms=1700000
out_time=00:00:01.700000
dup_frames=0
drop_frames=0
speed= 194x
progress=end
`;

describe("ffmpeg -progress parser", () => {
  it("emits one block per progress= line, however the output is chunked", () => {
    const blocks: Record<string, string>[] = [];
    const parser = createProgressParser((block) => blocks.push(block));
    for (let i = 0; i < SAMPLE.length; i += 17) parser.push(SAMPLE.slice(i, i + 17));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ frame: "0", out_time_us: "N/A", progress: "continue" });
    expect(blocks[1]).toMatchObject({
      frame: "20",
      total_size: "3259",
      bitrate: "15.3kbits/s",
      speed: "194x",
      progress: "end",
    });
  });

  it("reads the position from out_time_us (out_time_ms is microseconds too)", () => {
    expect(outTimeSeconds({ out_time_us: "1700000", out_time_ms: "1700000" })).toBe(1.7);
    expect(outTimeSeconds({ out_time_us: "N/A" })).toBeUndefined();
    expect(outTimeSeconds({})).toBeUndefined();
    expect(outTimeSeconds({ out_time_us: "-9223372036854775807" })).toBeUndefined();
  });

  it("handles CRLF output", () => {
    const blocks: Record<string, string>[] = [];
    createProgressParser((b) => blocks.push(b)).push("frame=1\r\nprogress=end\r\n");
    expect(blocks).toEqual([{ frame: "1", progress: "end" }]);
  });
});

function fakeSpawn(script: (child: FakeChild) => void) {
  return ((_command: string, args: string[], options: { signal?: AbortSignal }) => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.args = args;
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      child.emit("error", error);
    });
    queueMicrotask(() => script(child));
    return child;
  }) as never;
}
interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  args: string[];
}

const hls = {
  kind: "hls" as const,
  url: "https://cdn.example/master.m3u8",
  headers: { Referer: "https://site.example/" },
  durationSec: 100,
};
const context = () => {
  const progress: { fraction?: number | undefined }[] = [];
  return {
    signal: new AbortController().signal,
    onProgress: (p: { fraction?: number }) => void progress.push(p),
    progress,
  };
};

describe("FfmpegDownloader with a fake ffmpeg", () => {
  it("passes the headers and reports progress as a fraction of the duration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-"));
    let args: string[] = [];
    const downloader = new FfmpegDownloader({
      userAgent: "OrcaHM/test",
      spawn: fakeSpawn((child) => {
        args = child.args;
        writeFileSync(child.args.at(-1) as string, "data"); // ffmpeg's output file
        child.stdout.write("out_time_us=25000000\ntotal_size=10\nprogress=continue\n");
        child.stdout.write("out_time_us=100000000\ntotal_size=40\nprogress=end\n");
        child.stdout.end();
        setTimeout(() => child.emit("close", 0), 5);
      }),
    });
    const ctx = context();
    await downloader.download(hls, join(dir, "out.mkv"), ctx);
    expect(args.join(" ")).toContain("-progress pipe:1");
    expect(args).toContain("Referer: https://site.example/\r\n");
    expect(args).toContain("https://cdn.example/master.m3u8");
    expect(ctx.progress.map((p) => p.fraction)).toEqual([0.25, 1]);
    expect(await readFile(join(dir, "out.mkv"), "utf8")).toBe("data");
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["Server returned 404 Not Found", PermanentError],
    ["Server returned 403 Forbidden", PermanentError],
    ["Connection timed out", RetryableError],
    ["Server returned 503 Service Unavailable", RetryableError],
    ["Server returned 429 Too Many Requests", RetryableError],
  ])("classifies %s", async (message, expected) => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-"));
    const downloader = new FfmpegDownloader({
      userAgent: "x",
      spawn: fakeSpawn((child) => {
        child.stderr.write(`${message}\n`);
        child.stdout.end();
        setTimeout(() => child.emit("close", 1), 5);
      }),
    });
    await expect(downloader.download(hls, join(dir, "o.mkv"), context())).rejects.toBeInstanceOf(
      expected,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("says ffmpeg is missing instead of retrying forever", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-"));
    const downloader = new FfmpegDownloader({
      userAgent: "x",
      spawn: fakeSpawn((child) => {
        const error = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        child.emit("error", error);
      }),
    });
    await expect(downloader.download(hls, join(dir, "o.mkv"), context())).rejects.toBeInstanceOf(
      PermanentError,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("aborts, and leaves no part behind (ffmpeg can't resume)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-"));
    const controller = new AbortController();
    const downloader = new FfmpegDownloader({
      userAgent: "x",
      spawn: fakeSpawn(() => setTimeout(() => controller.abort(), 5)),
    });
    await expect(
      downloader.download(hls, join(dir, "o.mkv"), {
        signal: controller.signal,
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(AbortedError);
    expect(await readdir(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("FfmpegDownloader with the real ffmpeg (opt-in: needs ffmpeg)", () => {
  it("copies an HLS stream served over HTTP into an mkv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-real-"));
    try {
      const made = spawnSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=4:size=64x64:rate=10",
        "-c:v",
        "libx264",
        "-g",
        "10",
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "0",
        join(dir, "stream.m3u8"),
      ]);
      expect(made.status).toBe(0);
      const server = createServer((req, res) => {
        readFile(join(dir, (req.url ?? "/").slice(1)))
          .then((body) => res.writeHead(200).end(body))
          .catch(() => res.writeHead(404).end());
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream.m3u8`;
      const ctx = context();
      const out = join(dir, "out.mkv");
      await new FfmpegDownloader({ userAgent: "OrcaHM/test" }).download(
        { kind: "hls", url, durationSec: 4 },
        out,
        ctx,
      );
      server.close();
      expect((await stat(out)).size).toBeGreaterThan(0);
      expect(ctx.progress.at(-1)?.fraction).toBeGreaterThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

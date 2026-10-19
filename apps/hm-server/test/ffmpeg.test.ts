import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { FfprobeInspector, MediaProbeError, type ProbeResult } from "@orca/media-probe";
import { describe, expect, it } from "vite-plus/test";
import { AbortedError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import {
  createProgressParser,
  outTimeSeconds,
} from "../src/infrastructure/download/ffmpeg-progress.ts";
import type { UrlGuard } from "../src/application/ports.ts";
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
      guard: allowAll,
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
    // Only network protocols may be read as input: never file: or anything local.
    const whitelist = args[args.indexOf("-protocol_whitelist") + 1];
    expect(whitelist).toBe("http,https,tcp,tls,crypto");
    expect(args.indexOf("-protocol_whitelist")).toBeLessThan(args.indexOf("-i"));
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
      guard: allowAll,
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
      guard: allowAll,
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
      guard: allowAll,
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

const allowAll: UrlGuard = { assertUrl: async (url) => new URL(url) };

const probeFixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/media-probe/test/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as ProbeResult;

/** An inspector that answers with a recorded ffprobe result and remembers what it was asked. */
function fakeInspector(result: ProbeResult | Error) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  return {
    calls,
    async inspect(url: string, options: { signal: AbortSignal; headers?: Record<string, string> }) {
      calls.push({ url, headers: options.headers });
      if (result instanceof Error) throw result;
      return structuredClone(result);
    },
  };
}

/** A fake ffmpeg that writes its output file, remembering every run's arguments. */
function recordingSpawn(options: { failWhen?: (args: string[]) => boolean } = {}) {
  const runs: string[][] = [];
  const spawn = fakeSpawn((child) => {
    runs.push(child.args);
    if (options.failWhen?.(child.args)) {
      child.stderr.write("Subtitle conversion failed\n");
      child.stdout.end();
      setTimeout(() => child.emit("close", 1), 1);
      return;
    }
    writeFileSync(child.args.at(-1) as string, "data");
    child.stdout.end();
    setTimeout(() => child.emit("close", 0), 1);
  });
  return { runs, spawn };
}

const mapsOf = (args: string[]) => args.flatMap((arg, i) => (args[i - 1] === "-map" ? [arg] : []));

describe("FfmpegDownloader choosing tracks with the inspector", () => {
  const withDir = async (run: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "hm-ff-sel-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("inspects with the detected headers and maps every track of a multi-audio stream into an mkv", async () => {
    await withDir(async (dir) => {
      const inspector = fakeInspector(probeFixture("mkv-two-audio-two-subs"));
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector,
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(inspector.calls).toEqual([{ url: hls.url, headers: hls.headers }]);
      expect(mapsOf(runs[0]!)).toEqual(["0:0", "0:1", "0:2", "0:3", "0:4"]);
      expect(runs[0]!.join(" ")).toContain("-c:s:0 copy -c:s:1 copy");
      expect(runs[0]!.slice(-4, -1)).toEqual(["-f", "matroska", "-y"]);
      expect(result.path ?? join(dir, "out.mkv")).toBe(join(dir, "out.mkv"));
    });
  });

  it("writes an mp4 when there is one audio track and no subtitles, and says where it is", async () => {
    await withDir(async (dir) => {
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("mp4-single-audio")),
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(result.path).toBe(join(dir, "out.mp4"));
      expect(runs[0]!.slice(-4, -1)).toEqual(["-f", "mp4", "-y"]);
      expect(await readdir(dir)).toEqual(["out.mp4"]);
    });
  });

  it("takes the tallest rendition that fits maxHeight, and only the wanted languages", async () => {
    await withDir(async (dir) => {
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("hls-two-renditions")),
      });
      await downloader.download(hls, join(dir, "out.mkv"), {
        ...context(),
        prefs: { maxHeight: 360, audioLangs: ["spa"] },
      });
      const maps = mapsOf(runs[0]!);
      expect(maps).toContain("0:3");
      expect(maps).not.toContain("0:2");
      expect(maps).toContain("0:1");
      expect(maps).not.toContain("0:0");
    });
  });

  it("leaves subtitles out when the preference is an empty list", async () => {
    await withDir(async (dir) => {
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("mkv-two-audio-two-subs")),
      });
      await downloader.download(hls, join(dir, "out.mkv"), {
        ...context(),
        prefs: { subtitleLangs: [] },
      });
      expect(mapsOf(runs[0]!)).toEqual(["0:0", "0:1", "0:2"]);
      expect(runs[0]!.join(" ")).not.toContain("-c:s");
    });
  });

  it("can write the subtitles as files beside the video instead, one ffmpeg run each", async () => {
    await withDir(async (dir) => {
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("mkv-two-audio-two-subs")),
        externalSubtitles: true,
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(mapsOf(runs[0]!)).toEqual(["0:0", "0:1", "0:2"]);
      expect(mapsOf(runs[1]!)).toEqual(["0:3"]);
      expect(mapsOf(runs[2]!)).toEqual(["0:4"]);
      expect(runs[1]!.join(" ")).toContain("-c:s srt -f srt");
      expect(
        result.sidecars?.map(({ language, forced, format }) => ({ language, forced, format })),
      ).toEqual([
        { language: "eng", forced: false, format: "srt" },
        { language: "spa", forced: true, format: "srt" },
      ]);
      for (const sidecar of result.sidecars ?? []) {
        expect(await readFile(sidecar.path, "utf8")).toBe("data");
      }
    });
  });

  it("does not fail the episode because one subtitle could not be written", async () => {
    await withDir(async (dir) => {
      const { spawn } = recordingSpawn({ failWhen: (args) => args.includes("0:3") });
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("mkv-two-audio-two-subs")),
        externalSubtitles: true,
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(result.sidecars?.map((s) => s.language)).toEqual(["spa"]);
      expect((await readdir(dir)).sort()).toEqual(["out.mkv", "out.mkv.sub1.srt"]);
    });
  });

  it("refuses a stream address the guard refuses, before probing or running anything", async () => {
    await withDir(async (dir) => {
      const inspector = fakeInspector(probeFixture("mp4-single-audio"));
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        userAgent: "x",
        spawn,
        inspector,
        guard: {
          assertUrl: async () => {
            throw new PermanentError("Refusing: private or internal address");
          },
        },
      });
      await expect(downloader.download(hls, join(dir, "o.mkv"), context())).rejects.toBeInstanceOf(
        PermanentError,
      );
      expect(inspector.calls).toEqual([]);
      expect(runs).toEqual([]);
    });
  });

  it("drops a language tag that is not a language, and keeps the subtitle", async () => {
    await withDir(async (dir) => {
      const probe = probeFixture("mkv-two-audio-two-subs");
      probe.streams[3]!.tags = { language: "English subtitles!" };
      probe.streams[4]!.tags = { language: "spa" };
      const { spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probe),
        externalSubtitles: true,
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(result.sidecars?.map((s) => s.language)).toEqual([undefined, "spa"]);
    });
  });

  it("does not write two files for an unknown language and 'und', which would share a name", async () => {
    await withDir(async (dir) => {
      const probe = probeFixture("mkv-two-audio-two-subs");
      probe.streams[3]!.tags = {};
      probe.streams[4]!.tags = { language: "und" };
      probe.streams[4]!.disposition = {};
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probe),
        externalSubtitles: true,
      });
      const result = await downloader.download(hls, join(dir, "out.mkv"), context());
      expect(result.sidecars).toHaveLength(1);
      expect(runs).toHaveLength(2); // the video and the first subtitle only
    });
  });

  it("leaves nothing behind when it is aborted after some subtitles were written", async () => {
    await withDir(async (dir) => {
      const controller = new AbortController();
      let run = 0;
      const spawn = fakeSpawn((child) => {
        run += 1;
        if (run < 3) {
          writeFileSync(child.args.at(-1) as string, "data");
          child.stdout.end();
          setTimeout(() => child.emit("close", 0), 1);
        } else {
          // the second subtitle: the signal fires while ffmpeg runs
          setTimeout(() => controller.abort(), 2);
        }
      });
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(probeFixture("mkv-two-audio-two-subs")),
        externalSubtitles: true,
      });
      await expect(
        downloader.download(hls, join(dir, "out.mkv"), {
          signal: controller.signal,
          onProgress: () => {},
        }),
      ).rejects.toBeInstanceOf(AbortedError);
      expect(await readdir(dir)).toEqual([]);
    });
  });

  it.each([
    [new MediaProbeError("exit", "ffprobe exited with 1"), RetryableError],
    [new MediaProbeError("timeout", "slow"), RetryableError],
    [new MediaProbeError("no-video", "no video"), PermanentError],
    [new MediaProbeError("parse", "bad json"), PermanentError],
    [new MediaProbeError("aborted", "stop"), AbortedError],
  ])("maps the inspector's %s failure to the queue's errors", async (failure, expected) => {
    await withDir(async (dir) => {
      const { runs, spawn } = recordingSpawn();
      const downloader = new FfmpegDownloader({
        guard: allowAll,
        userAgent: "x",
        spawn,
        inspector: fakeInspector(failure),
      });
      await expect(downloader.download(hls, join(dir, "o.mkv"), context())).rejects.toBeInstanceOf(
        expected,
      );
      expect(runs).toEqual([]);
    });
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
      await new FfmpegDownloader({ guard: allowAll, userAgent: "OrcaHM/test" }).download(
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

const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg || !hasFfprobe)(
  "FfmpegDownloader choosing tracks with the real ffmpeg and ffprobe (opt-in: needs both)",
  () => {
    /** A small mkv with two audio tracks and two text subtitles, served over HTTP like a stream. */
    async function withStream(run: (url: string, dir: string) => Promise<void>) {
      const dir = await mkdtemp(join(tmpdir(), "hm-ff-sel-real-"));
      const srt = (text: string) => `1\n00:00:00,000 --> 00:00:02,000\n${text}\n`;
      writeFileSync(join(dir, "en.srt"), srt("Hello"));
      writeFileSync(join(dir, "es.srt"), srt("Hola"));
      const made = spawnSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=3:size=64x64:rate=10",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=3",
        "-i",
        join(dir, "en.srt"),
        "-i",
        join(dir, "es.srt"),
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-map",
        "2:a",
        "-map",
        "3:s",
        "-map",
        "4:s",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-c:s",
        "srt",
        "-metadata:s:a:0",
        "language=eng",
        "-metadata:s:a:1",
        "language=spa",
        "-metadata:s:s:0",
        "language=eng",
        "-metadata:s:s:1",
        "language=spa",
        join(dir, "stream.mkv"),
      ]);
      expect(made.status).toBe(0);
      const server = createServer((req, res) => {
        readFile(join(dir, (req.url ?? "/").slice(1)))
          .then((body) => res.writeHead(200, { "content-length": body.length }).end(body))
          .catch(() => res.writeHead(404).end());
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/stream.mkv`, dir);
      } finally {
        server.close();
        await rm(dir, { recursive: true, force: true });
      }
    }

    const tracks = (path: string) =>
      JSON.parse(
        spawnSync("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          path,
        ]).stdout.toString(),
      ).streams.map(
        (s: { codec_type: string; tags?: { language?: string } }) =>
          `${s.codec_type}:${s.tags?.language ?? ""}`,
      ) as string[];

    it("keeps both audio tracks and both subtitles inside the mkv", async () => {
      await withStream(async (url, dir) => {
        const out = join(dir, "out.mkv");
        const result = await new FfmpegDownloader({
          guard: allowAll,
          userAgent: "x",
          inspector: new FfprobeInspector({ timeoutMs: 30_000 }),
        }).download({ kind: "hls", url }, out, context());
        expect(result.path).toBeUndefined();
        expect(tracks(out)).toEqual([
          "video:",
          "audio:eng",
          "audio:spa",
          "subtitle:eng",
          "subtitle:spa",
        ]);
      });
    });

    it("keeps one language of audio and none of the subtitles when asked", async () => {
      await withStream(async (url, dir) => {
        const out = join(dir, "out.mkv");
        const result = await new FfmpegDownloader({
          guard: allowAll,
          userAgent: "x",
          inspector: new FfprobeInspector({ timeoutMs: 30_000 }),
        }).download({ kind: "hls", url }, out, {
          ...context(),
          prefs: { audioLangs: ["spa"], subtitleLangs: [] },
        });
        // One audio track and no subtitles fit an mp4, and the caller is told.
        expect(result.path).toBe(join(dir, "out.mp4"));
        expect(tracks(result.path!)).toEqual(["video:und", "audio:spa"]);
      });
    });

    it("writes the subtitles as srt files beside it when told to", async () => {
      await withStream(async (url, dir) => {
        const out = join(dir, "out.mkv");
        const result = await new FfmpegDownloader({
          guard: allowAll,
          userAgent: "x",
          inspector: new FfprobeInspector({ timeoutMs: 30_000 }),
          externalSubtitles: true,
        }).download({ kind: "hls", url }, out, context());
        expect(tracks(out)).toEqual(["video:", "audio:eng", "audio:spa"]);
        expect(result.sidecars?.map((s) => s.language)).toEqual(["eng", "spa"]);
        expect(await readFile(result.sidecars![1]!.path, "utf8")).toContain("Hola");
      });
    });
  },
);

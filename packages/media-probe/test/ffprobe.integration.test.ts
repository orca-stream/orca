import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { FfprobeInspector, MediaProbeError, selectStreams } from "../src/index.ts";

// Opt-in: needs `HM_FFPROBE=1` and ffmpeg + ffprobe on the PATH. CI runs without it.
function hasTool(name: string): boolean {
  try {
    execFileSync(name, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const enabled = process.env["HM_FFPROBE"] === "1" && hasTool("ffprobe") && hasTool("ffmpeg");

describe.skipIf(!enabled)("FfprobeInspector against real ffprobe", () => {
  let dir: string;
  let server: Server;
  let origin: string;
  const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "orca-probe-"));
    const srt = join(dir, "en.srt");
    writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x180:rate=10:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:duration=1",
        "-i",
        srt,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-map",
        "2:a",
        "-map",
        "3",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-c:s",
        "srt",
        "-metadata:s:a:0",
        "language=jpn",
        "-metadata:s:a:1",
        "language=spa",
        "-metadata:s:s:0",
        "language=eng",
        join(dir, "multi.mkv"),
      ],
      { stdio: "ignore" },
    );
    server = createServer((req, res) => {
      seenHeaders.push(req.headers);
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/multi.mkv") {
        res
          .writeHead(200, { "content-type": "video/x-matroska" })
          .end(readFileSync(join(dir, "multi.mkv")));
      } else if (path === "/hang") {
        res.writeHead(200, { "content-type": "video/x-matroska" }); // never ends
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.closeAllConnections();
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("probes a real file, sends the headers, and the result feeds selectStreams", async () => {
    const probe = await new FfprobeInspector({ timeoutMs: 20_000 }).inspect(`${origin}/multi.mkv`, {
      signal: new AbortController().signal,
      headers: { Referer: "https://site.test/watch", Cookie: "sid=1" },
    });
    expect(probe.streams.map((s) => s.codec_type)).toEqual(["video", "audio", "audio", "subtitle"]);
    expect(
      seenHeaders.some(
        (h) => h["referer"] === "https://site.test/watch" && h["cookie"] === "sid=1",
      ),
    ).toBe(true);

    const selection = selectStreams(probe, { originalLanguage: "spa" });
    expect(selection.container).toBe("mkv");
    expect(selection.maps).toEqual(["-map", "0:0", "-map", "0:2", "-map", "0:1", "-map", "0:3"]);
  });

  it("reports a failing URL as an exit error", async () => {
    await expect(
      new FfprobeInspector({ timeoutMs: 20_000 }).inspect(`${origin}/missing.mkv`, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "MediaProbeError", reason: "exit" });
  });

  it("stops ffprobe when aborted", async () => {
    const controller = new AbortController();
    const pending = new FfprobeInspector({}).inspect(`${origin}/hang`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaProbeError);
    expect((error as MediaProbeError).reason).toBe("aborted");
  });

  it("times out", async () => {
    const error = await new FfprobeInspector({ timeoutMs: 500 })
      .inspect(`${origin}/hang`, { signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect((error as MediaProbeError).reason).toBe("timeout");
    expect((error as MediaProbeError).retryable).toBe(true);
  });
});

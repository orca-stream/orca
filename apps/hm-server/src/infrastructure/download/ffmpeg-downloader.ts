import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { DownloadContext, Downloader } from "../../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../../domain/errors.ts";
import type { Source } from "../../domain/series.ts";
import { createProgressParser, outTimeSeconds } from "./ffmpeg-progress.ts";

type Spawn = typeof nodeSpawn;

const INPUT_PROTOCOLS = "http,https,tcp,tls,crypto";
type StreamSource = Extract<Source, { kind: "hls" }>;

export interface FfmpegDownloaderOptions {
  userAgent: string;
  ffmpegPath?: string;
  spawn?: Spawn;
}

/** Last lines of ffmpeg's stderr decide whether a failure is worth retrying. */
function classify(stderr: string, code: number | null): Error {
  const message = stderr.trim().split("\n").slice(-3).join(" | ") || `ffmpeg exited with ${code}`;
  const status = /Server returned (\d{3})/.exec(stderr)?.[1];
  if (status && status.startsWith("4") && status !== "429" && status !== "408") {
    return new PermanentError(`Stream refused: ${message}`);
  }
  return new RetryableError(`ffmpeg failed: ${message}`);
}

/** Downloads HLS/DASH streams by letting ffmpeg copy them into an mkv; plain files use HttpDownloader. */
export class FfmpegDownloader implements Downloader {
  private readonly userAgent: string;
  private readonly ffmpegPath: string;
  private readonly spawn: Spawn;

  constructor(options: FfmpegDownloaderOptions) {
    this.userAgent = options.userAgent;
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.spawn = options.spawn ?? nodeSpawn;
  }

  canHandle(source: Source): boolean {
    return source.kind === "hls";
  }

  async download(
    source: Source,
    destPath: string,
    context: DownloadContext,
  ): Promise<{ bytes: number }> {
    if (source.kind !== "hls") throw new PermanentError(`Not a stream source: ${source.kind}`);
    await mkdir(dirname(destPath), { recursive: true });
    const part = `${destPath}.part`;
    // ffmpeg can't resume a partial copy, so any leftover part is stale.
    await rm(part, { force: true });
    try {
      await this.run(source, part, context);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    await rename(part, destPath);
    return { bytes: (await stat(destPath)).size };
  }

  private run(source: StreamSource, part: string, context: DownloadContext): Promise<void> {
    const headers = Object.entries(source.headers ?? {})
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-progress",
      "pipe:1",
      // Read the network only: no file:, no local playlists or keys.
      "-protocol_whitelist",
      INPUT_PROTOCOLS,
      "-user_agent",
      this.userAgent,
      ...(headers ? ["-headers", headers] : []),
      "-i",
      source.url,
      "-c",
      "copy",
      "-f",
      "matroska",
      "-y",
      part,
    ];

    return new Promise<void>((resolve, reject) => {
      const child = this.spawn(this.ffmpegPath, args, { signal: context.signal });
      let stderr = "";
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };

      const parser = createProgressParser((block) => {
        const seconds = outTimeSeconds(block);
        const bytes = Number(block.total_size);
        context.onProgress({
          bytes: Number.isFinite(bytes) ? bytes : 0,
          ...(seconds !== undefined && source.durationSec
            ? { fraction: Math.min(1, seconds / source.durationSec) }
            : {}),
        });
      });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => parser.push(chunk));
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.name === "AbortError" || context.signal.aborted) {
          settle(() => reject(new AbortedError({ cause: error })));
        } else if (error.code === "ENOENT") {
          settle(() => reject(new PermanentError("ffmpeg is not installed", { cause: error })));
        } else {
          settle(() =>
            reject(new RetryableError(`Could not run ffmpeg: ${error.message}`, { cause: error })),
          );
        }
      });
      child.on("close", (code) => {
        if (code === 0) settle(resolve);
        else if (context.signal.aborted) settle(() => reject(new AbortedError()));
        else settle(() => reject(classify(stderr, code)));
      });
    });
  }
}

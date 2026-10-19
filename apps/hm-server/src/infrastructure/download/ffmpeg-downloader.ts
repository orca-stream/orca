import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import {
  MediaProbeError,
  selectStreams,
  type SelectionPrefs,
  type StreamInspector,
  type StreamSelection,
} from "@orca/media-probe";
import type {
  DownloadContext,
  DownloadResult,
  Downloader,
  Sidecar,
  UrlGuard,
} from "../../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../../domain/errors.ts";
import type { Source } from "../../domain/series.ts";
import { createProgressParser, outTimeSeconds } from "./ffmpeg-progress.ts";

type Spawn = typeof nodeSpawn;

const INPUT_PROTOCOLS = "http,https,tcp,tls,crypto";
type StreamSource = Extract<Source, { kind: "hls" }>;

export interface FfmpegDownloaderOptions {
  userAgent: string;
  /** Checks the manifest address. The segments it lists are out of reach: see docs "Residual risks". */
  guard: UrlGuard;
  ffmpegPath?: string;
  spawn?: Spawn;
  /** Looks inside a stream before copying it, to keep only the wanted tracks. Absent: ffmpeg's own pick. */
  inspector?: Pick<StreamInspector, "inspect">;
  /** Write text subtitles as files beside the video (`Show S01E01.es.srt`) instead of inside it. */
  externalSubtitles?: boolean;
}

/** What to copy and into which container, as ffmpeg arguments. */
interface Plan {
  maps: string[];
  subtitleArgs: string[];
  format: "matroska" | "mp4";
  extension: ".mkv" | ".mp4";
  /** Text subtitle streams to write as files, when they are not embedded. */
  external: StreamSelection["subtitles"];
}

const DEFAULT_PLAN: Plan = {
  maps: [],
  subtitleArgs: [],
  format: "matroska",
  extension: ".mkv",
  external: [],
};

/** Last lines of ffmpeg's stderr decide whether a failure is worth retrying. */
function classify(stderr: string, code: number | null): Error {
  const message = stderr.trim().split("\n").slice(-3).join(" | ") || `ffmpeg exited with ${code}`;
  const status = /Server returned (\d{3})/.exec(stderr)?.[1];
  if (status && status.startsWith("4") && status !== "429" && status !== "408") {
    return new PermanentError(`Stream refused: ${message}`);
  }
  return new RetryableError(`ffmpeg failed: ${message}`);
}

/** A language tag as Jellyfin reads it in a file name; anything else (or "und") means unknown. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
function languageOf(tags: Record<string, string> | undefined): string | undefined {
  const raw = Object.entries(tags ?? {}).find(([name]) => name.toLowerCase() === "language")?.[1];
  const tag = raw?.trim().toLowerCase();
  return tag && tag !== "und" && LANGUAGE_TAG.test(tag) ? tag : undefined;
}

function probeError(error: MediaProbeError): Error {
  if (error.reason === "aborted") return new AbortedError({ cause: error });
  if (error.retryable) return new RetryableError(error.message, { cause: error });
  return new PermanentError(error.message, { cause: error });
}

const withoutExtension = (path: string) => path.slice(0, path.length - extname(path).length);

/**
 * Downloads HLS/DASH streams by letting ffmpeg copy them into an mkv or mp4. With an inspector it
 * first looks at the tracks and keeps the best video that fits, the wanted audio and the text
 * subtitles. Plain files use HttpDownloader.
 */
export class FfmpegDownloader implements Downloader {
  private readonly userAgent: string;
  private readonly guard: UrlGuard;
  private readonly ffmpegPath: string;
  private readonly spawn: Spawn;
  private readonly inspector: Pick<StreamInspector, "inspect"> | undefined;
  private readonly externalSubtitles: boolean;

  constructor(options: FfmpegDownloaderOptions) {
    this.userAgent = options.userAgent;
    this.guard = options.guard;
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.spawn = options.spawn ?? nodeSpawn;
    this.inspector = options.inspector;
    this.externalSubtitles = options.externalSubtitles ?? false;
  }

  canHandle(source: Source): boolean {
    return source.kind === "hls";
  }

  async download(
    source: Source,
    destPath: string,
    context: DownloadContext,
  ): Promise<DownloadResult> {
    if (source.kind !== "hls") throw new PermanentError(`Not a stream source: ${source.kind}`);
    await this.guard.assertUrl(source.url);
    await mkdir(dirname(destPath), { recursive: true });
    const plan = await this.plan(source, context);
    // The staged name asks for .mkv; a stream that fits an mp4 gets one, and the caller is told.
    const finalPath = `${withoutExtension(destPath)}${plan.extension}`;
    const part = `${finalPath}.part`;
    // ffmpeg can't resume a partial copy, so any leftover part is stale.
    await rm(part, { force: true });
    const sidecars: Sidecar[] = [];
    try {
      await this.copy(source, part, plan, context);
      await rename(part, finalPath);
      await this.writeSubtitleFiles(source, finalPath, plan, context, sidecars);
    } catch (error) {
      // ffmpeg can't resume, so a half-done episode (video without all its subtitle files) is no use.
      await rm(part, { force: true });
      await rm(finalPath, { force: true });
      await Promise.all(sidecars.map((sidecar) => rm(sidecar.path, { force: true })));
      throw error;
    }
    return {
      bytes: (await stat(finalPath)).size,
      ...(finalPath === destPath ? {} : { path: finalPath }),
      ...(sidecars.length > 0 ? { sidecars } : {}),
    };
  }

  private async plan(source: StreamSource, context: DownloadContext): Promise<Plan> {
    if (!this.inspector) return DEFAULT_PLAN;
    const prefs = context.prefs ?? {};
    const wanted: SelectionPrefs = {
      ...(prefs.maxHeight !== undefined ? { maxHeight: prefs.maxHeight } : {}),
      ...(prefs.audioLangs !== undefined ? { audioLangs: prefs.audioLangs } : {}),
      ...(prefs.subtitleLangs !== undefined ? { subtitleLangs: prefs.subtitleLangs } : {}),
    };
    try {
      const probe = await this.inspector.inspect(source.url, {
        signal: context.signal,
        ...(source.headers ? { headers: source.headers } : {}),
      });
      if (!this.externalSubtitles) return planOf(selectStreams(probe, wanted), []);
      // Subtitles go to files: choose the tracks without them, and the files separately.
      const video = selectStreams(probe, { ...wanted, subtitleLangs: [] });
      return planOf(video, selectStreams(probe, wanted).subtitles);
    } catch (error) {
      if (error instanceof MediaProbeError) throw probeError(error);
      throw error;
    }
  }

  private copy(
    source: StreamSource,
    part: string,
    plan: Plan,
    context: DownloadContext,
  ): Promise<void> {
    const args = [
      ...this.inputArgs(source),
      ...plan.maps,
      "-c",
      "copy",
      ...plan.subtitleArgs,
      "-f",
      plan.format,
      "-y",
      part,
    ];
    return this.exec(args, context, (block) => {
      const seconds = outTimeSeconds(block);
      const bytes = Number(block.total_size);
      context.onProgress({
        bytes: Number.isFinite(bytes) ? bytes : 0,
        ...(seconds !== undefined && source.durationSec
          ? { fraction: Math.min(1, seconds / source.durationSec) }
          : {}),
      });
    });
  }

  /** One run per track, so a track ffmpeg cannot convert costs only itself. */
  private async writeSubtitleFiles(
    source: StreamSource,
    videoPath: string,
    plan: Plan,
    context: DownloadContext,
    written: Sidecar[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const [i, stream] of plan.external.entries()) {
      const language = languageOf(stream.tags);
      const forced = (stream.disposition?.forced ?? 0) === 1;
      // Two tracks with the same language and flag would get the same file name.
      const key = `${language ?? ""}|${forced}`;
      if (seen.has(key)) continue;
      const path = `${videoPath}.sub${i}.srt`;
      try {
        await this.exec(
          [
            ...this.inputArgs(source),
            "-map",
            `0:${stream.index}`,
            "-c:s",
            "srt",
            "-f",
            "srt",
            "-y",
            path,
          ],
          context,
        );
      } catch (error) {
        await rm(path, { force: true });
        if (error instanceof AbortedError || context.signal.aborted) throw error;
        continue;
      }
      seen.add(key);
      written.push({ path, language, forced, format: "srt" });
    }
  }

  private inputArgs(source: StreamSource): string[] {
    const headers = Object.entries(source.headers ?? {})
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");
    return [
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
    ];
  }

  private exec(
    args: string[],
    context: DownloadContext,
    onProgress?: (block: Record<string, string>) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = this.spawn(this.ffmpegPath, args, { signal: context.signal });
      let stderr = "";
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };

      const parser = createProgressParser((block) => onProgress?.(block));
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

function planOf(selection: StreamSelection, external: StreamSelection["subtitles"]): Plan {
  const mp4 = selection.container === "mp4";
  return {
    maps: selection.maps,
    subtitleArgs: selection.subtitleArgs,
    format: mp4 ? "mp4" : "matroska",
    extension: mp4 ? ".mp4" : ".mkv",
    external,
  };
}

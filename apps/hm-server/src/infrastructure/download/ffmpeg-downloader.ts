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
import type { HlsCopier } from "./hls-copier.ts";

type Spawn = typeof nodeSpawn;

const INPUT_PROTOCOLS = "http,https,tcp,tls,crypto";
/** A copied stream is read from disk only: its playlists name nothing but the files beside them. */
export const LOCAL_PROTOCOLS = "file,crypto";
/**
 * ffmpeg refuses local files whose extension it does not expect (`key0.key`) in case a playlist points
 * at something it should not read. Every file of a copy was named by us, so all are allowed.
 */
export const LOCAL_INPUT_OPTIONS = ["-allowed_extensions", "ALL"] as const;
/** How much of the bar the copy fills; the rest is ffmpeg joining the files, which is quick. */
const COPY_SHARE = 0.97;
type StreamSource = Extract<Source, { kind: "hls" }>;
/** What ffmpeg reads: the stream's own address, or a copy of it on disk. */
type Input = { url: string; headers?: Record<string, string> | undefined; local: boolean };

export interface FfmpegDownloaderOptions {
  userAgent: string;
  /** Checks the manifest address. The segments it lists are covered by `httpProxy`, not by this. */
  guard: UrlGuard;
  ffmpegPath?: string;
  spawn?: Spawn;
  /** Looks inside a stream before copying it, to keep only the wanted tracks. Absent: ffmpeg's own pick. */
  inspector?: Pick<StreamInspector, "inspect">;
  /**
   * The guarded proxy (`http://user:pass@127.0.0.1:port`) ffmpeg fetches through: the playlist, every
   * segment and key it lists, and its own redirects are then checked like any other request. It
   * reaches ffmpeg through the `http_proxy` environment variable, so the credentials are not in the
   * arguments `ps` shows.
   */
  httpProxy?: string;
  /** Write text subtitles as files beside the video (`Show S01E01.es.srt`) instead of inside it. */
  externalSubtitles?: boolean;
  /**
   * Copies an HLS stream to disk over several connections before ffmpeg reads it (`<dest>.hls/`):
   * slow players cap each connection, and ffmpeg alone fetches one segment at a time. Absent, or a
   * stream it cannot copy (live, byte ranges): ffmpeg reads the network as before.
   */
  copier?: Pick<HlsCopier, "copy">;
  /** Inspects the copy on disk: no proxy, and only `LOCAL_PROTOCOLS`. Needed with `copier`. */
  localInspector?: Pick<StreamInspector, "inspect">;
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
  // "4XX" is how ffmpeg words a 4xx it has no name for ("Server returned 4XX Client Error, but not
  // one of 40{0,1,3,4}"), such as the proxy's 407.
  const status = /Server returned (\d{3}|4XX)/.exec(stderr)?.[1];
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
  private readonly httpProxy: string | undefined;
  private readonly ffmpegPath: string;
  private readonly spawn: Spawn;
  private readonly inspector: Pick<StreamInspector, "inspect"> | undefined;
  private readonly externalSubtitles: boolean;
  private readonly copier: Pick<HlsCopier, "copy"> | undefined;
  private readonly localInspector: Pick<StreamInspector, "inspect"> | undefined;

  constructor(options: FfmpegDownloaderOptions) {
    this.userAgent = options.userAgent;
    this.guard = options.guard;
    this.httpProxy = options.httpProxy;
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.spawn = options.spawn ?? nodeSpawn;
    this.inspector = options.inspector;
    this.externalSubtitles = options.externalSubtitles ?? false;
    this.copier = options.copier;
    this.localInspector = options.localInspector;
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
    const folder = `${withoutExtension(destPath)}.hls`;
    const input = await this.input(source, folder, context);
    // While a copy fills the bar, ffmpeg's own progress only finishes it.
    const muxing: DownloadContext = input.local
      ? {
          ...context,
          onProgress: ({ bytes, fraction }) =>
            context.onProgress({
              bytes,
              fraction: COPY_SHARE + (1 - COPY_SHARE) * (fraction ?? 0),
            }),
        }
      : context;
    const plan = await this.plan(input, context);
    // The staged name asks for .mkv; a stream that fits an mp4 gets one, and the caller is told.
    const finalPath = `${withoutExtension(destPath)}${plan.extension}`;
    const part = `${finalPath}.part`;
    // ffmpeg can't resume a partial copy, so any leftover part is stale.
    await rm(part, { force: true });
    const sidecars: Sidecar[] = [];
    try {
      await this.copy(source, input, part, plan, muxing);
      await rename(part, finalPath);
      await this.writeSubtitleFiles(input, finalPath, plan, context, sidecars);
    } catch (error) {
      // ffmpeg can't resume, so a half-done episode (video without all its subtitle files) is no use.
      await rm(part, { force: true });
      await rm(finalPath, { force: true });
      await Promise.all(sidecars.map((sidecar) => rm(sidecar.path, { force: true })));
      // The segments on disk are what a retry resumes from; a stop for good leaves nothing to resume.
      if (error instanceof PermanentError) await rm(folder, { recursive: true, force: true });
      throw error;
    }
    await rm(folder, { recursive: true, force: true });
    return {
      bytes: (await stat(finalPath)).size,
      ...(finalPath === destPath ? {} : { path: finalPath }),
      ...(sidecars.length > 0 ? { sidecars } : {}),
    };
  }

  /** The copy on disk when one can be made, else the stream's own address. */
  private async input(
    source: StreamSource,
    folder: string,
    context: DownloadContext,
  ): Promise<Input> {
    const network: Input = { url: source.url, headers: source.headers, local: false };
    if (!this.copier) return network;
    const entry = await this.copier.copy(source, folder, context);
    if (entry === null) {
      await rm(folder, { recursive: true, force: true });
      return network;
    }
    return { url: entry, local: true };
  }

  private async plan(input: Input, context: DownloadContext): Promise<Plan> {
    const inspector = input.local ? this.localInspector : this.inspector;
    if (!inspector) return DEFAULT_PLAN;
    const prefs = context.prefs ?? {};
    const wanted: SelectionPrefs = {
      ...(prefs.maxHeight !== undefined ? { maxHeight: prefs.maxHeight } : {}),
      ...(prefs.audioLangs !== undefined ? { audioLangs: prefs.audioLangs } : {}),
      ...(prefs.subtitleLangs !== undefined ? { subtitleLangs: prefs.subtitleLangs } : {}),
    };
    try {
      const probe = await inspector.inspect(input.url, {
        signal: context.signal,
        ...(input.headers ? { headers: input.headers } : {}),
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
    input: Input,
    part: string,
    plan: Plan,
    context: DownloadContext,
  ): Promise<void> {
    const args = [
      ...this.inputArgs(input),
      ...plan.maps,
      "-c",
      "copy",
      ...plan.subtitleArgs,
      "-f",
      plan.format,
      "-y",
      part,
    ];
    return this.exec(args, input, context, (block) => {
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
    input: Input,
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
            ...this.inputArgs(input),
            "-map",
            `0:${stream.index}`,
            "-c:s",
            "srt",
            "-f",
            "srt",
            "-y",
            path,
          ],
          input,
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

  private inputArgs(input: Input): string[] {
    if (input.local) {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-protocol_whitelist",
        LOCAL_PROTOCOLS,
        ...LOCAL_INPUT_OPTIONS,
        "-i",
        input.url,
      ];
    }
    const headers = Object.entries(input.headers ?? {})
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
      // Reaching the proxy is a protocol of its own in ffmpeg.
      this.httpProxy === undefined ? INPUT_PROTOCOLS : `${INPUT_PROTOCOLS},httpproxy`,
      "-user_agent",
      this.userAgent,
      ...(headers ? ["-headers", headers] : []),
      "-i",
      input.url,
    ];
  }

  private exec(
    args: string[],
    input: Input,
    context: DownloadContext,
    onProgress?: (block: Record<string, string>) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = this.spawn(this.ffmpegPath, args, {
        signal: context.signal,
        // A copy on disk needs no proxy: nothing it may read is on the network.
        ...(this.httpProxy === undefined || input.local
          ? {}
          : // Nothing is exempt from the proxy, whatever the machine's own settings say.
            { env: { ...process.env, http_proxy: this.httpProxy, no_proxy: "", NO_PROXY: "" } }),
      });
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

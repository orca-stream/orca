import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadContext, UrlGuard } from "../../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../../domain/errors.ts";
import type { Source } from "../../domain/series.ts";
import { DEFAULT_BACKOFF_MS, parseRetryAfter } from "../retry-after.ts";
import { guardedFetch, passThrough } from "./guarded-fetch.ts";
import { SpeedMeter } from "./speed-meter.ts";

type StreamSource = Extract<Source, { kind: "hls" }>;

export interface HlsCopierOptions {
  userAgent: string;
  /** Checked on every playlist, segment, key and redirect hop. */
  guard: UrlGuard;
  /**
   * How many files are fetched side by side, by the host of the first segment. Players cap each
   * connection's speed (16–80 KB/s each, measured), so one connection takes hours for an episode.
   */
  connectionsFor?: (host: string) => number;
  /** The wait before a file's second try; doubled, tripled… after. Replaced in tests. */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

/** Tries per file before the whole copy gives up; a slow host drops a connection now and then. */
const FILE_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2_000;
/** A playlist is text: more than this is not one. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
/** What the copy was made from, so that a later attempt only resumes the same stream. */
const FINGERPRINT = "stream.json";
/** The playlist ffmpeg reads, inside the copy's folder. */
const ENTRY = "master.m3u8";
/** Extensions a segment keeps; anything else (`.jpg` disguises, none at all) becomes the default. */
const SEGMENT_EXTENSIONS = new Set([".ts", ".m4s", ".mp4", ".m4a", ".m4v", ".aac", ".ac3", ".ec3"]);

/** Below 1 until every file is in: an estimate must not say "done" while files are missing. */
const MAX_ESTIMATED_FRACTION = 0.99;

/** One file of the copy: where it comes from, and its name inside its playlist's folder. */
interface RemoteFile {
  url: string;
  path: string;
}

/** A media playlist rewritten to read local files, and the files it needs. */
interface LocalPlaylist {
  path: string;
  text: string;
  files: RemoteFile[];
  /** A subtitle rendition: its WebVTT segments are aligned to the video once fetched. */
  subtitles?: boolean;
}

/** MPEG-TS timestamps tick at 90 kHz. */
const MPEGTS_CLOCK = 90_000;
const WEBVTT_TIMESTAMP = /(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/;
const CUE_TIMING = /^(\S+)([ \t]+-->[ \t]+)(\S+)(.*)$/;
const INLINE_TIMESTAMP = /<((?:\d+:)?\d{2}:\d{2}\.\d{3})>/g;

function webVttSeconds(stamp: string): number | undefined {
  const match = WEBVTT_TIMESTAMP.exec(stamp);
  if (!match || match[0] !== stamp) return undefined;
  const [, hours, minutes, seconds, millis] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

function webVttStamp(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor(millis / 60_000) % 60;
  const secs = Math.floor(millis / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis % 1000, 3)}`;
}

/**
 * A WebVTT segment of an HLS stream with its cues moved onto the video's clock. Its
 * `X-TIMESTAMP-MAP=MPEGTS:<pts>,LOCAL:<time>` says which video timestamp the cue time LOCAL is; a
 * player applies it, ffmpeg (8.0) does not: it reads the cues as if 0 were the video's first frame
 * and writes subtitles that come early by the stream's start (1.5 s on a real one). With the cues
 * shifted and the header gone, ffmpeg moves them to the file's start exactly as it moves the video.
 * Text without the header (or already aligned) comes back as it was.
 */
export function alignWebVtt(text: string): string {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => line.trim() === "");
  const end = header === -1 ? lines.length : header;
  const index = lines.slice(0, end).findIndex((line) => line.startsWith("X-TIMESTAMP-MAP="));
  if (index === -1) return text;
  const attributes = new Map<string, string>();
  for (const pair of (lines[index] as string).slice("X-TIMESTAMP-MAP=".length).split(",")) {
    const at = pair.indexOf(":");
    if (at > 0) attributes.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
  const pts = Number(attributes.get("MPEGTS"));
  const local = webVttSeconds(attributes.get("LOCAL") ?? "");
  if (!Number.isFinite(pts) || local === undefined) return text;
  const shift = pts / MPEGTS_CLOCK - local;
  const move = (stamp: string) => {
    const seconds = webVttSeconds(stamp);
    return seconds === undefined ? stamp : webVttStamp(seconds + shift);
  };
  const out = lines.flatMap((line, i) => {
    if (i === index) return [];
    const timing = CUE_TIMING.exec(line);
    if (timing && webVttSeconds(timing[1] as string) !== undefined) {
      return [`${move(timing[1] as string)}${timing[2]}${move(timing[3] as string)}${timing[4]}`];
    }
    return [line.replace(INLINE_TIMESTAMP, (_, stamp: string) => `<${move(stamp)}>`)];
  });
  return out.join("\n");
}

/** `KEY=value,KEY="quoted, value"`, as a map. */
export function parseAttributes(list: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of list.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    const value = match[2] as string;
    attributes.set(match[1] as string, value.startsWith('"') ? value.slice(1, -1) : value);
  }
  return attributes;
}

const withUri = (line: string, uri: string) => line.replace(/URI="[^"]*"/, `URI="${uri}"`);
const tagValue = (line: string) => line.slice(line.indexOf(":") + 1);

function extensionOf(url: string, fallback: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase();
  return SEGMENT_EXTENSIONS.has(ext) ? ext : fallback;
}

export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(text);
}

interface Variant {
  line: string;
  url: string;
  height: number | undefined;
  bandwidth: number;
  audio: string | undefined;
  subtitles: string | undefined;
}

/** The variants a master lists, each with the address on the line after it. */
function variantsOf(lines: string[], base: string): Variant[] {
  const variants: Variant[] = [];
  lines.forEach((line, i) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) return;
    const uri = lines.slice(i + 1).find((next) => next !== "" && !next.startsWith("#"));
    if (!uri) return;
    const attributes = parseAttributes(tagValue(line));
    const height = Number(/x(\d+)$/.exec(attributes.get("RESOLUTION") ?? "")?.[1]);
    variants.push({
      line,
      url: new URL(uri, base).href,
      height: Number.isFinite(height) ? height : undefined,
      bandwidth: Number(attributes.get("BANDWIDTH")) || 0,
      audio: attributes.get("AUDIO"),
      subtitles: attributes.get("SUBTITLES"),
    });
  });
  return variants;
}

/**
 * The variant to copy: the tallest that fits `maxHeight` (the shortest when none does), the widest
 * bandwidth among equals. Only one is copied, so that the others' segments are not fetched for nothing;
 * ffprobe on the copy then finds the tracks to keep the way it does for any stream.
 */
export function pickVariant(
  variants: Variant[],
  maxHeight: number | undefined,
): Variant | undefined {
  const height = (variant: Variant) => variant.height ?? 0;
  const fits = variants.filter((v) => maxHeight === undefined || height(v) <= maxHeight);
  if (fits.length === 0) {
    return [...variants].sort((a, b) => height(a) - height(b) || b.bandwidth - a.bandwidth)[0];
  }
  return [...fits].sort((a, b) => height(b) - height(a) || b.bandwidth - a.bandwidth)[0];
}

/**
 * A media playlist rewritten to name local files (`00001.ts`, `key0.key`, `init0.mp4`), or null when
 * it is something a copy cannot hold: a live playlist (no end), byte ranges, or a key method ffmpeg
 * reads only from the network. Tags that point elsewhere (low-latency parts, preload hints) are dropped.
 */
export function localMediaPlaylist(
  text: string,
  base: string,
  folder: string,
  segmentExtension: string,
): LocalPlaylist | null {
  const lines: string[] = [];
  const files: RemoteFile[] = [];
  let segments = 0;
  let keys = 0;
  let maps = 0;
  let ended = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith("#")) {
      const url = new URL(line, base).href;
      const name = `${String(segments++).padStart(5, "0")}${extensionOf(url, segmentExtension)}`;
      files.push({ url, path: join(folder, name) });
      lines.push(name);
      continue;
    }
    if (line === "#EXT-X-ENDLIST") ended = true;
    if (line.startsWith("#EXT-X-BYTERANGE")) return null;
    if (line.startsWith("#EXT-X-KEY:")) {
      const attributes = parseAttributes(tagValue(line));
      const method = attributes.get("METHOD");
      const uri = attributes.get("URI");
      if (method === "NONE") lines.push(line);
      else if (method === "AES-128" && uri) {
        const name = `key${keys++}.key`;
        files.push({ url: new URL(uri, base).href, path: join(folder, name) });
        lines.push(withUri(line, name));
      } else return null;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseAttributes(tagValue(line));
      const uri = attributes.get("URI");
      if (!uri || attributes.has("BYTERANGE")) return null;
      const url = new URL(uri, base).href;
      const name = `init${maps++}${extensionOf(url, ".mp4")}`;
      files.push({ url, path: join(folder, name) });
      lines.push(withUri(line, name));
      continue;
    }
    if (/URI="/.test(line)) continue;
    lines.push(line);
  }
  if (!ended) return null;
  return { path: join(folder, "index.m3u8"), text: `${lines.join("\n")}\n`, files };
}

/**
 * Every playlist's files with the i-th of each side by side, so that the tracks fill in together: one
 * after another, the small audio segments would all come first and the copy would look nearly done
 * long before the video, where nearly all the bytes are, had started.
 */
export function interleave(lists: RemoteFile[][]): { file: RemoteFile; list: number }[] {
  const queue: { file: RemoteFile; list: number }[] = [];
  const longest = Math.max(0, ...lists.map((files) => files.length));
  for (let i = 0; i < longest; i++) {
    lists.forEach((files, list) => {
      const file = files[i];
      if (file) queue.push({ file, list });
    });
  }
  return queue;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Copies an HLS stream into a folder: the variant that fits, its audio and subtitle renditions, every
 * segment, key and init section, fetched over several connections at once, with playlists rewritten
 * to read them. ffmpeg then copies the tracks out of the folder without touching the network. What a
 * failed attempt fetched stays and the next one resumes it, as long as it is the same stream.
 */
export class HlsCopier {
  private readonly userAgent: string;
  private readonly guard: UrlGuard;
  private readonly connectionsFor: (host: string) => number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HlsCopierOptions) {
    this.userAgent = options.userAgent;
    this.guard = options.guard;
    this.connectionsFor = options.connectionsFor ?? (() => 1);
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * The local playlist to hand ffmpeg, once every file is in `folder`; null when the stream cannot be
   * copied (see `localMediaPlaylist`) and ffmpeg has to read it from the network as before.
   */
  async copy(
    source: StreamSource,
    folder: string,
    context: DownloadContext,
  ): Promise<string | null> {
    const headers = { "user-agent": this.userAgent, ...passThrough(source.headers) };
    const { signal } = context;
    const top = await this.playlist(source.url, headers, signal);
    const playlists: LocalPlaylist[] = [];
    let entry: string;

    if (isMasterPlaylist(top.text)) {
      const lines = top.text.split(/\r?\n/).map((line) => line.trim());
      const variant = pickVariant(variantsOf(lines, top.url), context.prefs?.maxHeight);
      if (!variant) return null;
      const master = ["#EXTM3U"];
      for (const line of lines) {
        if (line.startsWith("#EXT-X-VERSION") || line === "#EXT-X-INDEPENDENT-SEGMENTS") {
          master.push(line);
        }
      }
      let renditions = 0;
      for (const line of lines) {
        if (!line.startsWith("#EXT-X-MEDIA:")) continue;
        const attributes = parseAttributes(tagValue(line));
        const uri = attributes.get("URI");
        if (!uri) {
          master.push(line);
          continue;
        }
        const type = attributes.get("TYPE");
        const group = attributes.get("GROUP-ID");
        const wanted =
          (type === "AUDIO" && group === variant.audio) ||
          (type === "SUBTITLES" && group === variant.subtitles);
        if (!wanted) continue;
        const name = `r${renditions++}`;
        const fetched = await this.playlist(new URL(uri, top.url).href, headers, signal);
        const local = localMediaPlaylist(
          fetched.text,
          fetched.url,
          join(folder, name),
          type === "SUBTITLES" ? ".vtt" : ".ts",
        );
        if (!local) return null;
        playlists.push(type === "SUBTITLES" ? { ...local, subtitles: true } : local);
        master.push(withUri(line, `${name}/index.m3u8`));
      }
      const fetched = await this.playlist(variant.url, headers, signal);
      const video = localMediaPlaylist(fetched.text, fetched.url, join(folder, "v"), ".ts");
      if (!video) return null;
      playlists.push(video);
      master.push(variant.line, "v/index.m3u8");
      entry = join(folder, ENTRY);
      await this.prepare(folder, playlists);
      await writeFile(entry, `${master.join("\n")}\n`);
    } else {
      const video = localMediaPlaylist(top.text, top.url, join(folder, "v"), ".ts");
      if (!video) return null;
      playlists.push(video);
      entry = video.path;
      await this.prepare(folder, playlists);
    }

    await this.fetchAll(
      playlists.map((playlist) => playlist.files),
      headers,
      context,
    );
    await this.alignSubtitles(playlists);
    return entry;
  }

  /** Every WebVTT segment rewritten onto the video's clock (see `alignWebVtt`); idempotent. */
  private async alignSubtitles(playlists: LocalPlaylist[]): Promise<void> {
    for (const playlist of playlists) {
      if (!playlist.subtitles) continue;
      for (const file of playlist.files) {
        if (extname(file.path) !== ".vtt") continue;
        const text = await readFile(file.path, "utf8");
        const aligned = alignWebVtt(text);
        if (aligned !== text) await writeFile(file.path, aligned);
      }
    }
  }

  /**
   * Empties the folder when what it holds came from another stream (another player, another variant),
   * then writes the playlists. Segment names are positions, so mixing two streams would be garbage.
   */
  private async prepare(folder: string, playlists: LocalPlaylist[]): Promise<void> {
    const fingerprint = JSON.stringify(
      playlists.map((playlist) =>
        playlist.files.map((file) => {
          // The query carries the expiring token; the path is what names the stream.
          const url = new URL(file.url);
          return `${url.host}${url.pathname}`;
        }),
      ),
    );
    const previous = await readFile(join(folder, FINGERPRINT), "utf8").catch(() => null);
    if (previous !== fingerprint) await rm(folder, { recursive: true, force: true });
    for (const playlist of playlists) {
      await mkdir(dirname(playlist.path), { recursive: true });
      await writeFile(playlist.path, playlist.text);
    }
    await writeFile(join(folder, FINGERPRINT), fingerprint);
  }

  /**
   * The files still missing, several at a time; one that gives up stops the others. Progress is in
   * bytes against an estimate of the whole: each playlist's average file so far times its file count.
   * Counting files instead would weigh a 100 KB audio segment like a 6 MB video one.
   */
  private async fetchAll(
    lists: RemoteFile[][],
    headers: Record<string, string>,
    context: DownloadContext,
  ): Promise<void> {
    const { signal } = context;
    const queue = interleave(lists);
    const have = await Promise.all(
      queue.map(async ({ file }) => (await stat(file.path).catch(() => null))?.size),
    );
    const tallies = lists.map((files) => ({ count: files.length, done: 0, doneBytes: 0 }));
    queue.forEach(({ list }, i) => {
      const size = have[i];
      if (size === undefined) return;
      const tally = tallies[list] as (typeof tallies)[number];
      tally.done++;
      tally.doneBytes += size;
    });
    const missing = queue.filter((_, i) => have[i] === undefined);
    let bytes = have.reduce<number>((sum, size) => sum + (size ?? 0), 0);
    const resumedBytes = bytes;
    let done = queue.length - missing.length;
    let shown = 0;
    const meter = new SpeedMeter();
    /** The copy's size, once every playlist has a file in to measure it by. */
    const estimate = (): number | undefined => {
      let total = 0;
      for (const tally of tallies) {
        if (tally.count === 0) continue;
        if (tally.done === 0) return undefined;
        total += (tally.doneBytes / tally.done) * tally.count;
      }
      return total;
    };
    const report = () => {
      const estimated = estimate();
      const measured =
        done === queue.length
          ? 1
          : estimated
            ? Math.min(MAX_ESTIMATED_FRACTION, bytes / estimated)
            : done / queue.length;
      // The estimate moves as files come in; the bar never goes back.
      shown = Math.max(shown, measured);
      const speed = meter.update(bytes - resumedBytes);
      context.onProgress({
        bytes,
        fraction: shown,
        ...(speed !== undefined ? { speed } : {}),
        ...(speed && estimated ? { eta: Math.max(0, estimated - bytes) / speed } : {}),
      });
    };
    report();
    if (missing.length === 0) return;

    const first = (missing[0] as (typeof missing)[number]).file;
    const connections = Math.max(1, Math.floor(this.connectionsFor(new URL(first.url).host)));
    const stop = new AbortController();
    const fileSignal = AbortSignal.any([signal, stop.signal]);
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const { file, list } = missing[next++] as (typeof missing)[number];
        const size = await this.fetchFile(file, headers, fileSignal, (delta) => {
          bytes += delta;
          report();
        });
        const tally = tallies[list] as (typeof tallies)[number];
        tally.done++;
        tally.doneBytes += size;
        done++;
        report();
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(connections, missing.length) }, async () => {
          try {
            await worker();
          } catch (error) {
            stop.abort();
            throw error;
          }
        }),
      );
    } catch (error) {
      if (signal.aborted) throw new AbortedError({ cause: error });
      throw error;
    }
  }

  /** One file through `<file>.part`, renamed when whole; retried a few times. Its size. */
  private async fetchFile(
    file: RemoteFile,
    headers: Record<string, string>,
    signal: AbortSignal,
    onBytes: (delta: number) => void,
  ): Promise<number> {
    const part = `${file.path}.part`;
    for (let attempt = 1; ; attempt++) {
      let received = 0;
      try {
        const response = await this.open(file.url, headers, signal);
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            onBytes(chunk.length);
            callback(null, chunk);
          },
        });
        try {
          await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(part), {
            signal,
          });
        } catch (error) {
          if (signal.aborted) throw new AbortedError({ cause: error });
          throw new RetryableError(`Download interrupted: ${(error as Error).message}`, {
            cause: error,
          });
        }
        await rename(part, file.path);
        return received;
      } catch (error) {
        // What the failed try counted is fetched again.
        onBytes(-received);
        await rm(part, { force: true });
        const again =
          error instanceof RetryableError &&
          error.retryAfterMs === undefined &&
          attempt < FILE_ATTEMPTS;
        if (!again) throw error;
        await sleep(this.retryDelayMs * attempt, signal);
      }
    }
  }

  /** A playlist's text and the address it ended at, retried like any file. */
  private async playlist(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ text: string; url: string }> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { response, url: final } = await this.request(url, headers, signal);
        await this.assertReadable(url, response);
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > MAX_PLAYLIST_BYTES) {
          await response.body?.cancel();
          throw new PermanentError(`The playlist at ${new URL(url).host} is too large`);
        }
        const text = await response.text().catch((error: unknown) => {
          if (signal.aborted) throw new AbortedError({ cause: error });
          throw new RetryableError("Playlist interrupted", { cause: error });
        });
        if (!text.trimStart().startsWith("#EXTM3U")) {
          throw new PermanentError(`${new URL(url).host} did not answer with an HLS playlist`);
        }
        return { text, url: final };
      } catch (error) {
        const again =
          error instanceof RetryableError &&
          error.retryAfterMs === undefined &&
          attempt < FILE_ATTEMPTS;
        if (!again) throw error;
        await sleep(this.retryDelayMs * attempt, signal);
      }
    }
  }

  private async open(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Response> {
    const { response } = await this.request(url, headers, signal);
    await this.assertReadable(url, response);
    return response;
  }

  /** Opens the address, turning a network failure into a retry the way every request here does. */
  private async request(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ response: Response; url: string }> {
    try {
      return await guardedFetch(
        url,
        { headers, signal },
        { guard: this.guard, fetch: this.fetchImpl },
      );
    } catch (error) {
      if (signal.aborted) throw new AbortedError({ cause: error });
      if (error instanceof PermanentError || error instanceof RetryableError) throw error;
      throw new RetryableError(`Could not reach ${new URL(url).host}`, { cause: error });
    }
  }

  /** Throws what a response that carries no file means: wait (429/503), retry (5xx) or stop. */
  private async assertReadable(url: string, response: Response): Promise<void> {
    const host = new URL(url).host;
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      const wait = parseRetryAfter(response.headers.get("retry-after"));
      throw new RetryableError(`HTTP ${response.status} from ${host}`, {
        retryAfterMs: wait ?? DEFAULT_BACKOFF_MS,
      });
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new RetryableError(`HTTP ${response.status} from ${host}`);
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PermanentError(`HTTP ${response.status} from ${host}`);
    }
    if (!response.body) throw new RetryableError(`Empty response from ${host}`);
  }
}

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  DownloadContext,
  DownloadResult,
  Downloader,
  UrlGuard,
} from "../../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../../domain/errors.ts";
import type { Source } from "../../domain/series.ts";
import type { HostLimiter } from "../host-limiter.ts";
import { DEFAULT_BACKOFF_MS, parseRetryAfter } from "../retry-after.ts";
import { guardedFetch, passThrough } from "./guarded-fetch.ts";
import { SpeedMeter } from "./speed-meter.ts";

type DirectSource = Extract<Source, { kind: "direct" }>;

export interface HttpDownloaderOptions {
  userAgent: string;
  /** Caps and spaces the downloads per remote host (be polite to the sites). */
  limiter: HostLimiter;
  /** Checked on the address and on every redirect hop. */
  guard: UrlGuard;
  /**
   * How many connections one file is fetched over, by host. Players cap each connection's speed
   * (player-c: ~160 KB/s each, ~5× with 4), so the file is split in ranges fetched side by side.
   * 1, or a server that ignores `Range`: a single stream, as before.
   */
  connectionsFor?: (host: string) => number;
  /** Below this size a file is fetched whole. Replaced in tests. */
  minSplitBytes?: number;
  /** The wait before a range's second try; doubled, tripled… after. Replaced in tests. */
  rangeRetryDelayMs?: number;
  fetch?: typeof fetch;
}

/** Below this size one connection is quick enough: splitting would only cost handshakes. */
const MIN_SPLIT_BYTES = 8 * 1024 * 1024;
/** Tries per range before the whole download gives up; a slow host drops a connection now and then. */
const RANGE_ATTEMPTS = 4;
const RANGE_RETRY_DELAY_MS = 2_000;

/** What `Content-Range: bytes 0-0/12345` says the whole file measures. */
function totalOf(response: Response): number | undefined {
  const match = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "");
  return match ? Number(match[1]) : undefined;
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

async function sizeOf(path: string): Promise<number> {
  return (await stat(path).catch(() => null))?.size ?? 0;
}

async function md5Of(path: string): Promise<string> {
  const hash = createHash("md5");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * The direct downloader: plain HTTP with `Range` resume. It streams into `<dest>.part`, checks the
 * size and md5 the extractor gave, and only then renames it onto `dest`, so `dest` never exists half
 * written. A checksum mismatch downloads once more from scratch before giving up for good.
 */
export class HttpDownloader implements Downloader {
  private readonly userAgent: string;
  private readonly limiter: HostLimiter;
  private readonly guard: UrlGuard;
  private readonly connectionsFor: (host: string) => number;
  private readonly minSplitBytes: number;
  private readonly rangeRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpDownloaderOptions) {
    this.userAgent = options.userAgent;
    this.limiter = options.limiter;
    this.guard = options.guard;
    this.connectionsFor = options.connectionsFor ?? (() => 1);
    this.minSplitBytes = options.minSplitBytes ?? MIN_SPLIT_BYTES;
    this.rangeRetryDelayMs = options.rangeRetryDelayMs ?? RANGE_RETRY_DELAY_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  canHandle(source: Source): boolean {
    return source.kind === "direct";
  }

  async download(
    source: Source,
    destPath: string,
    context: DownloadContext,
  ): Promise<DownloadResult> {
    if (source.kind !== "direct") throw new PermanentError(`Not a direct source: ${source.kind}`);
    await mkdir(dirname(destPath), { recursive: true });

    return this.limiter.run(new URL(source.url).host, "download", context.signal, async () => {
      const part = `${destPath}.part`;
      for (let attempt = 1; ; attempt++) {
        const split = await this.fetchInRanges(source, part, context);
        if (!split) await this.fetchInto(source, part, context);
        const problem = await this.verify(source, part);
        if (!problem) break;
        await rm(part, { force: true });
        if (attempt >= 2) throw new PermanentError(`${problem} (twice in a row)`);
      }
      await rename(part, destPath);
      return { bytes: await sizeOf(destPath) };
    });
  }

  private async verify(source: DirectSource, part: string): Promise<string | null> {
    const size = await sizeOf(part);
    if (source.sizeBytes !== undefined && size !== source.sizeBytes) {
      return `Size mismatch: expected ${source.sizeBytes} bytes, got ${size}`;
    }
    if (source.md5 && (await md5Of(part)) !== source.md5.toLowerCase()) return "Checksum mismatch";
    return null;
  }

  /** The response, following redirects by hand so that no hop goes unchecked. */
  private async open(
    source: DirectSource,
    range: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers = {
      "user-agent": this.userAgent,
      ...passThrough(source.headers),
      ...(range ? { range: `bytes=${range}` } : {}),
    };
    const { response } = await guardedFetch(
      source.url,
      { headers, signal },
      { guard: this.guard, fetch: this.fetchImpl },
    );
    return response;
  }

  /** Throws what a response that carries no file means: wait (429/503), retry (5xx) or stop. */
  private async assertReadable(source: DirectSource, response: Response): Promise<void> {
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      const wait = parseRetryAfter(response.headers.get("retry-after"));
      this.limiter.penalize(new URL(source.url).host, wait ?? DEFAULT_BACKOFF_MS);
      throw new RetryableError(
        `HTTP ${response.status}`,
        wait === undefined ? {} : { retryAfterMs: wait },
      );
    }
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new RetryableError(`HTTP ${response.status}`);
    }
    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel();
      throw new PermanentError(`HTTP ${response.status} for ${source.url}`);
    }
    if (!response.body) throw new RetryableError("Empty response body");
  }

  /** Opens the address, turning a network failure into a retry the way every request here does. */
  private async request(
    source: DirectSource,
    range: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.open(source, range, signal);
    } catch (error) {
      if (signal.aborted) throw new AbortedError({ cause: error });
      if (error instanceof PermanentError || error instanceof RetryableError) throw error;
      throw new RetryableError(`Could not reach ${new URL(source.url).host}`, { cause: error });
    }
  }

  /**
   * The file over several connections at once, each range into a file of its own (`<part>.<i>-of-<n>`)
   * that a later attempt resumes, then joined into `part`. False when this file is not worth or not
   * able to be split (one connection asked for, a small file, a server without `Range`): the caller
   * then streams it whole.
   */
  private async fetchInRanges(
    source: DirectSource,
    part: string,
    context: DownloadContext,
  ): Promise<boolean> {
    const { signal } = context;
    const connections = Math.max(1, Math.floor(this.connectionsFor(new URL(source.url).host)));
    if (connections < 2) return false;
    if (source.sizeBytes !== undefined && source.sizeBytes < this.minSplitBytes) return false;

    const probe = await this.request(source, "0-0", signal);
    await probe.body?.cancel();
    const total = probe.status === 206 ? totalOf(probe) : undefined;
    if (probe.status !== 206) await this.assertReadable(source, probe);
    if (total === undefined || total < this.minSplitBytes) return false;
    if (source.sizeBytes !== undefined && total !== source.sizeBytes) {
      throw new PermanentError(`Size mismatch: expected ${source.sizeBytes} bytes, got ${total}`);
    }

    const size = Math.ceil(total / connections);
    const ranges = Array.from({ length: connections }, (_, i) => ({
      path: `${part}.${i}-of-${connections}`,
      start: i * size,
      end: Math.min(total, (i + 1) * size) - 1,
    }));
    // A single-stream part from an earlier attempt is not resumable here.
    await rm(part, { force: true });
    await this.removeStaleRanges(part, new Set(ranges.map((range) => range.path)));

    const have = await Promise.all(
      ranges.map(async (range) => {
        const length = range.end - range.start + 1;
        const size = await sizeOf(range.path);
        if (size <= length) return size;
        await rm(range.path, { force: true });
        return 0;
      }),
    );
    const resumedBytes = have.reduce((sum, bytes) => sum + bytes, 0);
    const meter = new SpeedMeter();
    const report = () => {
      const bytes = have.reduce((sum, value) => sum + value, 0);
      const speed = meter.update(bytes - resumedBytes);
      context.onProgress({
        bytes,
        total,
        ...(speed !== undefined ? { speed } : {}),
        ...(speed ? { eta: (total - bytes) / speed } : {}),
      });
    };
    report();

    // One range that gives up stops the others: the attempt has failed either way.
    const stop = new AbortController();
    const rangeSignal = AbortSignal.any([signal, stop.signal]);
    try {
      await Promise.all(
        ranges.map(async (range, i) => {
          try {
            await this.fetchRange(source, range, rangeSignal, (bytes) => {
              have[i] = bytes;
              report();
            });
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

    await pipeline(
      async function* () {
        for (const range of ranges) yield* createReadStream(range.path);
      },
      createWriteStream(part),
      { signal },
    );
    await Promise.all(ranges.map((range) => rm(range.path, { force: true })));
    return true;
  }

  /** One range into its file, resumed from what the file already holds, retried a few times. */
  private async fetchRange(
    source: DirectSource,
    range: { path: string; start: number; end: number },
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ): Promise<void> {
    const length = range.end - range.start + 1;
    for (let attempt = 1; ; attempt++) {
      let have = await sizeOf(range.path);
      if (have >= length) return onBytes(have);
      try {
        const response = await this.request(source, `${range.start + have}-${range.end}`, signal);
        await this.assertReadable(source, response);
        if (response.status !== 206) {
          // It answered a range request with the whole file: splitting cannot work with it.
          await response.body?.cancel();
          throw new PermanentError(`${new URL(source.url).host} ignored a byte range`);
        }
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            have += chunk.length;
            onBytes(have);
            callback(null, chunk);
          },
        });
        try {
          await pipeline(
            Readable.fromWeb(response.body as never),
            meter,
            createWriteStream(range.path, { flags: "a" }),
            { signal },
          );
        } catch (error) {
          if (signal.aborted) throw new AbortedError({ cause: error });
          throw new RetryableError(`Download interrupted: ${(error as Error).message}`, {
            cause: error,
          });
        }
        if ((await sizeOf(range.path)) > length) {
          await rm(range.path, { force: true });
          throw new RetryableError("A range came back longer than asked");
        }
      } catch (error) {
        const again =
          error instanceof RetryableError &&
          error.retryAfterMs === undefined &&
          attempt < RANGE_ATTEMPTS;
        if (!again) throw error;
        await sleep(this.rangeRetryDelayMs * attempt, signal);
      }
    }
  }

  /** Range files left by an attempt that split the file another way. */
  private async removeStaleRanges(part: string, keep: Set<string>): Promise<void> {
    const prefix = `${basename(part)}.`;
    const names = await readdir(dirname(part)).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => name.startsWith(prefix) && /\.\d+-of-\d+$/.test(name))
        .map((name) => join(dirname(part), name))
        .filter((path) => !keep.has(path))
        .map((path) => rm(path, { force: true })),
    );
  }

  private async fetchInto(
    source: DirectSource,
    part: string,
    context: DownloadContext,
  ): Promise<void> {
    const { signal } = context;
    let have = await sizeOf(part);
    if (source.sizeBytes !== undefined && have > source.sizeBytes) {
      await rm(part, { force: true });
      have = 0;
    }
    if (source.sizeBytes !== undefined && have === source.sizeBytes) {
      context.onProgress({ bytes: have, total: source.sizeBytes });
      return;
    }

    const response = await this.request(source, have > 0 ? `${have}-` : undefined, signal);

    if (response.status === 416) {
      // The part is as long as the file, or longer than it: trust the checks that follow.
      await response.body?.cancel();
      return;
    }
    await this.assertReadable(source, response);

    // 200 to a Range request: the server ignored it, so start the file over.
    const resumed = response.status === 206 && have > 0;
    if (!resumed) have = 0;
    const lengthHeader = Number(response.headers.get("content-length"));
    const total =
      source.sizeBytes ??
      (Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader + have : undefined);

    let bytes = have;
    const speedMeter = new SpeedMeter();
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        const speed = speedMeter.update(bytes - have);
        context.onProgress({
          bytes,
          ...(total !== undefined ? { total } : {}),
          ...(speed !== undefined ? { speed } : {}),
          ...(speed && total !== undefined ? { eta: (total - bytes) / speed } : {}),
        });
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        meter,
        createWriteStream(part, { flags: resumed ? "a" : "w" }),
        { signal },
      );
    } catch (error) {
      if (signal.aborted || (error as Error).name === "AbortError")
        throw new AbortedError({ cause: error });
      throw new RetryableError(`Download interrupted: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}

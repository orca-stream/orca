import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadContext, DownloadResult, Downloader } from "../../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../../domain/errors.ts";
import type { Source } from "../../domain/series.ts";
import type { HostLimiter } from "../host-limiter.ts";

type DirectSource = Extract<Source, { kind: "direct" }>;

export interface HttpDownloaderOptions {
  userAgent: string;
  /** Caps and spaces the downloads per remote host (be polite to archive.org). */
  limiter: HostLimiter;
  fetch?: typeof fetch;
}

/** Seconds or an HTTP date, as milliseconds. */
function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
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
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpDownloaderOptions) {
    this.userAgent = options.userAgent;
    this.limiter = options.limiter;
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
        await this.fetchInto(source, part, context);
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

    let response: Response;
    try {
      response = await this.fetchImpl(source.url, {
        signal,
        headers: { "user-agent": this.userAgent, ...(have > 0 ? { range: `bytes=${have}-` } : {}) },
      });
    } catch (error) {
      if (signal.aborted) throw new AbortedError({ cause: error });
      throw new RetryableError(`Could not reach ${new URL(source.url).host}`, { cause: error });
    }

    if (response.status === 416) {
      // The part is as long as the file, or longer than it: trust the checks that follow.
      await response.body?.cancel();
      return;
    }
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel();
      const wait = retryAfter(response.headers.get("retry-after"));
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

    // 200 to a Range request: the server ignored it, so start the file over.
    const resumed = response.status === 206 && have > 0;
    if (!resumed) have = 0;
    const lengthHeader = Number(response.headers.get("content-length"));
    const total =
      source.sizeBytes ??
      (Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader + have : undefined);

    let bytes = have;
    const started = Date.now();
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        const seconds = (Date.now() - started) / 1000;
        const speed = seconds > 0 ? (bytes - have) / seconds : undefined;
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

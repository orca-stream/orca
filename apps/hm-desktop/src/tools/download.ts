import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export interface DownloadOptions {
  url: string;
  to: string;
  /** Hex SHA-256 the file must have: a different one is never kept. */
  sha256: string;
  /** Called with the bytes received so far and the size, when the server says it. */
  onBytes: (received: number, total: number | undefined) => void;
  signal: AbortSignal;
  /** Parts fetched at once when the server serves ranges. */
  connections?: number;
  fetch?: typeof fetch;
}

/**
 * GitHub serves a release file at ~0.7 MB/s per connection (measured 2026-11-07); eight ranges at once
 * fetched 24 MB in under two seconds.
 */
const DEFAULT_CONNECTIONS = 8;
/** Below this, one request is simpler and as fast. */
const MIN_PARALLEL_BYTES = 8 * 1024 * 1024;

export class DownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DownloadError";
  }
}

async function request(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal,
  range?: [number, number],
): Promise<Response> {
  const response = await doFetch(url, {
    signal,
    redirect: "follow",
    ...(range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {}),
  }).catch((error: unknown) => {
    if (signal.aborted) throw error;
    // fetch says only "fetch failed"; the reason (ECONNREFUSED, ENOTFOUND…) is in its cause.
    const cause =
      error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    const reason = cause?.code ?? (error instanceof Error ? error.message : String(error));
    throw new DownloadError(`${new URL(url).host}: ${reason}`, { cause: error });
  });
  if (!response.ok || !response.body) {
    throw new DownloadError(`${new URL(url).host} answered ${response.status}`);
  }
  return response;
}

/** Writes a response's body into the file from `position` on, counting what arrives. */
async function writeBody(
  response: Response,
  file: FileHandle,
  position: number,
  onChunk: (bytes: number) => void,
): Promise<void> {
  let at = position;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    await file.write(chunk, 0, chunk.length, at);
    at += chunk.length;
    onChunk(chunk.length);
  }
}

/** The size in `Content-Range: bytes 0-0/65812888`, when the server answered with a range. */
function rangeTotal(response: Response): number | undefined {
  if (response.status !== 206) return undefined;
  const total = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Fetches a file to `to`, in parallel ranges when the server serves them, through a `.part` file
 * renamed only once its checksum matches, so a cut or tampered download never looks finished.
 */
export async function downloadFile(options: DownloadOptions): Promise<void> {
  const { url, to, sha256, onBytes, signal } = options;
  const doFetch = options.fetch ?? fetch;
  const part = `${to}.part`;
  // One byte first: the size, whether ranges work, and the address after redirects (a signed one,
  // which every part then asks directly).
  const probe = await request(doFetch, url, signal, [0, 0]);
  const total = rangeTotal(probe);
  const file = await open(part, "w");
  let received = 0;
  const count = (bytes: number) => {
    received += bytes;
    onBytes(received, total);
  };
  try {
    if (total !== undefined && total >= MIN_PARALLEL_BYTES) {
      await probe.body?.cancel();
      const connections = options.connections ?? DEFAULT_CONNECTIONS;
      const size = Math.ceil(total / connections);
      const source = probe.url || url;
      await Promise.all(
        Array.from({ length: connections }, async (_, i) => {
          const start = i * size;
          const end = Math.min(total, start + size) - 1;
          if (start > end) return;
          const response = await request(doFetch, source, signal, [start, end]);
          if (response.status !== 206) {
            throw new DownloadError(`${new URL(url).host} ignored a range request`);
          }
          await writeBody(response, file, start, count);
        }),
      );
    } else if (total !== undefined) {
      // Small: the one byte is already here; fetch the rest in one go.
      await writeBody(probe, file, 0, count);
      if (total > 1)
        await writeBody(await request(doFetch, url, signal, [1, total - 1]), file, 1, count);
    } else {
      // No ranges: the probe's answer is the whole file.
      const length = Number(probe.headers.get("content-length"));
      const whole = Number.isFinite(length) && length > 0 ? length : undefined;
      for await (const chunk of probe.body as unknown as AsyncIterable<Uint8Array>) {
        await file.write(chunk, 0, chunk.length, received);
        received += chunk.length;
        onBytes(received, whole);
      }
    }
    await file.close();
    signal.throwIfAborted();
    const actual = await fileSha256(part);
    if (actual !== sha256.toLowerCase()) {
      throw new DownloadError(`${url} does not match its checksum (got ${actual})`);
    }
    await rename(part, to);
  } catch (error) {
    await file.close().catch(() => {});
    await rm(part, { force: true });
    throw error;
  }
}

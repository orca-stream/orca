import type { FetchedImage, ImageFetcher } from "../application/ports.ts";

export interface FetchImageFetcherOptions {
  userAgent: string;
  maxBytes?: number;
  fetch?: typeof fetch;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** Largest cover we accept: more than any poster needs, little enough to hold in memory. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class FetchImageFetcher implements ImageFetcher {
  private readonly userAgent: string;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchImageFetcherOptions) {
    this.userAgent = options.userAgent;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetch(url: string, options?: { signal?: AbortSignal }): Promise<FetchedImage> {
    const response = await this.fetchImpl(url, {
      headers: { "user-agent": this.userAgent },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`Image request answered ${response.status}`);

    const type =
      (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = EXTENSIONS[type];
    if (!extension) {
      await response.body?.cancel();
      throw new Error(`Not an image: ${type || "no content type"}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await response.body?.cancel();
      throw new Error(`Image too large: ${declared} bytes`);
    }
    if (!response.body) throw new Error("Image response has no body");

    // Count while reading, so a body that lies about its length is cut off at the cap.
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > this.maxBytes) {
        await reader.cancel();
        throw new Error(`Image too large: more than ${this.maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, extension };
  }
}

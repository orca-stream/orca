import type { ImageFetcher } from "../application/ports.ts";

export interface FetchImageFetcherOptions {
  userAgent: string;
  maxBytes?: number;
  fetch?: typeof fetch;
}

export class FetchImageFetcher implements ImageFetcher {
  private readonly userAgent: string;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchImageFetcherOptions) {
    this.userAgent = options.userAgent;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetch(url: string, options?: { signal?: AbortSignal }): Promise<Uint8Array> {
    const response = await this.fetchImpl(url, {
      headers: { "user-agent": this.userAgent },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`Image request answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > this.maxBytes) throw new Error(`Image too large: ${bytes.length} bytes`);
    return bytes;
  }
}

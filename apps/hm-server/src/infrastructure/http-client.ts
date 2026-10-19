import { ExtractorError, type HttpClient } from "@orca/extractor-core";

export interface FetchHttpClientOptions {
  userAgent: string;
  /** At least this long between two requests (archive.org asks for politeness). Default 1000. */
  minIntervalMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The extractors' HttpClient: JSON over fetch, one request per `minIntervalMs`, errors typed. */
export class FetchHttpClient implements HttpClient {
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextAllowedAt = 0;

  constructor(options: FetchHttpClientOptions) {
    this.userAgent = options.userAgent;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getJson(url: string, options?: { signal?: AbortSignal }): Promise<unknown> {
    // Reserve the slot before waiting, so concurrent callers queue up instead of bursting.
    const slot = Math.max(this.now(), this.nextAllowedAt);
    this.nextAllowedAt = slot + this.minIntervalMs;
    const wait = slot - this.now();
    if (wait > 0) await this.sleep(wait);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent, accept: "application/json" },
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw new ExtractorError("network", `Could not reach ${new URL(url).host}`, { cause: error });
    }
    if (response.status === 404) throw new ExtractorError("not-found", `Not found: ${url}`);
    if (!response.ok) {
      throw new ExtractorError(
        "network",
        `${new URL(url).host} answered ${response.status}: try again later`,
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new ExtractorError(
        "invalid-response",
        `${new URL(url).host} did not answer with JSON`,
        { cause: error },
      );
    }
  }
}

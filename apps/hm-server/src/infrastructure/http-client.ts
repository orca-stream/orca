import { ExtractorError, type HttpClient } from "@orca/extractor-core";
import type { HostLimiter } from "./host-limiter.ts";
import { DEFAULT_BACKOFF_MS, parseRetryAfter } from "./retry-after.ts";

export interface FetchHttpClientOptions {
  userAgent: string;
  /** Spaces and caps the requests per host (archive.org asks for politeness). */
  limiter: HostLimiter;
  fetch?: typeof fetch;
}

/** The extractors' HttpClient: JSON or pages over fetch through the host limiter's metadata lane, errors typed. */
export class FetchHttpClient implements HttpClient {
  private readonly userAgent: string;
  private readonly limiter: HostLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchHttpClientOptions) {
    this.userAgent = options.userAgent;
    this.limiter = options.limiter;
    this.fetchImpl = options.fetch ?? fetch;
  }

  getJson(url: string, options?: { signal?: AbortSignal }): Promise<unknown> {
    return this.limiter.run(new URL(url).host, "metadata", options?.signal, async () => {
      const response = await this.request(url, options?.signal, { accept: "application/json" });
      try {
        return await response.json();
      } catch (error) {
        throw new ExtractorError(
          "invalid-response",
          `${new URL(url).host} did not answer with JSON`,
          { cause: error },
        );
      }
    });
  }

  getText(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<string> {
    return this.limiter.run(new URL(url).host, "metadata", options?.signal, async () => {
      const response = await this.request(url, options?.signal, {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        ...lowerCaseKeys(options?.headers ?? {}),
      });
      try {
        return await response.text();
      } catch (error) {
        throw new ExtractorError("network", `${new URL(url).host} cut the page short`, {
          cause: error,
        });
      }
    });
  }

  private async request(
    url: string,
    signal: AbortSignal | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent, ...headers },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new ExtractorError("network", `Could not reach ${new URL(url).host}`, { cause: error });
    }
    if (response.status === 404) throw new ExtractorError("not-found", `Not found: ${url}`);
    if (!response.ok) {
      const host = new URL(url).host;
      let retryAfterMs: number | undefined;
      if (response.status === 429 || response.status === 503) {
        // The whole host rests, not just this lane: a download would hit the same wall.
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        this.limiter.penalize(new URL(url).host, retryAfterMs ?? DEFAULT_BACKOFF_MS);
      }
      throw new ExtractorError("network", `${host} answered ${response.status}: try again later`, {
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }
    return response;
  }
}

/** Header names in one case, so a site's `User-Agent` replaces ours instead of going beside it. */
function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

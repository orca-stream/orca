import type { UrlGuard } from "../../application/ports.ts";
import { PermanentError } from "../../domain/errors.ts";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** The only headers a page may hand on: what a CDN checks, never anything that changes where we connect. */
const PASS_THROUGH = new Set(["referer", "cookie", "origin", "user-agent"]);
/** Sent only to the host that was asked for, never to wherever a redirect leads. */
const HOST_BOUND = new Set(["cookie", "origin"]);

/** The headers of a detected source worth sending on, lower-cased; the rest are dropped. */
export function passThrough(headers: Record<string, string> | undefined): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (PASS_THROUGH.has(key) && !/[\r\n]/.test(value)) clean[key] = value;
  }
  return clean;
}

/**
 * The response to `url`, following redirects by hand so that no hop goes unchecked by the guard.
 * `url` on the result is where it ended, which relative addresses in a playlist are resolved against.
 */
export async function guardedFetch(
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
  deps: { guard: UrlGuard; fetch: typeof fetch },
): Promise<{ response: Response; url: string }> {
  let headers = init.headers;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await deps.guard.assertUrl(url);
    const response = await deps.fetch(url, { signal: init.signal, redirect: "manual", headers });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url };
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new PermanentError(`HTTP ${response.status} without a Location`);
    const next = new URL(location, url);
    if (next.host !== new URL(url).host) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(([name]) => !HOST_BOUND.has(name)),
      );
    }
    url = next.href;
  }
  throw new PermanentError("Too many redirects");
}

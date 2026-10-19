/** Seconds or an HTTP date, as milliseconds from `now`. Undefined when there is none or it makes no sense. */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** What to back a host off for when it said 429/503 without saying for how long. */
export const DEFAULT_BACKOFF_MS = 30_000;

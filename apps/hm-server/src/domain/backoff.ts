const BASE_MS = 30_000;
const CAP_MS = 6 * 60 * 60 * 1000;

/**
 * Delay before the next try: min(30 s · 2^(attempts-1), 6 h) with jitter between 50% and 100%, so a
 * burst of failures doesn't come back all at once. A `Retry-After` from the server wins.
 */
export function backoffMs(attempts: number, random: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
  const exponential = Math.min(BASE_MS * 2 ** Math.max(0, attempts - 1), CAP_MS);
  return Math.round(exponential * (0.5 + random * 0.5));
}

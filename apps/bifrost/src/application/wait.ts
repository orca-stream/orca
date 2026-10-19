import { BifrostError } from "../domain/errors.ts";
import type { Clock } from "./ports/clock.ts";

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Time to let a restarting server actually go down before the first poll. */
  initialDelayMs?: number;
}

/** Polls `probe` until it returns true (or resolves without throwing, see `poll`). */
export async function waitFor(
  clock: Clock,
  what: string,
  probe: () => Promise<boolean>,
  { timeoutMs = 300_000, intervalMs = 2_000, initialDelayMs = 0 }: WaitOptions = {},
): Promise<void> {
  if (initialDelayMs > 0) await clock.sleep(initialDelayMs);
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await probe();
    } catch {
      // The server is unreachable while it restarts: that is the expected state, keep polling.
    }
    if (ok) return;
    if (clock.now() >= deadline) {
      throw new BifrostError(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}.`,
      );
    }
    await clock.sleep(intervalMs);
  }
}

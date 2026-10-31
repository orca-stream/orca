/** How far back the speed looks: long enough to smooth bursts, short enough to show a slowdown. */
const SPEED_WINDOW_MS = 10_000;
/** Samples closer than this to the last one replace it, so a fast download keeps few of them. */
const SAMPLE_SPACING_MS = 250;

/**
 * Bytes a second over the last few seconds. An average since the start hides a host that slows down
 * halfway: the number keeps showing the fast start long after it ended.
 */
export class SpeedMeter {
  private readonly samples: { at: number; bytes: number }[] = [];
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: { windowMs?: number; now?: () => number } = {}) {
    this.windowMs = options.windowMs ?? SPEED_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  /** Records the running byte count; the speed, or undefined while no time has passed. */
  update(bytes: number): number | undefined {
    const at = this.now();
    const last = this.samples.at(-1);
    if (last && this.samples.length > 1 && at - last.at < SAMPLE_SPACING_MS) {
      last.at = at;
      last.bytes = bytes;
    } else {
      this.samples.push({ at, bytes });
    }
    // Keep one sample at or before the window's start, so the window is always covered.
    while (
      this.samples.length > 2 &&
      at - (this.samples[1] as { at: number }).at >= this.windowMs
    ) {
      this.samples.shift();
    }
    const first = this.samples[0] as { at: number; bytes: number };
    const seconds = (at - first.at) / 1000;
    return seconds > 0 ? Math.max(0, (bytes - first.bytes) / seconds) : undefined;
  }
}

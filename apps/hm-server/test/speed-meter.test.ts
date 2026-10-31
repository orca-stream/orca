import { describe, expect, it } from "vite-plus/test";
import { SpeedMeter } from "../src/infrastructure/download/speed-meter.ts";

describe("SpeedMeter", () => {
  it("measures the last few seconds, so a slowdown shows right away", () => {
    let now = 0;
    const meter = new SpeedMeter({ windowMs: 10_000, now: () => now });
    expect(meter.update(0)).toBeUndefined();
    // Ten fast seconds at 10 MB/s…
    for (let second = 1; second <= 10; second++) {
      now = second * 1000;
      meter.update(second * 10_000_000);
    }
    // …then ten slow ones at 1 MB/s: an average since the start would still say 5.5 MB/s.
    let speed: number | undefined;
    for (let second = 1; second <= 10; second++) {
      now = 10_000 + second * 1000;
      speed = meter.update(100_000_000 + second * 1_000_000);
    }
    expect(speed).toBe(1_000_000);
  });

  it("never reports a negative speed when a failed try takes its bytes back", () => {
    let now = 0;
    const meter = new SpeedMeter({ now: () => now });
    meter.update(5_000);
    now = 1000;
    expect(meter.update(1_000)).toBe(0);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { AbortedError } from "../src/domain/errors.ts";
import { HostLimiter, hostLimitsFor, type HostLimits } from "../src/infrastructure/host-limiter.ts";
import { ManualClock } from "./fakes/clock.ts";

const limits = (
  download: Partial<HostLimits["download"]> = {},
  metadata: Partial<HostLimits["metadata"]> = {},
): HostLimits => ({
  metadata: { concurrency: 1, minIntervalMs: 1000, ...metadata },
  download: { concurrency: 1, minIntervalMs: 0, ...download },
});

/** A sleep that moves the manual clock, so waiting is instant and visible. */
function limiterWith(resolve: (host: string) => HostLimits, { advance = true } = {}) {
  const clock = new ManualClock();
  const slept: number[] = [];
  const limiter = new HostLimiter({
    limitsFor: resolve,
    clock,
    sleep: async (ms) => {
      slept.push(ms);
      if (advance) clock.advance(ms);
    },
  });
  return { limiter, clock, slept };
}

describe("HostLimiter concurrency", () => {
  it("never lets two holders of one host's lane run at once when the limit is 1", async () => {
    const { limiter } = limiterWith(() => limits());
    let live = 0;
    let peak = 0;
    const work = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live--;
    };
    await Promise.all([
      limiter.run("archive.org", "download", undefined, work),
      limiter.run("archive.org", "download", undefined, work),
      limiter.run("archive.org", "download", undefined, work),
    ]);
    expect(peak).toBe(1);
  });

  it("allows as many as the limit says, and different hosts do not wait for each other", async () => {
    const { limiter } = limiterWith(() => limits({ concurrency: 2 }));
    let live = 0;
    let peak = 0;
    const work = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live--;
    };
    await Promise.all(
      ["a.org", "a.org", "a.org", "b.org", "b.org", "b.org"].map((host) =>
        limiter.run(host, "download", undefined, work),
      ),
    );
    expect(peak).toBe(4);
  });

  it("keeps the lanes apart: a download does not hold up a metadata request", async () => {
    const { limiter } = limiterWith(() => limits());
    const releaseDownload = await limiter.acquire("archive.org", "download");
    await expect(limiter.run("archive.org", "metadata", undefined, async () => "ok")).resolves.toBe(
      "ok",
    );
    releaseDownload();
  });

  it("releases the slot when the work throws", async () => {
    const { limiter } = limiterWith(() => limits());
    await expect(
      limiter.run("a.org", "download", undefined, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(limiter.run("a.org", "download", undefined, async () => 1)).resolves.toBe(1);
  });

  it("stops waiting for a slot when aborted", async () => {
    const { limiter } = limiterWith(() => limits());
    const held = await limiter.acquire("a.org", "download");
    const controller = new AbortController();
    const waiting = limiter.acquire("a.org", "download", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AbortedError);
    held();
  });
});

describe("HostLimiter minimum interval", () => {
  it("spaces the starts of one host's lane by the interval, measured on the clock", async () => {
    const { limiter, clock, slept } = limiterWith(() => limits());
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await limiter.run("archive.org", "metadata", undefined, async () => {
        starts.push(clock.now());
      });
      clock.advance(300);
    }
    expect(slept).toEqual([700, 700]);
    const [first = 0, second = 0, third = 0] = starts;
    expect(second - first).toBe(1000);
    expect(third - second).toBe(1000);
  });

  it("does not wait when enough time already passed", async () => {
    const { limiter, clock, slept } = limiterWith(() => limits());
    await limiter.run("a.org", "metadata", undefined, async () => undefined);
    clock.advance(5000);
    await limiter.run("a.org", "metadata", undefined, async () => undefined);
    expect(slept).toEqual([]);
  });

  it("queues concurrent callers one interval apart instead of letting them burst", async () => {
    const { limiter, slept } = limiterWith(() => limits({}, { concurrency: 5 }), {
      advance: false,
    });
    await Promise.all(
      [0, 1, 2].map(() => limiter.run("a.org", "metadata", undefined, async () => undefined)),
    );
    // The first goes straight in; the others reserved slots 1 s and 2 s after it.
    expect(slept.sort((a, b) => a - b)).toEqual([1000, 2000]);
  });

  it("has no interval when it is 0", async () => {
    const { limiter, slept } = limiterWith(() => limits());
    await limiter.run("a.org", "download", undefined, async () => undefined);
    await limiter.run("a.org", "download", undefined, async () => undefined);
    expect(slept).toEqual([]);
  });
});

describe("hostLimitsFor", () => {
  const extractors = [
    { hosts: ["archive.org"], limits: { metadataPerSec: 1, downloadsPerHost: 1 } },
    { hosts: ["fast.example"], limits: { metadataPerSec: 4, downloadsPerHost: 3 } },
    { hosts: ["silent.example"] },
  ];

  it("takes what the extractor declares, for the host and its subdomains", () => {
    const resolve = hostLimitsFor(extractors, {});
    expect(resolve("archive.org")).toEqual(limits());
    expect(resolve("ia800.us.archive.org")).toEqual(limits());
    expect(resolve("fast.example")).toEqual(limits({ concurrency: 3 }, { minIntervalMs: 250 }));
  });

  it("lets the configuration override the declaration", () => {
    const resolve = hostLimitsFor(extractors, { downloadsPerHost: 2, metadataPerSec: 0.5 });
    expect(resolve("archive.org")).toEqual(limits({ concurrency: 2 }, { minIntervalMs: 2000 }));
  });

  it("falls back to polite defaults for a host nobody declared", () => {
    const resolve = hostLimitsFor(extractors, {});
    expect(resolve("silent.example")).toEqual(limits());
    expect(resolve("unknown.example")).toEqual(limits());
  });
});

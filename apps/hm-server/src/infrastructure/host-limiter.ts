import type { ExtractorLimits } from "@orca/extractor-core";
import type { Clock } from "../application/ports.ts";
import { AbortedError } from "../domain/errors.ts";
import { Semaphore } from "./semaphore.ts";

/** `metadata` is for small JSON calls, `download` for whole files; each has its own limits. */
export type Lane = "metadata" | "download";

export interface LaneLimit {
  /** Holders at the same time. */
  concurrency: number;
  /** At least this long between two starts. 0: no spacing. */
  minIntervalMs: number;
}

export type HostLimits = Record<Lane, LaneLimit>;

/** Applies to a host no extractor declared limits for: slow and one at a time. */
const FALLBACK_METADATA_INTERVAL_MS = 1000;
const FALLBACK_DOWNLOADS_PER_HOST = 1;

const FALLBACK_LIMITS: HostLimits = {
  metadata: { concurrency: 1, minIntervalMs: FALLBACK_METADATA_INTERVAL_MS },
  download: { concurrency: FALLBACK_DOWNLOADS_PER_HOST, minIntervalMs: 0 },
};

const toLimits = (limits: ExtractorLimits): HostLimits => ({
  metadata: { concurrency: 1, minIntervalMs: Math.round(1000 / limits.metadataPerSec) },
  download: { concurrency: limits.downloadsPerHost, minIntervalMs: 0 },
});

/**
 * Resolves the limits of a host: what the extractor that owns it (the host or a subdomain of one of
 * its `hosts`) declares, with the configuration overriding either number, or the fallback.
 */
export function hostLimitsFor(
  extractors: readonly { hosts: readonly string[]; limits?: ExtractorLimits }[],
  overrides: Partial<ExtractorLimits>,
): (host: string) => HostLimits {
  return (host) => {
    const owner = extractors.find((extractor) =>
      extractor.hosts.some((own) => host === own || host.endsWith(`.${own}`)),
    );
    const declared = owner?.limits
      ? toLimits(owner.limits)
      : structuredClone<HostLimits>(FALLBACK_LIMITS);
    if (overrides.metadataPerSec !== undefined) {
      declared.metadata.minIntervalMs = Math.round(1000 / overrides.metadataPerSec);
    }
    if (overrides.downloadsPerHost !== undefined) {
      declared.download.concurrency = overrides.downloadsPerHost;
    }
    return declared;
  };
}

export interface HostLimiterOptions {
  limitsFor: (host: string) => HostLimits;
  clock: Clock;
  /** Waits `ms`; rejects with AbortedError if the signal fires first. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Above this many (host, lane) pairs, the idle ones that owe no wait are forgotten. */
const LANE_PRUNE_THRESHOLD = 64;

interface LaneState {
  semaphore: Semaphore;
  nextStartAt: number;
}

/**
 * Politeness toward each remote host: a semaphore caps simultaneous holders and a minimum interval
 * spaces their starts. Every (host, lane) pair has its own state, so a slow download never delays a
 * metadata call and one site never slows another.
 */
export class HostLimiter {
  private readonly lanes = new Map<string, LaneState>();
  /** Until when each host must be left alone (a 429/503 asked for it). */
  private readonly penalties = new Map<string, number>();
  private readonly options: HostLimiterOptions;

  constructor(options: HostLimiterOptions) {
    this.options = options;
  }

  /** How many (host, lane) pairs are remembered. */
  get size(): number {
    return this.lanes.size;
  }

  /** The host asked us to back off (429/503): nothing starts on it for `ms`, in any lane. */
  penalize(host: string, ms: number): void {
    if (!(ms > 0)) return;
    const until = this.options.clock.now() + ms;
    this.penalties.set(host, Math.max(this.penalties.get(host) ?? 0, until));
  }

  private prune(now: number): void {
    for (const [key, state] of this.lanes) {
      if (state.semaphore.idle && state.nextStartAt <= now) this.lanes.delete(key);
    }
    for (const [host, until] of this.penalties) if (until <= now) this.penalties.delete(host);
  }

  async acquire(host: string, lane: Lane, signal?: AbortSignal): Promise<() => void> {
    const limit = this.options.limitsFor(host)[lane];
    const key = `${host}\u0000${lane}`;
    if (this.lanes.size > LANE_PRUNE_THRESHOLD) this.prune(this.options.clock.now());
    let state = this.lanes.get(key);
    if (!state) {
      state = { semaphore: new Semaphore(limit.concurrency), nextStartAt: 0 };
      this.lanes.set(key, state);
    }
    const release = await state.semaphore.acquire(signal);
    try {
      // Reserve the slot before waiting, so callers queue up one interval apart instead of bursting.
      const now = this.options.clock.now();
      const slot = Math.max(now, state.nextStartAt, this.penalties.get(host) ?? 0);
      if (limit.minIntervalMs > 0) state.nextStartAt = slot + limit.minIntervalMs;
      if (slot > now) await (this.options.sleep ?? realSleep)(slot - now, signal);
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  async run<T>(
    host: string,
    lane: Lane,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(host, lane, signal);
    try {
      return await task();
    } finally {
      release();
    }
  }
}

import type { Deps } from "./deps.ts";
import { createEnqueueCheck } from "./checks.ts";

/** How often the scheduler looks for followed series that are due. A tuning knob, not a setting. */
export const SCHEDULER_TICK_MS = 5 * 60 * 1000;

export interface SchedulerStart {
  everyMs: number;
  /** Runs `fn` every `ms` until the returned function is called. Replaced in tests. */
  every?: (fn: () => void, ms: number) => () => void;
  onError?: (error: unknown) => void;
}

function realEvery(fn: () => void, ms: number): () => void {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
}

/** Queues a `check_series` job for every followed series whose interval ran out. */
export class Scheduler {
  private readonly deps: Pick<Deps, "series" | "jobs" | "events" | "queue" | "clock">;
  private readonly enqueueCheck: ReturnType<typeof createEnqueueCheck>;
  private cancel: (() => void) | undefined;
  private pending = new Set<Promise<unknown>>();

  constructor(deps: Pick<Deps, "series" | "jobs" | "events" | "queue" | "clock">) {
    this.deps = deps;
    this.enqueueCheck = createEnqueueCheck(deps);
  }

  /** One pass. Returns how many jobs it queued (a series with a check already waiting adds none). */
  async tick(): Promise<number> {
    const due = await this.deps.series.findDueSeries(this.deps.clock.now());
    let queued = 0;
    for (const series of due) {
      if ((await this.enqueueCheck(series.id)).created) queued++;
    }
    return queued;
  }

  /** Ticks now and then every `everyMs`. */
  start(options: SchedulerStart): void {
    this.stop();
    const run = () => {
      const work = this.tick().catch(
        options.onError ?? ((error: unknown) => console.error("scheduler:", error)),
      );
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    };
    run();
    this.cancel = (options.every ?? realEvery)(run, options.everyMs);
  }

  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  /** For tests: resolves when the ticks started so far have finished. */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

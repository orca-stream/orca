import type { ProgressDetail } from "@orca/hm-contract";
import { backoffMs } from "../domain/backoff.ts";
import { AbortedError, AppError, RerouteError, RetryableError } from "../domain/errors.ts";
import { isTerminal, type FixedResource, type Job, type Resource } from "../domain/job.ts";
import type { Clock, JobCanceller, JobRepository, QueueSignal, Random } from "./ports.ts";

export interface JobContext {
  signal: AbortSignal;
  /** Throttled: at most one write and one event per second per job. */
  progress: (progress: number | null, detail?: ProgressDetail | null) => void;
}

export type JobOutcome = "done" | "failed" | "cancelled" | "requeued";

export interface JobHandler {
  run(job: Job, context: JobContext): Promise<void>;
  /** Called after the queue settled the job, e.g. to put the episode's status in line with it. */
  onOutcome?(job: Job, outcome: JobOutcome): Promise<void>;
}

/** What the queue tells the outside world. The HTTP layer turns these into SSE events. */
export interface QueueEvents {
  updated(job: Job): void;
  progress(job: Job, progress: number | null, detail: ProgressDetail | null): void;
}

export interface QueueOptions {
  jobs: JobRepository;
  clock: Clock;
  random: Random;
  handler: JobHandler;
  events: QueueEvents;
  /** How many jobs of each fixed resource may run at once; every host lane runs one at a time. */
  limits: Record<FixedResource, number>;
  /** Downloads take turns by episode: the next one starts once the current one is done or failed. */
  oneEpisodeAtATime?: boolean;
  owner?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  progressIntervalMs?: number;
  /** Where background failures (a busy database, a failed hook) are reported. */
  onError?: (error: unknown) => void;
}

const RESOURCES: FixedResource[] = ["browser", "ffmpeg", "download", "none"];
/** A host of video players serves one download at a time, whatever the configuration says. */
const HOST_LANE_LIMIT = 1;

/**
 * The persistent in-process queue: jobs live in SQLite, so a crash loses nothing. Workers claim the
 * next due job per resource, hold a lease they refresh while running, and a semaphore per resource
 * caps concurrency. A job that fails retryably is requeued with backoff; one that is cancelled is
 * aborted through its AbortSignal.
 */
export class JobQueue implements JobCanceller, QueueSignal {
  private readonly options: Required<Omit<QueueOptions, "limits">> & Pick<QueueOptions, "limits">;
  private readonly active = new Map<Resource, number>();
  private readonly running = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  /** Jobs stopped to wait (their series was paused): back to the queue, not cancelled. */
  private readonly interrupting = new Set<string>();
  private pumping: Promise<void> | undefined;
  private pumpAgain = false;
  private stopping = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: QueueOptions) {
    this.options = {
      owner: `hm-${process.pid}`,
      leaseMs: 60_000,
      heartbeatMs: 15_000,
      pollMs: 2_000,
      progressIntervalMs: 1_000,
      oneEpisodeAtATime: false,
      onError: (error: unknown) => console.error("job queue:", error),
      ...options,
    };
  }

  /** Recovers what a crash left running, then starts polling for due jobs. */
  async start(): Promise<void> {
    await this.options.jobs.recoverRunning();
    this.timer = setInterval(() => this.notify(), this.options.pollMs);
    this.timer.unref();
    this.notify();
  }

  /** Aborts what is running (it stays `running` in the database and is recovered at the next boot). */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const { controller } of this.running.values()) controller.abort();
    await Promise.allSettled([...this.running.values()].map((run) => run.done));
  }

  notify(): void {
    this.pump().catch(this.options.onError);
  }

  /** Claims and launches whatever is due and has a free slot. Safe to call from anywhere, any time. */
  pump(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.pumping) {
      this.pumpAgain = true;
      return this.pumping;
    }
    this.pumping = this.runPump().finally(() => {
      this.pumping = undefined;
    });
    return this.pumping;
  }

  private async runPump(): Promise<void> {
    do {
      this.pumpAgain = false;
      await this.options.jobs.recoverExpired([...this.running.keys()]);
      for (const resource of RESOURCES) {
        while (this.activeIn(resource) < this.options.limits[resource]) {
          if (!(await this.claimAndLaunch(resource))) break;
        }
      }
      // As many hosts as have work, each with its own single slot.
      for (const lane of await this.options.jobs.readyHostLanes()) {
        while (this.activeIn(lane) < HOST_LANE_LIMIT) {
          if (!(await this.claimAndLaunch(lane))) break;
        }
      }
    } while (this.pumpAgain);
  }

  private activeIn(resource: Resource): number {
    return this.active.get(resource) ?? 0;
  }

  private async claimAndLaunch(resource: Resource): Promise<boolean> {
    const job = await this.options.jobs.claim(resource, this.options.owner, this.options.leaseMs, {
      oneEpisodeAtATime: this.options.oneEpisodeAtATime,
    });
    if (!job) return false;
    this.launch(job);
    return true;
  }

  /** For tests: pumps until nothing is running and nothing more is due. */
  async settle(): Promise<void> {
    for (;;) {
      await this.pump();
      if (this.running.size === 0) return;
      await Promise.all([...this.running.values()].map((run) => run.done));
    }
  }

  async cancel(id: string): Promise<Job> {
    const { jobs, events, handler } = this.options;
    // A pump can claim the job between any two of these awaits, so try each state in turn.
    for (let attempt = 0; attempt < 5; attempt++) {
      const running = this.running.get(id);
      if (running) {
        running.controller.abort();
        await running.done;
        const settled = await jobs.get(id);
        if (settled) return settled;
      }
      const cancelled = await jobs.cancelQueued(id);
      if (cancelled) {
        events.updated(cancelled);
        await this.safely(() => handler.onOutcome?.(cancelled, "cancelled"));
        return cancelled;
      }
      const current = await jobs.get(id);
      if (!current) throw new AppError("not_found", `No job ${id}`);
      if (isTerminal(current.status)) return current;
      if (
        current.status === "running" &&
        !this.running.has(id) &&
        current.leaseOwner !== this.options.owner
      ) {
        // Another process's job, or a stale lease: cancel it as its holder.
        const stale = current.leaseOwner ? await jobs.cancelRunning(id, current.leaseOwner) : null;
        if (stale) {
          events.updated(stale);
          await this.safely(() => handler.onOutcome?.(stale, "cancelled"));
          return stale;
        }
      }
      // Claimed a moment ago: let the pump finish launching it, then abort it.
      await new Promise((resolve) => setImmediate(resolve));
    }
    const last = await jobs.get(id);
    if (!last) throw new AppError("not_found", `No job ${id}`);
    if (isTerminal(last.status)) return last;
    // Still live after every attempt: say so instead of handing back a job that did not stop.
    throw new AppError("conflict", `Job ${id} is still ${last.status}; try cancelling it again`);
  }

  /**
   * Stops a running job and queues it again as it was (payload, lane), refunding the attempt. Its
   * files stay, so a download picks up where it stopped. Nothing to do for a job not running here.
   */
  async interrupt(id: string): Promise<void> {
    const running = this.running.get(id);
    if (!running) return;
    this.interrupting.add(id);
    running.controller.abort();
    await running.done;
  }

  private launch(job: Job): void {
    this.active.set(job.resource, this.activeIn(job.resource) + 1);
    const controller = new AbortController();
    // A job moved to another lane is due at once, so a pump can claim it again while its previous run
    // is still settling (events, onOutcome): the new run starts once that one has finished.
    const previous = this.running.get(job.id)?.done ?? Promise.resolve();
    const entry: { controller: AbortController; done: Promise<void> } = {
      controller,
      done: Promise.resolve(),
    };
    entry.done = previous
      .then(() => this.execute(job, controller))
      .catch(this.options.onError)
      .finally(() => {
        const left = this.activeIn(job.resource) - 1;
        if (left > 0) this.active.set(job.resource, left);
        else this.active.delete(job.resource);
        if (this.running.get(job.id) === entry) this.running.delete(job.id);
        this.notify();
      });
    this.running.set(job.id, entry);
  }

  private async execute(job: Job, controller: AbortController): Promise<void> {
    const { jobs, handler, events, clock, random } = this.options;
    events.updated(job);
    const heartbeat =
      this.options.heartbeatMs > 0
        ? setInterval(
            () =>
              jobs
                .heartbeat(job.id, this.options.owner, this.options.leaseMs)
                .catch(this.options.onError),
            this.options.heartbeatMs,
          )
        : undefined;
    heartbeat?.unref();
    let lastProgress = -Infinity;
    const progress: JobContext["progress"] = (value, detail = null) => {
      const now = clock.now();
      if (now - lastProgress < this.options.progressIntervalMs) return;
      lastProgress = now;
      jobs.updateProgress(job.id, value, detail).catch(this.options.onError);
      events.progress(job, value, detail);
    };

    const owner = this.options.owner;
    const settled = async (next: Job | null, outcome: JobOutcome): Promise<void> => {
      // null: the row moved on while the worker ran (cancelled from outside, recovered). Leave it.
      if (!next) return;
      events.updated(next);
      await this.safely(() => handler.onOutcome?.(next, outcome));
    };

    try {
      await handler.run(job, { signal: controller.signal, progress });
      await settled(await jobs.complete(job.id, owner), "done");
    } catch (error) {
      if (controller.signal.aborted || error instanceof AbortedError) {
        if (this.stopping) return;
        if (this.interrupting.delete(job.id)) {
          const next = await jobs.reroute(job.id, owner, {
            resource: job.resource,
            payload: job.payload,
            runAfter: clock.now(),
            refund: true,
            note: "Paused",
          });
          await settled(next, "requeued");
          return;
        }
        await settled(await jobs.cancelRunning(job.id, owner), "cancelled");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof RerouteError &&
        !(error.countsAttempt && job.attempts >= job.maxAttempts)
      ) {
        const next = await jobs.reroute(job.id, owner, {
          resource: error.resource,
          payload: error.payload,
          runAfter: clock.now() + error.delayMs,
          refund: !error.countsAttempt,
          note: message === "" ? null : message,
        });
        await settled(next, "requeued");
        return;
      }
      if (error instanceof RetryableError && job.attempts < job.maxAttempts) {
        const delay = backoffMs(job.attempts, random.next(), error.retryAfterMs);
        await settled(await jobs.requeue(job.id, owner, clock.now() + delay, message), "requeued");
        return;
      }
      await settled(
        await jobs.fail(
          job.id,
          owner,
          message,
          error instanceof RetryableError ? "retryable" : "permanent",
        ),
        "failed",
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      // A job that finished before the interrupt reached it.
      this.interrupting.delete(job.id);
    }
  }

  private async safely(action: () => Promise<void> | undefined): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.options.onError(error);
    }
  }
}

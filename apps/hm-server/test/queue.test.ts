import { describe, expect, it } from "vite-plus/test";
import {
  JobQueue,
  type JobContext,
  type JobHandler,
  type JobOutcome,
  type QueueEvents,
} from "../src/application/queue.ts";
import { AbortedError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import type { Job, Resource } from "../src/domain/job.ts";
import { FixedRandom } from "./fakes/clock.ts";
import { testDatabase } from "./helpers.ts";

const LIMITS: Record<Resource, number> = { browser: 1, ffmpeg: 1, download: 2, none: 4 };

function setup(run: (job: Job, context: JobContext) => Promise<void>, limits = LIMITS) {
  const ctx = testDatabase();
  const outcomes: [string, JobOutcome][] = [];
  const updates: string[] = [];
  const handler: JobHandler = {
    run,
    onOutcome: async (job, outcome) => void outcomes.push([job.id, outcome]),
  };
  const events: QueueEvents = {
    updated: (job) => void updates.push(`${job.id}:${job.status}`),
    progress: () => {},
  };
  const queue = new JobQueue({
    jobs: ctx.jobs,
    clock: ctx.clock,
    random: new FixedRandom(1),
    handler,
    events,
    limits,
    heartbeatMs: 0,
    owner: "test",
  });
  const add = (extra = {}) =>
    ctx.jobs.enqueue({ kind: "download_episode", payload: {}, resource: "download", ...extra });
  return { ...ctx, queue, outcomes, updates, add };
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("JobQueue", () => {
  it("runs a due job and marks it done", async () => {
    const seen: string[] = [];
    const { queue, add, jobs, outcomes } = setup(async (job) => void seen.push(job.id));
    const { job } = await add();
    await queue.settle();
    expect(seen).toEqual([job.id]);
    expect((await jobs.get(job.id))?.status).toBe("done");
    expect(outcomes).toEqual([[job.id, "done"]]);
  });

  it("never runs more jobs of a resource than its limit", async () => {
    let current = 0;
    let peak = 0;
    const gates: ReturnType<typeof deferred>[] = [];
    const { queue, add } = setup(async () => {
      current++;
      peak = Math.max(peak, current);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      current--;
    });
    for (let i = 0; i < 5; i++) await add();
    await queue.pump();
    expect(current).toBe(2);
    while (gates.length < 5) {
      gates.shift()?.resolve();
      await new Promise((r) => setTimeout(r, 5));
      if (gates.length === 0) break;
    }
    await queue.settle();
    expect(peak).toBe(2);
  });

  it("keeps resources apart: a busy ffmpeg slot doesn't block downloads", async () => {
    const gate = deferred();
    const { queue, add, jobs } = setup(async (job) => {
      if (job.resource === "ffmpeg") await gate.promise;
    });
    const slow = await add({ resource: "ffmpeg" });
    await add({ resource: "ffmpeg" });
    const quick = await add();
    await queue.pump();
    await new Promise((r) => setTimeout(r, 5));
    expect((await jobs.get(quick.job.id))?.status).toBe("done");
    expect((await jobs.get(slow.job.id))?.status).toBe("running");
    gate.resolve();
    await queue.settle();
  });

  it("requeues a retryable failure with exponential backoff until the attempts run out", async () => {
    const { queue, add, jobs, clock, outcomes } = setup(async () => {
      throw new RetryableError("503");
    });
    const { job } = await add({ maxAttempts: 3 });

    await queue.settle();
    let current = await jobs.get(job.id);
    expect(current).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "503",
      runAfter: clock.now() + 30_000,
    });

    await queue.settle(); // not due yet
    expect((await jobs.get(job.id))?.attempts).toBe(1);

    clock.advance(30_000);
    await queue.settle();
    current = await jobs.get(job.id);
    expect(current).toMatchObject({
      status: "queued",
      attempts: 2,
      runAfter: clock.now() + 60_000,
    });

    clock.advance(60_000);
    await queue.settle();
    expect(await jobs.get(job.id)).toMatchObject({
      status: "failed",
      attempts: 3,
      errorKind: "retryable",
    });
    expect(outcomes.map(([, o]) => o)).toEqual(["requeued", "requeued", "failed"]);
  });

  it("obeys Retry-After", async () => {
    const { queue, add, jobs, clock } = setup(async () => {
      throw new RetryableError("429", { retryAfterMs: 120_000 });
    });
    const { job } = await add();
    await queue.settle();
    expect((await jobs.get(job.id))?.runAfter).toBe(clock.now() + 120_000);
  });

  it("fails a permanent error at once, and an unexpected one too", async () => {
    let n = 0;
    const { queue, add, jobs } = setup(async () => {
      throw n++ === 0 ? new PermanentError("404") : new Error("bug");
    });
    const a = await add();
    const b = await add();
    await queue.settle();
    expect(await jobs.get(a.job.id)).toMatchObject({
      status: "failed",
      errorKind: "permanent",
      lastError: "404",
    });
    expect(await jobs.get(b.job.id)).toMatchObject({
      status: "failed",
      errorKind: "permanent",
      lastError: "bug",
    });
  });

  it("cancels a queued job without ever running it", async () => {
    let ran = false;
    const { queue, add, jobs, outcomes } = setup(async () => void (ran = true));
    const { job } = await add({ runAfter: Date.now() + 10 ** 12 });
    const cancelled = await queue.cancel(job.id);
    expect(cancelled.status).toBe("cancelled");
    await queue.settle();
    expect(ran).toBe(false);
    expect((await jobs.get(job.id))?.status).toBe("cancelled");
    expect(outcomes).toEqual([[job.id, "cancelled"]]);
  });

  it("aborts a running job through its signal", async () => {
    let aborted = false;
    const started = deferred();
    const { queue, add, jobs } = setup(async (_job, { signal }) => {
      started.resolve();
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new AbortedError());
        }),
      );
    });
    const { job } = await add();
    await queue.pump();
    await started.promise;
    const cancelled = await queue.cancel(job.id);
    expect(aborted).toBe(true);
    expect(cancelled.status).toBe("cancelled");
    expect((await jobs.get(job.id))?.status).toBe("cancelled");
  });

  it("leaves running jobs running when the server stops, so the next boot recovers them", async () => {
    const started = deferred();
    const { queue, add, jobs } = setup(async (_job, { signal }) => {
      started.resolve();
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(new AbortedError())),
      );
    });
    const { job } = await add();
    await queue.pump();
    await started.promise;
    await queue.stop();
    expect((await jobs.get(job.id))?.status).toBe("running");
    expect(await jobs.recoverRunning()).toBe(1);
    expect((await jobs.get(job.id))?.attempts).toBe(0);
  });

  it("recovers jobs a previous crash left running when it starts", async () => {
    const seen: string[] = [];
    const { queue, add, jobs } = setup(async (job) => void seen.push(job.id));
    const { job } = await add();
    await jobs.claim("download", "dead-process", 60_000); // crashed mid-run
    await queue.start();
    await queue.settle();
    await queue.stop();
    expect(seen).toEqual([job.id]);
    expect((await jobs.get(job.id))?.status).toBe("done");
  });

  it("throttles progress to one write per interval", async () => {
    const written: number[] = [];
    const ctx = testDatabase();
    const queue = new JobQueue({
      jobs: ctx.jobs,
      clock: ctx.clock,
      random: new FixedRandom(),
      handler: {
        run: async (_job, { progress }) => {
          progress(0.1);
          progress(0.2); // same instant: dropped
          ctx.clock.advance(1000);
          progress(0.3);
        },
      },
      events: { updated: () => {}, progress: (_job, p) => void written.push(p ?? -1) },
      limits: LIMITS,
      heartbeatMs: 0,
    });
    await ctx.jobs.enqueue({ kind: "download_episode", payload: {}, resource: "download" });
    await queue.settle();
    expect(written).toEqual([0.1, 0.3]);
  });
});

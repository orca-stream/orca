import type { Job } from "../domain/job.ts";
import type { Deps } from "./deps.ts";
import { createJobEvents } from "./job-events.ts";
import type { EnqueueResult } from "./ports.ts";

/** Queues a `check_series` job for a series, unless one is already waiting or running for it. */
export function createEnqueueCheck(deps: Pick<Deps, "series" | "jobs" | "events" | "queue">) {
  const { publishJob } = createJobEvents(deps);

  return async function enqueueCheck(seriesId: string): Promise<EnqueueResult> {
    const result = await deps.jobs.enqueue({
      kind: "check_series",
      payload: { seriesId },
      seriesId,
      resource: "none",
      dedupeKey: `check:${seriesId}`,
    });
    if (result.created) {
      await publishJob(result.job satisfies Job);
      deps.queue.notify();
    }
    return result;
  };
}

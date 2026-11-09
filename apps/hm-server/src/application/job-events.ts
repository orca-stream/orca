import type { ProgressDetail } from "@orca/hm-contract";
import type { Job } from "../domain/job.ts";
import type { Deps } from "./deps.ts";
import { toJobDto } from "./presenter.ts";
import type { QueueEvents } from "./queue.ts";

/** Turns job changes into the SSE events the panel listens to. */
export function createJobEvents(deps: Pick<Deps, "series" | "events">) {
  async function publishJob(job: Job): Promise<void> {
    const of = job.seriesId
      ? (await deps.series.seriesTitles([job.seriesId])).get(job.seriesId)
      : null;
    const episode = job.episodeId ? await deps.series.getEpisode(job.episodeId) : null;
    deps.events.publish({ type: "job.updated", job: toJobDto(job, of ?? null, episode) });
  }

  const queueEvents: QueueEvents = {
    updated: (job) =>
      void publishJob(job).catch((error: unknown) => console.error("job event failed", error)),
    progress: (job: Job, progress: number | null, detail: ProgressDetail | null) =>
      deps.events.publish({
        type: "job.progress",
        jobId: job.id,
        seriesId: job.seriesId,
        episodeId: job.episodeId,
        progress,
        detail,
      }),
  };

  return { publishJob, queueEvents };
}

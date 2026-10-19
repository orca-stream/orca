import { AppError } from "../domain/errors.ts";
import type { Job, Resource } from "../domain/job.ts";
import type { Source } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createJobEvents } from "./job-events.ts";

export function resourceFor(source: Source): Resource {
  return source.kind === "direct" ? "download" : source.kind === "hls" ? "ffmpeg" : "browser";
}

/** Queues a download job for each episode that isn't in the library or already queued. */
export function createEnqueueDownloads(deps: Deps) {
  const { publishJob } = createJobEvents(deps);

  return async function enqueueDownloads(episodeIds: string[]): Promise<Job[]> {
    const unique = [...new Set(episodeIds)];
    const episodes = await deps.series.getEpisodes(unique);
    if (episodes.length !== unique.length) {
      const known = new Set(episodes.map((episode) => episode.id));
      const missing = unique.filter((id) => !known.has(id));
      throw new AppError("not_found", `Unknown episodes: ${missing.join(", ")}`);
    }

    const jobs: Job[] = [];
    for (const episode of episodes) {
      if (episode.status === "available") continue;
      const { job, created } = await deps.jobs.enqueue({
        kind: "download_episode",
        payload: { episodeId: episode.id },
        seriesId: episode.seriesId,
        episodeId: episode.id,
        resource: resourceFor(episode.source),
        dedupeKey: `dl:${episode.id}`,
      });
      jobs.push(job);
      if (created) {
        await deps.series.setEpisodeStatus(episode.id, "queued");
        await publishJob(job);
      }
    }
    if (jobs.length > 0) {
      for (const seriesId of new Set(episodes.map((episode) => episode.seriesId))) {
        deps.events.publish({ type: "series.updated", seriesId });
      }
      deps.queue.notify();
    }
    return jobs;
  };
}

/**
 * Asks for a library refresh of a series, a little later: every episode that lands in the next
 * `refreshDebounceMs` pushes the refresh back, so twenty episodes cost one scan.
 */
export function createEnqueueRefresh(deps: Deps) {
  return async function enqueueRefresh(seriesId: string): Promise<void> {
    const runAfter = deps.clock.now() + deps.refreshDebounceMs;
    const request = {
      kind: "refresh_library" as const,
      payload: { seriesId },
      seriesId,
      resource: "none" as const,
      runAfter,
    };
    const { job, created } = await deps.jobs.enqueue({
      ...request,
      dedupeKey: `refresh:${seriesId}`,
    });
    if (created) return;
    if (job.status === "queued") {
      await deps.jobs.postpone(job.id, runAfter);
    } else {
      // The running refresh may have scanned before this episode landed: ask for another.
      await deps.jobs.enqueue(request);
    }
  };
}

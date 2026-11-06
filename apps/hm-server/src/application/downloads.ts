import { AppError } from "../domain/errors.ts";
import type { Job, Resource } from "../domain/job.ts";
import { fileOutdated, type Source } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createJobEvents } from "./job-events.ts";

/**
 * Where a download starts. An episode with several players starts with a quick read of its page
 * (`none`) and moves to the lane of the player it picks from there.
 */
export function resourceFor(source: Source): Resource {
  switch (source.kind) {
    case "direct":
      return "download";
    case "hls":
      return "ffmpeg";
    case "page":
      return "browser";
    case "mirrors":
      return "none";
  }
}

/**
 * Queues a download job for each episode that isn't in the library or already queued. One whose
 * file is from a source it left is downloaded again: the new file replaces it once it is complete.
 */
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
    // An episode already being fetched, under any dedupe key (a handoff job has its own), is left alone.
    const active = new Map<string, Job>();
    for (const job of await deps.jobs.activeDownloadJobs(unique)) {
      if (job.episodeId && !active.has(job.episodeId)) active.set(job.episodeId, job);
    }
    // In the order they are watched: one episode at a time takes them as queued.
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    for (const episode of episodes) {
      if (episode.status === "available" && !fileOutdated(episode)) continue;
      const running = active.get(episode.id);
      if (running) {
        jobs.push(running);
        continue;
      }
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
 * `refreshDebounceMs` pushes the refresh back, so twenty episodes cost one scan. With
 * `replaceMetadata` (the series was renamed or got other ids) Jellyfin rereads it from scratch: a
 * plain refresh keeps the name it already has, whatever the nfo says now. With `replaceImages` (its
 * artwork changed) Jellyfin reads its images again, the ones in its folder first. Each is a job of
 * its own, so a pending plain refresh can't swallow it.
 */
export function createEnqueueRefresh(deps: Deps) {
  return async function enqueueRefresh(
    seriesId: string,
    options: { replaceMetadata?: boolean; replaceImages?: boolean } = {},
  ): Promise<void> {
    // Nobody to tell: whatever plays the library finds the files on its own.
    if (!deps.mediaServer) return;
    const runAfter = deps.clock.now() + deps.refreshDebounceMs;
    const replace = options.replaceMetadata === true;
    const images = !replace && options.replaceImages === true;
    const request = {
      kind: "refresh_library" as const,
      payload: replace
        ? { seriesId, replaceMetadata: true }
        : images
          ? { seriesId, replaceImages: true }
          : { seriesId },
      seriesId,
      resource: "none" as const,
      runAfter,
    };
    const prefix = replace ? "rename" : images ? "images" : "refresh";
    const { job, created } = await deps.jobs.enqueue({
      ...request,
      dedupeKey: `${prefix}:${seriesId}`,
    });
    if (created) return;
    if (job.status === "queued") {
      await deps.jobs.postpone(job.id, runAfter);
      return;
    }
    // The running refresh may have scanned before this episode landed: one follow-up covers them all.
    const next = await deps.jobs.enqueue({ ...request, dedupeKey: `${prefix}-next:${seriesId}` });
    if (!next.created) await deps.jobs.postpone(next.job.id, runAfter);
  };
}

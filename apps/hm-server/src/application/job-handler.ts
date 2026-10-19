import * as z from "zod";
import { PermanentError } from "../domain/errors.ts";
import type { Job } from "../domain/job.ts";
import { episodeCode, type Source } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createCheckSeries } from "./check-series.ts";
import { createEnqueueRefresh } from "./downloads.ts";
import type { JobHandler, JobOutcome } from "./queue.ts";

const DownloadPayload = z.object({ episodeId: z.string() });
const RefreshPayload = z.object({ seriesId: z.string() });
const CheckPayload = z.object({ seriesId: z.string() });

/** The pipeline for every kind of job. The queue calls `run`; `onOutcome` keeps episodes in line. */
export function createJobHandler(deps: Deps): JobHandler {
  const enqueueRefresh = createEnqueueRefresh(deps);
  const checkSeries = createCheckSeries(deps);

  async function resolveSource(source: Source, signal: AbortSignal): Promise<Source> {
    if (source.kind !== "page") return source;
    if (!deps.detector) {
      throw new PermanentError(
        "This source needs a browser to find the stream, which is not available yet",
      );
    }
    const streams = await deps.detector.detect(source.url, { signal });
    const stream =
      streams.find((candidate) => candidate.kind === "hls") ??
      streams.find((candidate) => candidate.kind === "direct");
    if (!stream) throw new PermanentError(`No video stream found on ${source.url}`);
    return stream.kind === "hls"
      ? { kind: "hls", url: stream.url, headers: stream.headers }
      : {
          kind: "direct",
          url: stream.url,
          fileName: new URL(stream.url).pathname.split("/").pop() || "video.mp4",
        };
  }

  async function downloadEpisode(
    job: Job,
    context: Parameters<JobHandler["run"]>[1],
  ): Promise<void> {
    const { episodeId } = DownloadPayload.parse(job.payload);
    const episode = await deps.series.getEpisode(episodeId);
    if (!episode) throw new PermanentError("The episode was removed");
    const series = await deps.series.get(episode.seriesId);
    if (!series) throw new PermanentError("The series was removed");
    if (episode.status === "available") return;

    await deps.series.setEpisodeStatus(episode.id, "downloading");
    deps.events.publish({ type: "series.updated", seriesId: series.id });

    const source = await resolveSource(episode.source, context.signal);
    const downloader = deps.downloaders.find((candidate) => candidate.canHandle(source));
    if (!downloader) throw new PermanentError(`No downloader for a ${source.kind} source`);

    const staged = deps.library.stagingPath(episode);
    await downloader.download(source, staged, {
      signal: context.signal,
      onProgress: ({ bytes, total, fraction, speed, eta }) => {
        const progress = fraction ?? (total ? bytes / total : null);
        context.progress(progress, {
          bytes,
          ...(total !== undefined ? { total } : {}),
          ...(speed !== undefined ? { speed } : {}),
          ...(eta !== undefined ? { eta } : {}),
        });
      },
    });

    await deps.library.writeSeries(series);
    const { relativePath } = await deps.library.commitEpisode(series, episode, staged);
    await deps.series.setEpisodeStatus(episode.id, "available", relativePath);
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    await enqueueRefresh(series.id);
  }

  async function refreshLibrary(job: Job): Promise<void> {
    const { seriesId } = RefreshPayload.parse(job.payload);
    const series = await deps.series.get(seriesId);
    if (!series) return;
    await deps.mediaServer.libraryUpdated(deps.library.seriesPath(series));
  }

  /** A job that gave up (permanent error, or retries spent) is worth a notification; a retry is not. */
  async function notifyFailure(job: Job): Promise<void> {
    const titles = job.seriesId
      ? await deps.series.seriesTitles([job.seriesId])
      : new Map<string, string>();
    const episode = job.episodeId ? await deps.series.getEpisode(job.episodeId) : null;
    await deps.notifications.jobFailed(job, {
      seriesTitle: (job.seriesId && titles.get(job.seriesId)) || null,
      episodeCode: episode ? episodeCode(episode.season, episode.episode) : null,
    });
  }

  /** When the last queued download of a series has finished, the batch is over. */
  async function notifyIfBatchDone(job: Job): Promise<void> {
    if (!job.seriesId) return;
    if (((await deps.jobs.countActiveDownloads()).get(job.seriesId) ?? 0) > 0) return;
    const series = await deps.series.get(job.seriesId);
    if (!series) return;
    const episodes = await deps.series.listEpisodes(series.id);
    await deps.notifications.seriesDownloaded(
      { id: series.id, title: series.title },
      {
        available: episodes.filter((episode) => episode.status === "available").length,
        total: episodes.length,
      },
      job.finishedAt ?? deps.clock.now(),
    );
  }

  return {
    async run(job, context) {
      switch (job.kind) {
        case "download_episode":
          return downloadEpisode(job, context);
        case "refresh_library":
          return refreshLibrary(job);
        case "check_series": {
          const { seriesId } = CheckPayload.parse(job.payload);
          await checkSeries(seriesId, context.signal);
          return;
        }
      }
    },

    async onOutcome(job: Job, outcome: JobOutcome) {
      if (outcome === "failed") await notifyFailure(job);
      if (job.kind === "download_episode" && outcome === "done") await notifyIfBatchDone(job);
      if (job.kind === "check_series" && outcome === "failed" && job.seriesId) {
        // Counts as a look: otherwise a broken series is queued again on every tick.
        await deps.series.update(job.seriesId, { lastCheckedAt: deps.clock.now() });
        return;
      }
      if (job.kind !== "download_episode" || !job.episodeId || outcome === "done") return;
      const episode = await deps.series.getEpisode(job.episodeId);
      if (!episode || episode.status === "available") return;
      if (outcome === "cancelled") await deps.library.discardStaged(episode);
      const status =
        outcome === "failed" ? "failed" : outcome === "requeued" ? "queued" : "missing";
      await deps.series.setEpisodeStatus(episode.id, status);
      deps.events.publish({ type: "series.updated", seriesId: episode.seriesId });
    },
  };
}

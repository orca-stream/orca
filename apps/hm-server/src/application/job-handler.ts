import * as z from "zod";
import { PermanentError } from "../domain/errors.ts";
import type { Job } from "../domain/job.ts";
import { episodeCode, type Series, type Source } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createCheckSeries } from "./check-series.ts";
import { createEnqueueRefresh, resourceFor } from "./downloads.ts";
import { createJobEvents } from "./job-events.ts";
import type { StreamPrefs } from "./ports.ts";
import type { JobHandler, JobOutcome } from "./queue.ts";

/** A stream found on a page, kept in the follow-up job so it need not be found again. */
const ResolvedSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hls"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    kind: z.literal("direct"),
    url: z.string(),
    fileName: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);
const DownloadPayload = z.object({ episodeId: z.string(), resolved: ResolvedSource.optional() });
const RefreshPayload = z.object({ seriesId: z.string() });
const CheckPayload = z.object({ seriesId: z.string() });

/** The pipeline for every kind of job. The queue calls `run`; `onOutcome` keeps episodes in line. */
export function createJobHandler(deps: Deps): JobHandler {
  const enqueueRefresh = createEnqueueRefresh(deps);
  const checkSeries = createCheckSeries(deps);
  const { publishJob } = createJobEvents(deps);

  /**
   * The stream a page plays. The detector ranks its findings best first, so the first one is taken
   * whatever its kind, and its address goes through the guard before anything else sees it.
   */
  async function detectStream(
    pageUrl: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof ResolvedSource>> {
    if (!deps.detector) {
      throw new PermanentError(
        "This source needs a browser to find the stream, which is not available yet",
      );
    }
    const stream = (await deps.detector.detect(pageUrl, { signal }))[0];
    if (!stream) throw new PermanentError(`No video stream found on ${pageUrl}`);
    const url = await deps.guard.assertUrl(stream.url);
    // ffmpeg reads DASH manifests as it reads HLS playlists.
    return stream.kind === "hls" || stream.kind === "dash"
      ? { kind: "hls", url: url.href, headers: stream.headers }
      : {
          kind: "direct",
          url: url.href,
          fileName: url.pathname.split("/").pop() || "video.mp4",
          headers: stream.headers,
        };
  }

  /** The series' own choice for each setting, else the server's default, else nothing (take it all). */
  function prefsOf(series: Series): StreamPrefs {
    const defaults = deps.streamDefaults;
    const maxHeight = series.maxHeight ?? defaults.maxHeight;
    const audioLangs = series.audioLangs ?? defaults.audioLangs;
    const subtitleLangs = series.subtitleLangs ?? defaults.subtitleLangs;
    return {
      ...(maxHeight !== undefined ? { maxHeight } : {}),
      ...(audioLangs !== undefined ? { audioLangs } : {}),
      ...(subtitleLangs !== undefined ? { subtitleLangs } : {}),
    };
  }

  async function downloadEpisode(
    job: Job,
    context: Parameters<JobHandler["run"]>[1],
  ): Promise<void> {
    const { episodeId, resolved } = DownloadPayload.parse(job.payload);
    const episode = await deps.series.getEpisode(episodeId);
    if (!episode) throw new PermanentError("The episode was removed");
    const series = await deps.series.get(episode.seriesId);
    if (!series) throw new PermanentError("The series was removed");
    if (episode.status === "available") return;

    await deps.series.setEpisodeStatus(episode.id, "downloading");
    deps.events.publish({ type: "series.updated", seriesId: series.id });

    if (!resolved && episode.source.kind === "page") {
      // Finding the stream is the browser's job; the long download is not, so it goes to a job of
      // its own under the resource that fits it, and the browser slot is free again at once.
      const found = await detectStream(episode.source.url, context.signal);
      const { job: next } = await deps.jobs.enqueue({
        kind: "download_episode",
        payload: { episodeId: episode.id, resolved: found },
        seriesId: series.id,
        episodeId: episode.id,
        resource: resourceFor(found),
        dedupeKey: `dlr:${episode.id}`,
      });
      await deps.series.setEpisodeStatus(episode.id, "queued");
      await publishJob(next);
      deps.events.publish({ type: "series.updated", seriesId: series.id });
      deps.queue.notify();
      return;
    }
    const source: Source = resolved ?? episode.source;
    const downloader = deps.downloaders.find((candidate) => candidate.canHandle(source));
    if (!downloader) throw new PermanentError(`No downloader for a ${source.kind} source`);

    const staged = deps.library.stagingPath(episode);
    const downloaded = await downloader.download(source, staged, {
      signal: context.signal,
      prefs: prefsOf(series),
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
    // The downloader may have chosen another container than the staged name asked for.
    const { relativePath } = await deps.library.commitEpisode(
      series,
      episode,
      downloaded.path ?? staged,
      downloaded.sidecars,
    );
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

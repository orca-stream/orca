import * as z from "zod";
import { backoffMs } from "../domain/backoff.ts";
import { AbortedError, PermanentError, RerouteError } from "../domain/errors.ts";
import { hostLane, type HostLane, type Job } from "../domain/job.ts";
import {
  episodeCode,
  fileOutdated,
  type Episode,
  type Series,
  type Source,
} from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createCheckSeries, toJobError } from "./check-series.ts";
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
const DownloadPayload = z.object({
  episodeId: z.string(),
  resolved: ResolvedSource.optional(),
  /** This download already started over from the page once: a second refusal is final. */
  redetected: z.boolean().optional(),
});

/** A failure that says the server refused the stream it was given (it may just have expired). */
const REFUSED_BY_SERVER = /\b(?:HTTP|returned) 4(?:\d\d|XX)\b/;
/** A download of an episode with several players: which ones, which one this try uses, which failed. */
const MirrorPayload = z.object({
  episodeId: z.string(),
  mirrors: z
    .array(
      z.object({
        url: z.string(),
        referer: z.string().optional(),
        framed: z.boolean().optional(),
      }),
    )
    .min(1),
  mirror: z.number().int().min(0),
  tried: z.array(z.number().int().min(0)),
  /** What each player that failed said, to report once every one has. */
  failures: z.array(z.string()),
});
type MirrorPayload = z.infer<typeof MirrorPayload>;

const hasMirrors = (payload: unknown): boolean =>
  typeof payload === "object" && payload !== null && "mirrors" in payload;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const RefreshPayload = z.object({ seriesId: z.string(), replaceMetadata: z.boolean().optional() });
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
    embedding: { referer?: string; framed?: boolean } = {},
  ): Promise<z.infer<typeof ResolvedSource>> {
    if (!deps.detector) {
      throw new PermanentError(
        "This source needs a browser to find the stream: turn on the detector (HM_DETECTOR_*)",
      );
    }
    const stream = (
      await deps.detector.detect(pageUrl, {
        signal,
        ...(embedding.referer ? { referer: embedding.referer } : {}),
        ...(embedding.framed ? { framed: true } : {}),
      })
    )[0];
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

  /**
   * Jobs that chose a host lane and are still on their way into it (the queue moves them after the
   * handler returns), so two episodes picking at the same moment don't both pick the same host.
   */
  const pendingPicks = new Map<string, HostLane>();

  /** A player on a host of SKIP_PLAYERS, or on a subdomain of one. */
  const skipped = (url: string): boolean => {
    const host = new URL(url).hostname.toLowerCase();
    return deps.skipPlayers.some((skip) => host === skip || host.endsWith(`.${skip}`));
  };

  /** Of the players `candidates` (indexes), the one whose host has the least work; the first on a tie. */
  async function pickMirror(
    jobId: string,
    mirrors: MirrorPayload["mirrors"],
    candidates: number[],
  ): Promise<number> {
    const load = await deps.jobs.countActiveByHostLane();
    for (const lane of pendingPicks.values()) load.set(lane, (load.get(lane) ?? 0) + 1);
    let best = candidates[0] as number;
    let bestLoad = Infinity;
    for (const index of candidates) {
      const lane = hostLane((mirrors[index] as MirrorPayload["mirrors"][number]).url);
      const work = load.get(lane) ?? 0;
      if (work < bestLoad) {
        best = index;
        bestLoad = work;
      }
    }
    pendingPicks.set(jobId, hostLane((mirrors[best] as MirrorPayload["mirrors"][number]).url));
    return best;
  }

  /** Downloads `source` into the library as `episode`, then asks Jellyfin to look. */
  async function fetchInto(
    series: Series,
    episode: Episode,
    source: Source,
    context: Parameters<JobHandler["run"]>[1],
  ): Promise<void> {
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

    // Renamed while it downloaded: it lands under the name the series has now.
    const now = (await deps.series.get(series.id)) ?? series;
    await deps.library.writeSeries(now);
    // A file from the source it left goes only now that the new one is complete, together with what
    // is named after it (subtitles, nfo, trickplay), which belongs to the old video.
    const current = (await deps.series.getEpisode(episode.id)) ?? episode;
    if (current.filePath !== null) {
      const result = await deps.library.deleteEpisode(now, current);
      if (result === "outside") {
        console.warn(
          `the old file of ${episodeCode(episode.season, episode.episode)} is outside “${now.title}”'s folder: left in place`,
        );
      }
    }
    // The downloader may have chosen another container than the staged name asked for.
    const { relativePath } = await deps.library.commitEpisode(
      now,
      episode,
      downloaded.path ?? staged,
      downloaded.sidecars,
    );
    await deps.series.setEpisodeStatus(episode.id, "available", relativePath, null);
    // Earlier attempts at it that failed are settled now: they leave the failures.
    await deps.jobs.dropSettledFailures();
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    await enqueueRefresh(series.id);
  }

  /**
   * First step of an episode with several players: reads them from its page (they may expire, so
   * only now) and moves the job to the lane of the least busy player's host.
   */
  async function readMirrors(
    job: Job,
    episode: Episode,
    pageUrl: string,
    signal: AbortSignal,
  ): Promise<never> {
    const source = episode.sourceId
      ? (await deps.series.listSources([episode.seriesId])).find((s) => s.id === episode.sourceId)
      : undefined;
    const extractor = source ? deps.extractors.get(source.extractorId) : null;
    if (!extractor?.resolveMirrors) {
      throw new PermanentError("The extractor that listed this episode cannot read its players");
    }
    let mirrors: MirrorPayload["mirrors"];
    try {
      mirrors = await extractor.resolveMirrors(pageUrl, { signal });
    } catch (error) {
      if (signal.aborted) throw new AbortedError({ cause: error });
      throw toJobError(error);
    }
    const listed = mirrors.filter((mirror) => /^https?:\/\//i.test(mirror.url));
    if (listed.length === 0) throw new PermanentError("The episode page lists no players");
    const usable = listed.filter((mirror) => !skipped(mirror.url));
    if (usable.length === 0) {
      const hosts = [...new Set(listed.map((mirror) => new URL(mirror.url).hostname))];
      throw new PermanentError(
        `Every player of the episode is on a skipped host (SKIP_PLAYERS): ${hosts.join(", ")}`,
      );
    }
    // One episode at a time: the page's order. Otherwise the least busy host.
    const first = deps.sequentialDownloads
      ? 0
      : await pickMirror(
          job.id,
          usable,
          usable.map((_, index) => index),
        );
    throw new RerouteError("", {
      resource: hostLane((usable[first] as MirrorPayload["mirrors"][number]).url),
      payload: {
        episodeId: episode.id,
        mirrors: usable,
        mirror: first,
        tried: [],
        failures: [],
      } satisfies MirrorPayload,
    });
  }

  /**
   * One player of an episode, in its host's lane: the browser finds the stream it plays and it is
   * downloaded right here, so the host serves one download at a time. A player that fails hands the
   * job to the next one; once every one has failed, the episode starts over from its page, later
   * (or, one episode at a time, fails).
   */
  async function downloadFromMirror(
    job: Job,
    payload: MirrorPayload,
    series: Series,
    episode: Episode,
    context: Parameters<JobHandler["run"]>[1],
  ): Promise<void> {
    const mirror = payload.mirrors[payload.mirror];
    if (!mirror) throw new PermanentError("The job names a player the episode does not have");
    const host = new URL(mirror.url).hostname;
    try {
      const found = await detectStream(mirror.url, context.signal, mirror);
      await fetchInto(series, episode, found, context);
    } catch (error) {
      if (context.signal.aborted || error instanceof AbortedError) throw error;
      const tried = [...payload.tried, payload.mirror];
      const failures = [...payload.failures, `${host}: ${describe(error)}`];
      const left = payload.mirrors.map((_, index) => index).filter((i) => !tried.includes(i));
      if (left.length > 0) {
        const next = deps.sequentialDownloads
          ? (left[0] as number)
          : await pickMirror(job.id, payload.mirrors, left);
        const nextUrl = (payload.mirrors[next] as MirrorPayload["mirrors"][number]).url;
        throw new RerouteError(
          `The player on ${host} failed (${describe(error)}); trying ${new URL(nextUrl).hostname}`,
          {
            resource: hostLane(nextUrl),
            payload: { ...payload, mirror: next, tried, failures } satisfies MirrorPayload,
          },
        );
      }
      const message = `Every player failed: ${failures.join("; ")}`;
      // One at a time, the episode fails here so the next one can start; it is retried by hand.
      if (deps.sequentialDownloads) throw new PermanentError(message);
      throw new RerouteError(message, {
        resource: "none",
        payload: { episodeId: episode.id },
        delayMs: backoffMs(job.attempts, deps.random.next()),
        countsAttempt: true,
      });
    }
  }

  async function downloadEpisode(
    job: Job,
    context: Parameters<JobHandler["run"]>[1],
  ): Promise<void> {
    const mirrorPayload = hasMirrors(job.payload) ? MirrorPayload.parse(job.payload) : null;
    const { episodeId, resolved, redetected } = DownloadPayload.parse(job.payload);
    const episode = await deps.series.getEpisode(episodeId);
    if (!episode) throw new PermanentError("The episode was removed");
    const series = await deps.series.get(episode.seriesId);
    if (!series) throw new PermanentError("The series was removed");
    if (episode.status === "available" && !fileOutdated(episode)) return;

    if (episode.source.kind === "mirrors" && !mirrorPayload) {
      return readMirrors(job, episode, episode.source.url, context.signal);
    }

    await deps.series.setEpisodeStatus(episode.id, "downloading");
    deps.events.publish({ type: "series.updated", seriesId: series.id });

    if (mirrorPayload) return downloadFromMirror(job, mirrorPayload, series, episode, context);

    if (!resolved && episode.source.kind === "page") {
      // Finding the stream is the browser's job; the long download is not, so it goes to a job of
      // its own under the resource that fits it, and the browser slot is free again at once.
      const found = await detectStream(episode.source.url, context.signal);
      const { job: next, created } = await deps.jobs.enqueue({
        kind: "download_episode",
        payload: {
          episodeId: episode.id,
          resolved: found,
          ...(redetected ? { redetected: true } : {}),
        },
        seriesId: series.id,
        episodeId: episode.id,
        resource: resourceFor(found),
        dedupeKey: `dlr:${episode.id}`,
      });
      if (created) {
        await deps.series.setEpisodeStatus(episode.id, "queued");
        await publishJob(next);
      }
      deps.events.publish({ type: "series.updated", seriesId: series.id });
      deps.queue.notify();
      return;
    }
    if (episode.source.kind === "mirrors") {
      throw new PermanentError("An episode with several players is downloaded through one of them");
    }
    await fetchInto(series, episode, resolved ?? episode.source, context);
  }

  async function refreshLibrary(job: Job): Promise<void> {
    const { seriesId, replaceMetadata } = RefreshPayload.parse(job.payload);
    const series = await deps.series.get(seriesId);
    if (!series) return;
    await deps.mediaServer?.libraryUpdated(deps.library.seriesPath(series), { replaceMetadata });
  }

  /**
   * A stream the server refused with a 4xx has probably expired. Once, the episode starts over from
   * its page (a new detection) instead of failing; the new job remembers it already did.
   */
  async function redetectAfterRefusal(job: Job): Promise<boolean> {
    const payload = DownloadPayload.safeParse(job.payload);
    if (!payload.success || !payload.data.resolved || payload.data.redetected) return false;
    if (!job.lastError || !REFUSED_BY_SERVER.test(job.lastError) || !job.episodeId) return false;
    const episode = await deps.series.getEpisode(job.episodeId);
    if (!episode || episode.source.kind !== "page" || episode.status === "available") return false;
    const { job: next, created } = await deps.jobs.enqueue({
      kind: "download_episode",
      payload: { episodeId: episode.id, redetected: true },
      seriesId: episode.seriesId,
      episodeId: episode.id,
      resource: resourceFor(episode.source),
      dedupeKey: `dl:${episode.id}`,
    });
    if (!created) return false;
    await deps.series.setEpisodeStatus(episode.id, "queued");
    await publishJob(next);
    deps.events.publish({ type: "series.updated", seriesId: episode.seriesId });
    deps.queue.notify();
    return true;
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
      // Its move has landed: the lane it chose now counts it.
      pendingPicks.delete(job.id);
      if (
        job.kind === "check_series" &&
        (outcome === "failed" || outcome === "cancelled") &&
        job.seriesId
      ) {
        // First, and whatever else goes wrong below: it counts as a look, otherwise a broken or
        // cancelled check is queued again on every tick.
        await deps.series.update(job.seriesId, { lastCheckedAt: deps.clock.now() });
      }
      if (
        outcome === "failed" &&
        job.kind === "download_episode" &&
        (await redetectAfterRefusal(job))
      ) {
        return;
      }
      if (outcome === "failed") {
        // Telling the panel is best effort; it must not keep the rest of this from happening.
        await notifyFailure(job).catch((error: unknown) =>
          console.error("notification failed:", error),
        );
      }
      if (job.kind === "download_episode" && outcome === "done") await notifyIfBatchDone(job);
      if (job.kind === "check_series") return;
      if (job.kind !== "download_episode" || !job.episodeId || outcome === "done") return;
      const episode = await deps.series.getEpisode(job.episodeId);
      if (!episode || episode.status === "available") return;
      if (outcome === "cancelled") await deps.library.discardStaged(episode);
      // Replacing a file that is still there: it stays watchable whatever became of the new one.
      const kept = fileOutdated(episode);
      const status =
        outcome === "requeued"
          ? "queued"
          : kept
            ? "available"
            : outcome === "failed"
              ? "failed"
              : "missing";
      await deps.series.setEpisodeStatus(episode.id, status);
      deps.events.publish({ type: "series.updated", seriesId: episode.seriesId });
    },
  };
}

import { createHash, randomBytes } from "node:crypto";
import type { Extraction } from "@orca/extractor-core";
import {
  LICENSE_ACK_REQUIRED,
  needsLicenseAck,
  type CreateSeriesBody,
  type EpisodeDto,
  type JobDto,
  type ListJobsQuery,
  type Me,
  type Page,
  type PreviewDto,
  type SeriesDto,
  type SeriesPatch,
} from "@orca/hm-contract";
import { AppError } from "../domain/errors.ts";
import { uuidv7 } from "../domain/ids.ts";
import type { Job } from "../domain/job.ts";
import type { Episode, Series, Source } from "../domain/series.ts";
import { seriesFolderName } from "../domain/naming.ts";
import type { Deps } from "./deps.ts";
import { trustedPosterUrl } from "./poster-url.ts";
import type { FetchedImage } from "./ports.ts";
import { createEnqueueDownloads } from "./downloads.ts";
import { createJobEvents } from "./job-events.ts";
import { toEpisodeDto, toJobDto, toPreviewDto, toSeriesDto } from "./presenter.ts";

type ExtractedEpisode = Extraction["episodes"][number];

function sourceOf(episode: ExtractedEpisode): Source {
  const { media } = episode;
  return {
    kind: "direct",
    url: media.url,
    fileName: media.fileName,
    ...(media.sizeBytes !== undefined ? { sizeBytes: media.sizeBytes } : {}),
    ...(media.md5 ? { md5: media.md5 } : {}),
    ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
  };
}

/** Sessions are stored by the SHA-256 of their id: the cookie is the only copy of the secret. */
const hashSessionId = (id: string): string => createHash("sha256").update(id).digest("hex");

export function createUseCases(deps: Deps) {
  /** Runs `task` after every earlier task for the same key has settled (in this process only). */
  const folderTails = new Map<string, Promise<unknown>>();
  async function withFolderLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (folderTails.get(key) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => undefined);
    folderTails.set(key, tail);
    try {
      return await run;
    } finally {
      if (folderTails.get(key) === tail) folderTails.delete(key);
    }
  }
  // One admin re-check per session at a time: a burst of requests shares the answer.
  const rechecks = new Map<string, Promise<boolean>>();

  const enqueueDownloads = createEnqueueDownloads(deps);
  const { publishJob } = createJobEvents(deps);

  async function jobDtos(jobs: Job[]): Promise<JobDto[]> {
    const titles = await deps.series.seriesTitles([
      ...new Set(jobs.flatMap((job) => (job.seriesId ? [job.seriesId] : []))),
    ]);
    const episodes = await deps.series.getEpisodes([
      ...new Set(jobs.flatMap((job) => (job.episodeId ? [job.episodeId] : []))),
    ]);
    const byId = new Map(episodes.map((episode) => [episode.id, episode]));
    return jobs.map((job) =>
      toJobDto(
        job,
        (job.seriesId && titles.get(job.seriesId)) || null,
        (job.episodeId && byId.get(job.episodeId)) || null,
      ),
    );
  }

  return {
    enqueueDownloads,

    listExtractors() {
      return deps.extractors
        .list()
        .map(({ id, name, hosts, example }) => ({ id, name, hosts, example }));
    },

    /** Runs the extractor and keeps the result for a short while; nothing is persisted. */
    async previewSeries(url: string, signal?: AbortSignal): Promise<PreviewDto> {
      const extractor = deps.extractors.find(url);
      if (!extractor) throw new AppError("bad_request", "No extractor handles this address");
      const extraction = await extractor.extract(url, signal ? { signal } : undefined);
      const previewId = deps.previews.put(extraction, extractor.id);
      const hasPoster = trustedPosterUrl(extraction.series.posterUrl, extractor.hosts) !== null;
      return toPreviewDto(extraction, previewId, extractor.id, hasPoster);
    },

    /** The cover of a preview, fetched from the extractor's own host; the panel can't ask for any other. */
    async previewPoster(previewId: string, signal?: AbortSignal): Promise<FetchedImage> {
      const preview = deps.previews.get(previewId);
      if (!preview) throw new AppError("gone", "This preview expired: preview the address again");
      const hosts = deps.extractors.list().find((e) => e.id === preview.extractorId)?.hosts ?? [];
      const url = trustedPosterUrl(preview.extraction.series.posterUrl, hosts);
      if (!url) throw new AppError("not_found", "This preview has no poster");
      try {
        return await deps.images.fetch(url, signal ? { signal } : undefined);
      } catch (error) {
        throw new AppError("upstream", "The poster could not be fetched", { cause: error });
      }
    },

    async addSeries(body: CreateSeriesBody): Promise<SeriesDto> {
      const preview = deps.previews.get(body.previewId);
      if (!preview) throw new AppError("gone", "This preview expired: preview the address again");
      const { extraction, extractorId } = preview;

      if (
        needsLicenseAck({ license: extraction.license.kind, year: body.year }) &&
        !body.licenseAck
      ) {
        throw new AppError(
          LICENSE_ACK_REQUIRED,
          "Confirm you have the right to download this before adding it",
        );
      }

      const wanted = new Set(body.episodeKeys);
      const chosen = extraction.episodes.filter((episode) => wanted.has(episode.sourceRef));
      if (chosen.length !== wanted.size) {
        const known = new Set(extraction.episodes.map((episode) => episode.sourceRef));
        throw new AppError(
          "bad_request",
          `Unknown episodes: ${[...wanted].filter((key) => !known.has(key)).join(", ")}`,
        );
      }

      const folderName = seriesFolderName(body.title, body.year);
      // Two submits for the same folder must not interleave: the check, the write and the save run
      // one after the other, so the second sees the first and a failed save only undoes its own files.
      const { series, episodes } = await withFolderLock(folderName, async () => {
        if (await deps.series.findByExternal(extractorId, extraction.series.externalId)) {
          throw new AppError("conflict", "This series was already added");
        }
        if (await deps.series.findByFolder(folderName)) {
          throw new AppError(
            "conflict",
            `A series already uses the folder “${folderName}”: change the title or the year`,
          );
        }

        const now = deps.clock.now();
        const series: Series = {
          id: uuidv7(now),
          title: body.title,
          year: body.year,
          plot: extraction.series.plot ?? null,
          extractorId,
          externalId: extraction.series.externalId,
          sourceUrl: extraction.series.sourceUrl,
          folderName,
          hasPoster: false,
          follow: body.follow,
          checkIntervalHours: 12,
          lastCheckedAt: null,
          remoteMarker: extraction.series.remoteMarker ?? null,
          createdAt: now,
        };
        const episodes: Episode[] = chosen.map((episode) => ({
          id: uuidv7(now),
          seriesId: series.id,
          season: episode.season,
          episode: episode.episode,
          title: episode.title,
          plot: episode.plot ?? null,
          airDate: episode.airDate ?? null,
          inferred: episode.inferred,
          sourceRef: episode.sourceRef,
          source: sourceOf(episode),
          durationSec: episode.media.durationSec ?? null,
          sizeBytes: episode.media.sizeBytes ?? null,
          format: episode.media.format ?? null,
          status: "missing",
          filePath: null,
          createdAt: now,
        }));

        // The folder first: if it can't be written there is nothing to undo. If saving then fails,
        // take the folder away again (when it was ours), so a retry doesn't meet a half-made series.
        const { createdFolder } = await deps.library.writeSeries(series);
        try {
          await deps.series.create(series, episodes);
        } catch (error) {
          // Only a folder this call made is this call's to undo.
          if (createdFolder) await deps.library.removeSeries(series).catch(() => undefined);
          throw error;
        }
        return { series, episodes };
      });

      let created = series;
      if (extraction.series.posterUrl) {
        try {
          await deps.library.writePoster(
            series,
            await deps.images.fetch(extraction.series.posterUrl),
          );
          created = (await deps.series.update(series.id, { hasPoster: true })) ?? series;
        } catch {
          // A missing cover is not worth failing the add for.
        }
      }

      deps.events.publish({ type: "series.updated", seriesId: series.id });
      if (body.downloadNow) await enqueueDownloads(episodes.map((episode) => episode.id));
      return toSeriesDto(created, (await deps.jobs.countActiveDownloads()).get(created.id) ?? 0, {
        episodeCount: episodes.length,
        availableCount: 0,
      });
    },

    async listSeries(): Promise<SeriesDto[]> {
      const [all, downloading] = await Promise.all([
        deps.series.list(),
        deps.jobs.countActiveDownloads(),
      ]);
      return all.map((series) => toSeriesDto(series, downloading.get(series.id) ?? 0));
    },

    async getSeries(id: string): Promise<SeriesDto> {
      const series = await deps.series.get(id);
      if (!series) throw new AppError("not_found", "No such series");
      const episodes = await deps.series.listEpisodes(id);
      const downloading = (await deps.jobs.countActiveDownloads()).get(id) ?? 0;
      return toSeriesDto(series, downloading, {
        episodeCount: episodes.length,
        availableCount: episodes.filter((episode) => episode.status === "available").length,
      });
    },

    async patchSeries(id: string, patch: SeriesPatch): Promise<SeriesDto> {
      const current = await deps.series.get(id);
      if (!current) throw new AppError("not_found", "No such series");
      const updated = await deps.series.update(id, patch);
      if (updated && (patch.title !== undefined || patch.year !== undefined)) {
        // The folder keeps its name; Jellyfin reads the new title from the nfo.
        await deps.library.writeSeries(updated);
      }
      deps.events.publish({ type: "series.updated", seriesId: id });
      return this.getSeries(id);
    },

    async listEpisodes(seriesId: string): Promise<EpisodeDto[]> {
      if (!(await deps.series.get(seriesId))) throw new AppError("not_found", "No such series");
      const episodes = await deps.series.listEpisodes(seriesId);
      const running = await deps.jobs.list({ status: ["running"], limit: 200 });
      const progress = new Map(
        running.items.flatMap((job) =>
          job.episodeId ? [[job.episodeId, job.progress] as const] : [],
        ),
      );
      return episodes.map((episode) => toEpisodeDto(episode, progress.get(episode.id) ?? null));
    },

    async downloadSeries(seriesId: string): Promise<JobDto[]> {
      if (!(await deps.series.get(seriesId))) throw new AppError("not_found", "No such series");
      const episodes = await deps.series.listEpisodes(seriesId);
      const jobs = await enqueueDownloads(
        episodes.filter((episode) => episode.status !== "available").map((episode) => episode.id),
      );
      return jobDtos(jobs);
    },

    async enqueue(episodeIds: string[]): Promise<JobDto[]> {
      return jobDtos(await enqueueDownloads(episodeIds));
    },

    async listJobs(query: ListJobsQuery): Promise<Page<JobDto>> {
      const page = await deps.jobs.list({
        ...(query.status ? { status: query.status } : {}),
        limit: query.limit,
        cursor: query.cursor,
      });
      return { items: await jobDtos(page.items), nextCursor: page.nextCursor };
    },

    async retryJob(id: string): Promise<JobDto> {
      const current = await deps.jobs.get(id);
      if (!current) throw new AppError("not_found", "No such job");
      let job: Job | null;
      try {
        job = await deps.jobs.retry(id);
      } catch {
        throw new AppError("conflict", "Another job for the same work is already active");
      }
      if (!job) throw new AppError("conflict", "Only failed or cancelled jobs can be retried");
      if (job.episodeId) await deps.series.setEpisodeStatus(job.episodeId, "queued");
      await publishJob(job);
      if (job.seriesId) deps.events.publish({ type: "series.updated", seriesId: job.seriesId });
      deps.queue.notify();
      return (await jobDtos([job]))[0] as JobDto;
    },

    async cancelJob(id: string): Promise<JobDto> {
      if (!(await deps.jobs.get(id))) throw new AppError("not_found", "No such job");
      return (await jobDtos([await deps.canceller.cancel(id)]))[0] as JobDto;
    },

    async login(username: string, password: string): Promise<{ sessionId: string; me: Me }> {
      const user = await deps.authenticator.authenticate(username, password);
      const now = deps.clock.now();
      const sessionId = randomBytes(32).toString("base64url");
      await deps.sessions.deleteExpired(now);
      await deps.sessions.create({
        id: hashSessionId(sessionId),
        userId: user.userId,
        userName: user.userName,
        createdAt: now,
        expiresAt: now + deps.sessionTtlMs,
        checkedAt: now,
      });
      return { sessionId, me: { userId: user.userId, userName: user.userName } };
    },

    async logout(sessionId: string): Promise<void> {
      await deps.sessions.delete(hashSessionId(sessionId));
    },

    /** The user behind a session cookie, or null. Re-confirms they are still an administrator hourly. */
    async resolveSession(cookieValue: string): Promise<Me | null> {
      const sessionId = hashSessionId(cookieValue);
      const session = await deps.sessions.find(sessionId);
      if (!session) return null;
      const now = deps.clock.now();
      if (session.expiresAt <= now) {
        await deps.sessions.delete(sessionId);
        return null;
      }
      if (now - session.checkedAt >= deps.adminRecheckMs) {
        try {
          let check = rechecks.get(sessionId);
          if (!check) {
            check = deps.authenticator
              .isStillAdmin(session.userId)
              .finally(() => rechecks.delete(sessionId));
            rechecks.set(sessionId, check);
          }
          if (!(await check)) {
            await deps.sessions.delete(sessionId);
            return null;
          }
          await deps.sessions.touch(sessionId, now);
        } catch {
          // Jellyfin is down: that says nothing about the user, so the session stays.
        }
      }
      return { userId: session.userId, userName: session.userName };
    },

    async posterOf(seriesId: string): Promise<string | null> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      return deps.library.posterPath(series);
    },
  };
}

export type UseCases = ReturnType<typeof createUseCases>;

import { createHash, randomBytes } from "node:crypto";
import {
  episodeOffset,
  IMDB_ID_PATTERN,
  TMDB_ID_PATTERN,
  type ArtworkKind,
  type ArtworkOptionsDto,
  type CreateSeriesInput,
  type EpisodeDto,
  type JobDto,
  type LibraryEpisodeDto,
  type LibraryShowDto,
  type ListJobsQuery,
  type NotificationList,
  type Me,
  type Page,
  type PreviewDto,
  type SeriesDto,
  type SeriesPatch,
  type ShowLookupDto,
  type SourcePatch,
  type SwitchSourceBody,
  type SwitchSourceResult,
  type GuideEpisodeDto,
  type GuideSeasonDto,
} from "@orca/hm-contract";
import { AppError } from "../domain/errors.ts";
import { uuidv7 } from "../domain/ids.ts";
import type { Job } from "../domain/job.ts";
import { episodeCode, type Episode, type Series, type SeriesSource } from "../domain/series.ts";
import { seriesFolderName } from "../domain/naming.ts";
import type { Deps } from "./deps.ts";
import { trustedPosterUrl } from "./poster-url.ts";
import {
  ARTWORK_FLAG,
  fitsKind,
  MAX_ARTWORK_BYTES,
  sniffImage,
  TMDB_IMAGE_HOSTS,
} from "./artwork.ts";
import type { EpisodeSourceSwitch, FetchedImage, LibraryShow } from "./ports.ts";
import { createEnqueueDownloads, createEnqueueRefresh } from "./downloads.ts";
import { createJobEvents } from "./job-events.ts";
import {
  closeFinishedSources,
  type ExtractedEpisode,
  sourceOf,
  newEpisode,
  normalizeSeries,
  numberOf,
  placeOnDisk,
} from "./episodes.ts";
import { createEnqueueCheck } from "./checks.ts";
import {
  toEpisodeDto,
  toJobDto,
  toNotificationDto,
  toPreviewDto,
  toSeriesDto,
  downloadsBySeries,
} from "./presenter.ts";

/**
 * What an episode's file is said to come from when its source is unknown (it was removed): never a
 * source id, so the file counts as another source's.
 */
const UNKNOWN_SOURCE = "unknown";

/** What an episode keeps and what it takes when it moves to `source`, which lists it as `found`. */
function switchTo(
  source: SeriesSource,
  episode: Episode,
  found: ExtractedEpisode,
): EpisodeSourceSwitch {
  // The file is the old source's, unless it is going back to the source it came from.
  const fileFrom =
    episode.filePath === null ? null : (episode.fileSourceId ?? episode.sourceId ?? UNKNOWN_SOURCE);
  return {
    id: episode.id,
    sourceId: source.id,
    sourceRef: found.sourceRef,
    source: sourceOf(found),
    durationSec: found.media.durationSec ?? null,
    sizeBytes: found.media.sizeBytes ?? null,
    format: found.media.format ?? null,
    fileSourceId: fileFrom === source.id ? null : fileFrom,
    // What failed, failed on the old source: on this one it is simply not downloaded yet.
    status: episode.status === "failed" ? "missing" : episode.status,
  };
}

/** Sessions are stored by the SHA-256 of their id: the cookie is the only copy of the secret. */
const hashSessionId = (id: string): string => createHash("sha256").update(id).digest("hex");

/**
 * A download job that carries the stream a browser found (see the page handoff in the job handler),
 * or the players of an episode it read: either may have expired by now.
 */
function hasResolvedStream(job: Job): boolean {
  const payload = job.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    ("resolved" in payload || "mirrors" in payload)
  );
}

/** The Jellyfin show a series is: the one in its folder first, else one with its TMDB or IMDb id. */
function showOf(series: Series, shows: readonly LibraryShow[]): LibraryShow | null {
  return (
    shows.find((show) => show.folderName === series.folderName) ??
    (series.tmdbId ? shows.find((show) => show.tmdbId === series.tmdbId) : undefined) ??
    (series.imdbId ? shows.find((show) => show.imdbId === series.imdbId) : undefined) ??
    null
  );
}

/** What to say when the series a new one would duplicate already exists. */
function alreadyHave(series: Series): AppError {
  const name = series.year === null ? series.title : `${series.title} (${series.year})`;
  return new AppError(
    "conflict",
    `You already have “${name}” with the same TMDB or IMDb id: add this address to it`,
  );
}

/** Two chosen episodes must not land on the same season and number. */
function assertDistinctNumbers(numbers: { season: number; episode: number }[]): void {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { season, episode } of numbers) {
    const code = episodeCode(season, episode);
    if (seen.has(code)) twice.add(code);
    seen.add(code);
  }
  if (twice.size > 0) {
    throw new AppError(
      "bad_request",
      `Two chosen episodes would both be ${[...twice].join(", ")}: change the season or leave one out`,
    );
  }
}

export function createUseCases(deps: Deps) {
  /** The TMDB guide, or why the panel has to ask for the numbers by hand. */
  function episodeGuide() {
    if (!deps.episodeGuide) {
      throw new AppError(
        "unavailable",
        "No TMDB key: set TMDB_API_KEY to list seasons and episodes",
      );
    }
    return deps.episodeGuide;
  }

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
  const enqueueRefresh = createEnqueueRefresh(deps);
  const enqueueCheck = createEnqueueCheck(deps);
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

  /** The hosts an extractor may name images on; none for an extractor that's gone. */
  const nextUrlOf = (source: SeriesSource): string | null =>
    deps.extractors.get(source.extractorId)?.nextSourceUrl?.(source.sourceUrl) ?? null;
  const hostsOf = (extractorId: string): readonly string[] =>
    deps.extractors.list().find((extractor) => extractor.id === extractorId)?.hosts ?? [];
  /** Each series' downloads as they stand now. */
  const downloadsNow = async () => {
    const [counts, running] = await Promise.all([
      deps.jobs.countActiveDownloads(),
      deps.jobs.runningDownloads(),
    ]);
    return downloadsBySeries(counts, running);
  };

  return {
    enqueueDownloads,

    listExtractors() {
      return deps.extractors.list().map(({ id, name, hosts, example, explicitOnly }) => ({
        id,
        name,
        hosts,
        example,
        explicit: explicitOnly === true,
      }));
    },

    /** Runs the extractor and keeps the result for a short while; nothing is persisted. */
    async previewSeries(
      url: string,
      signal?: AbortSignal,
      extractorId?: string,
    ): Promise<PreviewDto> {
      const extractor = extractorId ? deps.extractors.get(extractorId) : deps.extractors.find(url);
      if (!extractor) {
        throw new AppError(
          "bad_request",
          extractorId ? `No extractor “${extractorId}”` : "No extractor handles this address",
        );
      }
      const extraction = await extractor.extract(url, signal ? { signal } : undefined);
      const previewId = deps.previews.put(extraction, extractor.id);
      const hasPoster = trustedPosterUrl(extraction.series.posterUrl, extractor.hosts) !== null;
      return toPreviewDto(extraction, previewId, extractor.id, hasPoster);
    },

    /** The cover of a preview, fetched from the extractor's own host; the panel can't ask for any other. */
    async previewPoster(previewId: string, signal?: AbortSignal): Promise<FetchedImage> {
      const preview = deps.previews.get(previewId);
      if (!preview) throw new AppError("gone", "This preview expired: preview the address again");
      const hosts = hostsOf(preview.extractorId);
      const url = trustedPosterUrl(preview.extraction.series.posterUrl, hosts);
      if (!url) throw new AppError("not_found", "This preview has no poster");
      try {
        return await deps.images.fetch(url, { hosts, ...(signal ? { signal } : {}) });
      } catch (error) {
        throw new AppError("upstream", "The poster could not be fetched", { cause: error });
      }
    },

    async addSeries(body: CreateSeriesInput): Promise<SeriesDto> {
      const preview = deps.previews.get(body.previewId);
      if (!preview) throw new AppError("gone", "This preview expired: preview the address again");
      const { extraction, extractorId } = preview;

      const wanted = new Set(body.episodeKeys);
      const chosen = extraction.episodes.filter((episode) => wanted.has(episode.sourceRef));
      if (chosen.length !== wanted.size) {
        const known = new Set(extraction.episodes.map((episode) => episode.sourceRef));
        throw new AppError(
          "bad_request",
          `Unknown episodes: ${[...wanted].filter((key) => !known.has(key)).join(", ")}`,
        );
      }

      // Only adjustments of episodes the address lists; one of the same episode twice keeps the last.
      const listed = new Set(extraction.episodes.map((e) => `${e.season}:${e.episode}`));
      const adjustments = [
        ...new Map(
          (body.adjustments ?? [])
            .filter((a) => listed.has(`${a.season}:${a.episode}`))
            .map((a) => [`${a.season}:${a.episode}`, a] as const),
        ).values(),
      ];
      // Measured on everything the address lists, not only what was chosen: a check later on finds
      // the same lowest number, so the episodes it adds move by the same amount.
      const mapping = {
        season: body.season ?? null,
        episodeOffset: episodeOffset(body.firstEpisode ?? null, extraction.episodes, adjustments),
        adjustments,
      };
      assertDistinctNumbers(chosen.map((episode) => numberOf(mapping, episode)));

      const now = deps.clock.now();
      const sourceFor = (seriesId: string): SeriesSource => ({
        id: uuidv7(now),
        seriesId,
        extractorId,
        externalId: extraction.series.externalId,
        sourceUrl: extraction.series.sourceUrl,
        season: mapping.season,
        episodeOffset: mapping.episodeOffset,
        adjustments: mapping.adjustments,
        remoteMarker: extraction.series.remoteMarker ?? null,
        knownRefs: extraction.episodes.map((episode) => episode.sourceRef),
        closed: false,
        createdAt: now,
      });
      const assertNewAddress = async () => {
        const taken = await deps.series.findSourceByExternal(
          extractorId,
          extraction.series.externalId,
        );
        if (!taken) return;
        const title = (await deps.series.seriesTitles([taken.seriesId])).get(taken.seriesId);
        throw new AppError(
          "conflict",
          title ? `This address was already added to “${title}”` : "This address was already added",
        );
      };

      if (body.seriesId !== undefined) {
        const seriesId = body.seriesId;
        const { series, episodes, switched } = await withFolderLock(
          `series:${seriesId}`,
          async () => {
            const series = await deps.series.get(seriesId);
            if (!series) throw new AppError("not_found", "No such series");
            await assertNewAddress();
            const source = sourceFor(series.id);
            const existing = await deps.series.listEpisodes(series.id);
            const atNumber = new Map(
              existing.map((episode) => [`${episode.season}:${episode.episode}`, episode]),
            );
            // A chosen episode the series already has takes its video from this address from now on,
            // as "change the source" does; the others are new.
            const episodes: Episode[] = [];
            const replaced: { current: Episode; found: ExtractedEpisode }[] = [];
            for (const found of chosen) {
              const { season, episode } = numberOf(mapping, found);
              const current = atNumber.get(`${season}:${episode}`);
              if (current) replaced.push({ current, found });
              else episodes.push(newEpisode(source, found, now));
            }
            const downloading = new Set(
              (await deps.jobs.activeDownloadJobs(replaced.map(({ current }) => current.id))).map(
                (job) => job.episodeId,
              ),
            );
            const busy = replaced.filter(({ current }) => downloading.has(current.id));
            if (busy.length > 0) {
              const codes = busy.map(({ current }) => episodeCode(current.season, current.episode));
              throw new AppError(
                "conflict",
                `${codes.join(", ")} ${codes.length === 1 ? "is" : "are"} being downloaded: wait for it, or leave ${codes.length === 1 ? "it" : "them"} out`,
              );
            }
            const switches = replaced.map(({ current, found }) => switchTo(source, current, found));
            // Files its folder has that no row of this server's knows of (a library from before, a
            // season added by hand) are those episodes: they take this server's names and aren't
            // downloaded again, as when a Jellyfin show is taken over.
            const wanted = new Set(
              episodes.map((episode) => `${episode.season}:${episode.episode}`),
            );
            const media = deps.mediaServer;
            const show = media ? showOf(series, await media.listShows()) : null;
            const files =
              media && show
                ? (await media.listEpisodeFiles(show.id)).filter((file) =>
                    wanted.has(`${file.season}:${file.episode}`),
                  )
                : [];
            const onDisk = new Map(
              (await deps.library.renameEpisodes(series, files)).map((file) => [
                `${file.season}:${file.episode}`,
                file.relativePath,
              ]),
            );
            const placed = await placeOnDisk(
              deps.library,
              series,
              episodes.map((episode): Episode => {
                const filePath = onDisk.get(`${episode.season}:${episode.episode}`);
                return filePath ? { ...episode, status: "available", filePath } : episode;
              }),
            );
            await deps.series.addSource(source, placed, switches);
            await closeFinishedSources(deps.series, series.id, source.id, placed, existing);
            return { series, episodes: placed, switched: switches.map((change) => change.id) };
          },
        );
        await deps.jobs.dropFailures(switched);
        const found = episodes.filter((episode) => episode.status === "available");
        if (found.length > 0) await enqueueRefresh(series.id);
        deps.events.publish({ type: "series.updated", seriesId: series.id });
        const missing = episodes.filter((episode) => episode.status !== "available");
        // Asked for: what changed source is downloaded again too (a file it has is replaced).
        if (body.downloadNow) {
          await enqueueDownloads([...missing.map((episode) => episode.id), ...switched]);
        }
        return this.getSeries(series.id);
      }

      if (body.jellyfinId !== undefined) {
        const media = deps.mediaServer;
        if (!media) throw new AppError("bad_request", "There is no Jellyfin to take a show from");
        const show = (await media.listShows()).find((item) => item.id === body.jellyfinId);
        if (!show) throw new AppError("not_found", "Jellyfin has no such show");
        const folderName = show.folderName;
        if (folderName === null) {
          throw new AppError(
            "bad_request",
            `“${show.title}” is outside this server's media folder, so it can't add to it`,
          );
        }
        const { series, episodes } = await withFolderLock(folderName, async () => {
          await assertNewAddress();
          const tracked =
            (await deps.series.findByFolder(folderName)) ??
            (await deps.series.findByProviderIds(show));
          if (tracked) throw alreadyHave(tracked);

          const series: Series = {
            id: uuidv7(now),
            title: show.title,
            year: show.year,
            plot: null,
            tmdbId: show.tmdbId !== null && TMDB_ID_PATTERN.test(show.tmdbId) ? show.tmdbId : null,
            imdbId: show.imdbId !== null && IMDB_ID_PATTERN.test(show.imdbId) ? show.imdbId : null,
            folderName,
            hasPoster: false,
            hasBackdrop: false,
            hasLogo: false,
            artworkVersion: 0,
            artworkFrom: {},
            follow: body.follow ?? false,
            paused: false,
            checkIntervalHours: 12,
            lastCheckedAt: null,
            maxHeight: null,
            audioLangs: null,
            subtitleLangs: null,
            preferredSources: {},
            createdAt: now,
          };
          // Artwork the show's folder already has (Jellyfin may have saved it there) is its own.
          series.hasPoster = (await deps.library.artworkPath(series, "poster")) !== null;
          series.hasBackdrop = (await deps.library.artworkPath(series, "backdrop")) !== null;
          series.hasLogo = (await deps.library.artworkPath(series, "logo")) !== null;
          // The show's own files take this server's names first, so the ones the address also lists
          // are known to be there and aren't downloaded again. Its nfo and images are left alone.
          // Renamed files stay renamed if saving then fails: they are the same files, better named.
          const files = await media.listEpisodeFiles(show.id);
          const onDisk = new Map(
            (await deps.library.renameEpisodes(series, files)).map((file) => [
              `${file.season}:${file.episode}`,
              file.relativePath,
            ]),
          );
          const source = sourceFor(series.id);
          const episodes = chosen.map((episode): Episode => {
            const row = newEpisode(source, episode, now);
            const filePath = onDisk.get(`${row.season}:${row.episode}`);
            return filePath ? { ...row, status: "available", filePath } : row;
          });
          await deps.series.create(series, source, episodes);
          return { series, episodes };
        });
        // Jellyfin finds the renamed files on its next look at the folder.
        await enqueueRefresh(series.id);
        deps.events.publish({ type: "series.updated", seriesId: series.id });
        const missing = episodes.filter((episode) => episode.status !== "available");
        if (body.downloadNow) await enqueueDownloads(missing.map((episode) => episode.id));
        return this.getSeries(series.id);
      }

      const title = body.title ?? extraction.series.title;
      const year = body.year ?? null;
      const folderName = seriesFolderName(title, year);
      const tmdbId = body.tmdbId ?? null;
      const imdbId = body.imdbId ?? null;
      // Two submits for the same folder must not interleave: the check, the write and the save run
      // one after the other, so the second sees the first and a failed save only undoes its own files.
      const { series, episodes } = await withFolderLock(folderName, async () => {
        await assertNewAddress();
        const same = await deps.series.findByProviderIds({ tmdbId, imdbId });
        if (same) throw alreadyHave(same);
        if (await deps.series.findByFolder(folderName)) {
          throw new AppError(
            "conflict",
            `A series already uses the folder “${folderName}”: change the title or the year, or add this address to that series`,
          );
        }

        const series: Series = {
          id: uuidv7(now),
          title,
          year,
          plot: extraction.series.plot ?? null,
          tmdbId,
          imdbId,
          folderName,
          hasPoster: false,
          hasBackdrop: false,
          hasLogo: false,
          artworkVersion: 0,
          artworkFrom: {},
          follow: body.follow ?? false,
          paused: false,
          checkIntervalHours: 12,
          lastCheckedAt: null,
          maxHeight: null,
          audioLangs: null,
          subtitleLangs: null,
          preferredSources: {},
          createdAt: now,
        };
        const source = sourceFor(series.id);
        // A folder that was already there may hold some of them.
        const episodes = await placeOnDisk(
          deps.library,
          series,
          chosen.map((episode) => newEpisode(source, episode, now)),
        );

        // The folder first: if it can't be written there is nothing to undo. If saving then fails,
        // take the folder away again (when it was ours), so a retry doesn't meet a half-made series.
        const { createdFolder } = await deps.library.writeSeries(series);
        try {
          await deps.series.create(series, source, episodes);
        } catch (error) {
          // Only a folder this call made is this call's to undo.
          if (createdFolder) await deps.library.removeSeries(series).catch(() => undefined);
          throw error;
        }
        return { series, episodes };
      });

      let created = series;
      const hosts = hostsOf(extractorId);
      const posterUrl = trustedPosterUrl(extraction.series.posterUrl, hosts);
      if (posterUrl) {
        try {
          const image = await deps.images.fetch(posterUrl, { hosts });
          await deps.library.writeArtwork(series, "poster", image);
          created = (await deps.series.update(series.id, { hasPoster: true })) ?? series;
        } catch {
          // A missing cover is not worth failing the add for.
        }
      }

      deps.events.publish({ type: "series.updated", seriesId: series.id });
      if (body.downloadNow) await enqueueDownloads(episodes.map((episode) => episode.id));
      return toSeriesDto(
        created,
        await deps.series.listSources([created.id]),
        nextUrlOf,
        (await downloadsNow())(created.id),
        { episodeCount: episodes.length, availableCount: 0 },
      );
    },

    async listSeries(): Promise<SeriesDto[]> {
      const [all, sources, downloading] = await Promise.all([
        deps.series.list(),
        deps.series.listSources(),
        downloadsNow(),
      ]);
      return all.map((series) =>
        toSeriesDto(
          series,
          sources.filter((source) => source.seriesId === series.id),
          nextUrlOf,
          downloading(series.id),
        ),
      );
    },

    /**
     * What TMDB calls the show, so the panel can fill in a new series from its id: through Jellyfin's
     * own TMDB provider when there is a Jellyfin, else through this server's TMDB key, in `language`.
     * Without either, the panel asks for the show's details by hand.
     */
    async lookupShow(
      tmdbId: string,
      signal?: AbortSignal,
      language?: string,
    ): Promise<ShowLookupDto> {
      const find = deps.mediaServer
        ? deps.mediaServer.findShowByTmdbId(tmdbId, signal)
        : deps.episodeGuide
          ? deps.episodeGuide.match(tmdbId, language, signal)
          : Promise.reject(
              new AppError("unavailable", "Looking a show up needs Jellyfin or a TMDB key"),
            );
      const [show, guide] = await Promise.all([
        find,
        // Only with a TMDB key of our own, and only extras: without them the lookup still answers.
        deps.episodeGuide?.show(tmdbId, signal, language).catch((error: unknown) => {
          if (signal?.aborted) throw error;
          return null;
        }) ?? null,
      ]);
      if (!show) throw new AppError("not_found", `TMDB has no show with the id ${tmdbId}`);
      const imdbId = show.imdbId !== null && IMDB_ID_PATTERN.test(show.imdbId) ? show.imdbId : null;
      return {
        tmdbId,
        title: show.title,
        year: show.year,
        imdbId,
        overview: show.overview,
        posterUrl: show.posterUrl,
        backdropUrl: guide?.backdropUrl ?? null,
        logoUrl: guide?.logoUrl ?? null,
        status: guide?.status ?? null,
        nextEpisode: guide?.nextEpisode ?? null,
      };
    },

    /** A show's seasons as TMDB numbers them, to pick the one an address goes to. */
    async guideSeasons(
      tmdbId: string,
      language: string | undefined,
      signal?: AbortSignal,
    ): Promise<GuideSeasonDto[]> {
      const seasons = await episodeGuide().seasons(tmdbId, language, signal);
      if (!seasons) throw new AppError("not_found", `TMDB has no show with the id ${tmdbId}`);
      return seasons;
    },

    /** The episodes of one of those seasons, to pick the one an address starts at. */
    async guideEpisodes(
      tmdbId: string,
      season: number,
      language: string | undefined,
      signal?: AbortSignal,
    ): Promise<GuideEpisodeDto[]> {
      const episodes = await episodeGuide().episodes(tmdbId, season, language, signal);
      if (!episodes) {
        throw new AppError("not_found", `TMDB has no season ${season} for the show ${tmdbId}`);
      }
      return episodes;
    },

    /**
     * Every show in Jellyfin, and the series this server has for it: by folder first, else by TMDB or
     * IMDb id. The panel offers the ones it doesn't have to add an address to.
     */
    async listLibraryShows(signal?: AbortSignal): Promise<LibraryShowDto[]> {
      if (!deps.mediaServer) return [];
      const [shows, all] = await Promise.all([
        deps.mediaServer.listShows(signal),
        deps.series.list(),
      ]);
      const byFolder = new Map(all.map((series) => [series.folderName, series.id]));
      const byTmdb = new Map(all.flatMap((s) => (s.tmdbId ? [[s.tmdbId, s.id] as const] : [])));
      const byImdb = new Map(all.flatMap((s) => (s.imdbId ? [[s.imdbId, s.id] as const] : [])));
      return shows
        .map((show) => ({
          id: show.id,
          title: show.title,
          year: show.year,
          tmdbId: show.tmdbId,
          imdbId: show.imdbId,
          seriesId:
            (show.folderName !== null ? byFolder.get(show.folderName) : undefined) ??
            (show.tmdbId ? byTmdb.get(show.tmdbId) : undefined) ??
            (show.imdbId ? byImdb.get(show.imdbId) : undefined) ??
            null,
          adoptable: show.folderName !== null,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    /** The episodes a Jellyfin show has as files: adopting it keeps them rather than download them. */
    async listLibraryEpisodes(showId: string, signal?: AbortSignal): Promise<LibraryEpisodeDto[]> {
      if (!deps.mediaServer) return [];
      const files = await deps.mediaServer.listEpisodeFiles(showId, signal);
      return files
        .map(({ season, episode }) => ({ season, episode }))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
    },

    async getSeries(id: string): Promise<SeriesDto> {
      const series = await deps.series.get(id);
      if (!series) throw new AppError("not_found", "No such series");
      const episodes = await deps.series.listEpisodes(id);
      const downloading = (await downloadsNow())(id);
      return toSeriesDto(series, await deps.series.listSources([id]), nextUrlOf, downloading, {
        episodeCount: episodes.length,
        availableCount: episodes.filter((episode) => episode.status === "available").length,
        lastDownloadAt: await deps.series.lastDownloadAt(id),
      });
    },

    async patchSeries(id: string, patch: SeriesPatch): Promise<SeriesDto> {
      const current = await deps.series.get(id);
      if (!current) throw new AppError("not_found", "No such series");
      if (patch.preferredSources !== undefined) {
        const own = new Set((await deps.series.listSources([id])).map((source) => source.id));
        const foreign = Object.values(patch.preferredSources).filter((s) => !own.has(s));
        if (foreign.length > 0) {
          throw new AppError("bad_request", "A preferred source must be one of the series'");
        }
      }
      const updated = await deps.series.update(id, patch);
      if (patch.paused === true && !current.paused) {
        // What is downloading stops now and waits in the queue with what it has fetched.
        const ids = (await deps.series.listEpisodes(id)).map((episode) => episode.id);
        const running = (await deps.jobs.activeDownloadJobs(ids)).filter(
          (job) => job.status === "running",
        );
        await Promise.all(running.map((job) => deps.canceller.interrupt(job.id)));
      }
      if (patch.paused === false && current.paused) deps.queue.notify();
      if (
        updated &&
        (patch.title !== undefined ||
          patch.year !== undefined ||
          patch.tmdbId !== undefined ||
          patch.imdbId !== undefined)
      ) {
        // The folder and the files take the new name; Jellyfin reads the new title from the nfo,
        // but only when told to replace what it has.
        if (updated.title !== current.title || updated.year !== current.year) {
          await withFolderLock(`series:${id}`, () => normalizeSeries(deps, updated));
        }
        await deps.library.writeSeries((await deps.series.get(id)) ?? updated);
        const renamed = (["title", "year", "tmdbId", "imdbId"] as const).some(
          (field) => updated[field] !== current[field],
        );
        if (renamed) await enqueueRefresh(id, { replaceMetadata: true });
      }
      deps.events.publish({ type: "series.updated", seriesId: id });
      return this.getSeries(id);
    },

    /** Closes or reopens one address of a series: a closed one is left out of every check. */
    async patchSource(seriesId: string, sourceId: string, patch: SourcePatch): Promise<SeriesDto> {
      const source = (await deps.series.listSources([seriesId])).find((s) => s.id === sourceId);
      if (!source) throw new AppError("not_found", "No such source");
      await deps.series.updateSource(sourceId, { closed: patch.closed });
      deps.events.publish({ type: "series.updated", seriesId });
      return this.getSeries(seriesId);
    },

    /**
     * Moves episodes to another source of their series, read again now (what it lists may have
     * changed since it was added). Each takes its video from there from now on; nothing is
     * downloaded: one with a file keeps it until it is downloaded again by hand. Those the source
     * doesn't list, and those being downloaded, stay as they are.
     */
    async switchSource(
      seriesId: string,
      body: SwitchSourceBody,
      signal?: AbortSignal,
    ): Promise<SwitchSourceResult> {
      if (!(await deps.series.get(seriesId))) throw new AppError("not_found", "No such series");
      const source = (await deps.series.listSources([seriesId])).find(
        (s) => s.id === body.sourceId,
      );
      if (!source) throw new AppError("not_found", "No such source");
      const extractor = deps.extractors.get(source.extractorId);
      if (!extractor) {
        throw new AppError(
          "conflict",
          `The “${source.extractorId}” extractor is no longer installed: that source can't be read`,
        );
      }
      const extraction = await extractor.extract(source.sourceUrl, signal ? { signal } : undefined);
      // Where the source puts what it lists; the first of two at the same number, as a preview shows.
      const listed = new Map<string, ExtractedEpisode>();
      for (const found of extraction.episodes) {
        const { season, episode } = numberOf(source, found);
        const key = `${season}:${episode}`;
        if (!listed.has(key)) listed.set(key, found);
      }

      const result = await withFolderLock(`series:${seriesId}`, async () => {
        const episodes = await deps.series.listEpisodes(seriesId);
        const wanted = new Set(body.episodeIds);
        const chosen = episodes.filter((episode) => wanted.has(episode.id));
        if (chosen.length !== wanted.size) {
          const known = new Set(chosen.map((episode) => episode.id));
          const unknown = [...wanted].filter((id) => !known.has(id));
          throw new AppError("not_found", `Unknown episodes: ${unknown.join(", ")}`);
        }
        const downloading = new Set(
          (await deps.jobs.activeDownloadJobs([...wanted])).map((job) => job.episodeId),
        );
        const refOwner = new Map(episodes.map((episode) => [episode.sourceRef, episode.id]));
        const switches: EpisodeSourceSwitch[] = [];
        const notListed: string[] = [];
        const busy: string[] = [];
        for (const episode of chosen) {
          const code = episodeCode(episode.season, episode.episode);
          if (downloading.has(episode.id)) {
            busy.push(code);
            continue;
          }
          const found = listed.get(`${episode.season}:${episode.episode}`);
          // Two episodes of a series can't share a key: one the series has as another episode is
          // not this one.
          const owner = found ? refOwner.get(found.sourceRef) : undefined;
          if (!found || (owner !== undefined && owner !== episode.id)) {
            notListed.push(code);
            continue;
          }
          switches.push(switchTo(source, episode, found));
        }
        await deps.series.switchEpisodeSources(switches);
        // Nothing else knows these keys: a check of the source must not add them again.
        const refs = new Set(source.knownRefs ?? []);
        for (const change of switches) refs.add(change.sourceRef);
        if (source.knownRefs !== null)
          await deps.series.updateSource(source.id, { knownRefs: [...refs] });
        return {
          switched: switches.length,
          notListed,
          busy,
          switchedIds: switches.map((c) => c.id),
        };
      });
      // Failures on the old source are settled: retrying one would fetch from there.
      await deps.jobs.dropFailures(result.switchedIds);
      deps.events.publish({ type: "series.updated", seriesId });
      return { switched: result.switched, notListed: result.notListed, busy: result.busy };
    },

    /** "Check now": queues the same job the scheduler does, so it shares its dedupe and its limits. */
    async checkSeriesNow(seriesId: string): Promise<JobDto> {
      if (!(await deps.series.get(seriesId))) throw new AppError("not_found", "No such series");
      const { job } = await enqueueCheck(seriesId);
      return (await jobDtos([job]))[0] as JobDto;
    },

    async listEpisodes(seriesId: string): Promise<EpisodeDto[]> {
      if (!(await deps.series.get(seriesId))) throw new AppError("not_found", "No such series");
      const episodes = await deps.series.listEpisodes(seriesId);
      const live = await deps.jobs.activeDownloadJobs(episodes.map((episode) => episode.id));
      const downloads = new Map<string, Job>();
      for (const job of live) {
        if (!job.episodeId) continue;
        // A running one says more than one still waiting.
        if (!downloads.has(job.episodeId) || job.status === "running")
          downloads.set(job.episodeId, job);
      }
      return episodes.map((episode) => toEpisodeDto(episode, downloads.get(episode.id) ?? null));
    },

    /**
     * Deletes a downloaded episode's file (and what goes with it) so it can be downloaded again: it
     * stays in the series as not downloaded, and Jellyfin is told to look.
     */
    async deleteEpisodeFile(seriesId: string, episodeId: string): Promise<EpisodeDto> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      const episode = await deps.series.getEpisode(episodeId);
      if (!episode || episode.seriesId !== seriesId) {
        throw new AppError("not_found", "No such episode");
      }
      if (episode.status !== "available") {
        throw new AppError("conflict", "Only a downloaded episode can be deleted");
      }
      if ((await deps.jobs.activeDownloadJobs([episodeId])).length > 0) {
        throw new AppError("conflict", "That episode is being downloaded");
      }
      await withFolderLock(`series:${seriesId}`, async () => {
        const result = await deps.library.deleteEpisode(series, episode);
        if (result === "outside") {
          throw new AppError(
            "conflict",
            "That episode's file is outside the series' folder: delete it from Jellyfin",
          );
        }
        await deps.series.setEpisodeStatus(episodeId, "missing", null, null);
      });
      deps.events.publish({ type: "series.updated", seriesId });
      await enqueueRefresh(seriesId);
      const updated = (await deps.series.getEpisode(episodeId)) as Episode;
      return toEpisodeDto(updated, null);
    },

    /**
     * Forgets a series: its sources, its episodes and its follow-up checks. What it had queued or
     * running is cancelled first (a running download stops and drops what it staged). Its folder is
     * deleted only with `files`; otherwise the files stay where they are, for Jellyfin.
     */
    async deleteSeries(seriesId: string, options: { files: boolean }): Promise<void> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      const queued: string[] = [];
      const running: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await deps.jobs.list({ status: ["queued", "running"], limit: 200, cursor });
        for (const job of page.items) {
          if (job.seriesId === seriesId) (job.status === "queued" ? queued : running).push(job.id);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      // The waiting ones first: stopping a running one frees its slot for the next in line.
      for (const id of [...queued, ...running]) await deps.canceller.cancel(id);

      const removed = await withFolderLock(`series:${seriesId}`, async () => {
        const result = options.files ? await deps.library.deleteSeriesFolder(series) : "kept";
        await deps.series.delete(seriesId);
        return result === "deleted";
      });
      deps.events.publish({ type: "series.updated", seriesId });
      // Nothing to queue it on (its refresh looks the series up): Jellyfin is told now, best effort.
      if (removed && deps.mediaServer) {
        await deps.mediaServer
          .libraryUpdated(deps.library.seriesPath(series), { removed: true })
          .catch((error: unknown) => console.warn("library refresh after delete failed:", error));
      }
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
      // A download of a stream found on a page froze that stream's address, which may have expired:
      // retrying it by hand starts over from the page like any new download.
      if (current.kind === "download_episode" && current.episodeId && hasResolvedStream(current)) {
        const [fresh] = await enqueueDownloads([current.episodeId]);
        if (!fresh) throw new AppError("conflict", "That episode is already downloaded");
        return (await jobDtos([fresh]))[0] as JobDto;
      }
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

    /**
     * Cancels every episode download still waiting in the queue, not the ones already running.
     * Collects them first and cancels after, so cancelling never shifts the pages being read.
     * Returns how many were cancelled.
     */
    async cancelQueuedDownloads(): Promise<{ cancelled: number }> {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await deps.jobs.list({ status: ["queued"], limit: 200, cursor });
        for (const job of page.items) if (job.kind === "download_episode") ids.push(job.id);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      let cancelled = 0;
      for (const id of ids) {
        const job = await deps.canceller.cancel(id);
        if (job.status === "cancelled") cancelled += 1;
      }
      return { cancelled };
    },

    async listNotifications(limit: number): Promise<NotificationList> {
      const [items, unreadCount] = await Promise.all([
        deps.notificationRepository.list(limit),
        deps.notificationRepository.unreadCount(),
      ]);
      return { items: items.map(toNotificationDto), unreadCount };
    },

    /** No ids: every unread one. Returns what is still unread. */
    async markNotificationsRead(ids?: string[]): Promise<{ unreadCount: number }> {
      await deps.notificationRepository.markRead(deps.clock.now(), ids);
      return { unreadCount: await deps.notificationRepository.unreadCount() };
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

    /** Ends every session but the one behind `keepCookie` (every one when null). */
    async endSessions(keepCookie: string | null): Promise<void> {
      await deps.sessions.deleteAllExcept(keepCookie === null ? null : hashSessionId(keepCookie));
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

    /** The file of a series' own artwork of that kind; null when it has none of its own. */
    async artworkOf(seriesId: string, kind: ArtworkKind): Promise<string | null> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      return deps.library.artworkPath(series, kind);
    },

    /** Every poster, backdrop and logo TMDB has for the series' show, to choose its own from. */
    async artworkOptions(
      seriesId: string,
      language: string | undefined,
      signal?: AbortSignal,
    ): Promise<ArtworkOptionsDto> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      if (!series.tmdbId) {
        throw new AppError(
          "conflict",
          "Without a TMDB id the series' artwork can only be uploaded",
        );
      }
      if (!deps.episodeGuide) {
        throw new AppError("unavailable", "No TMDB key: set one in Settings to choose from TMDB");
      }
      const options = await deps.episodeGuide.artwork(series.tmdbId, language, signal);
      if (!options) {
        throw new AppError("not_found", `TMDB has no show with the id ${series.tmdbId}`);
      }
      return options;
    },

    /**
     * Gives a series artwork of its own: one of TMDB's (`url`, on TMDB's image host only) or an
     * uploaded image (`bytes`). It goes in its folder, where Jellyfin reads it, which is told.
     */
    async setArtwork(
      seriesId: string,
      kind: ArtworkKind,
      from: { url: string } | { bytes: Uint8Array },
      signal?: AbortSignal,
    ): Promise<SeriesDto> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      let image: FetchedImage;
      if ("url" in from) {
        try {
          image = await deps.images.fetch(from.url, {
            hosts: TMDB_IMAGE_HOSTS,
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new AppError("upstream", "Could not fetch that image from TMDB", { cause: error });
        }
      } else {
        if (from.bytes.length > MAX_ARTWORK_BYTES) {
          throw new AppError("bad_request", "That image is too large: 8 MB at most");
        }
        image = { bytes: from.bytes, extension: "" };
      }
      // By its bytes, whatever its address or upload said it was.
      const extension = sniffImage(image.bytes);
      if (!extension) throw new AppError("bad_request", "Only a JPEG, PNG or WebP image will do");
      if (!fitsKind(kind, extension)) {
        throw new AppError("bad_request", "A logo has to be a PNG or WebP, to stay transparent");
      }
      await withFolderLock(`series:${seriesId}`, async () => {
        // Read again under the lock: a rename may have moved its folder meanwhile.
        const current = (await deps.series.get(seriesId)) ?? series;
        await deps.library.writeArtwork(current, kind, { bytes: image.bytes, extension });
        // Which of TMDB's it is, so the panel marks it among TMDB's instead of listing it twice.
        const { [kind]: _old, ...others } = current.artworkFrom;
        const from_ = "url" in from ? new URL(from.url).pathname.split("/").at(-1) : undefined;
        await deps.series.update(seriesId, {
          [ARTWORK_FLAG[kind]]: true,
          artworkVersion: current.artworkVersion + 1,
          artworkFrom: from_ ? { ...others, [kind]: `/${from_}` } : others,
        });
      });
      deps.events.publish({ type: "series.updated", seriesId });
      await enqueueRefresh(seriesId, { replaceImages: true });
      return this.getSeries(seriesId);
    },

    /** Takes a series' own artwork of that kind away: TMDB's (or Jellyfin's) is used again. */
    async removeArtwork(seriesId: string, kind: ArtworkKind): Promise<SeriesDto> {
      const series = await deps.series.get(seriesId);
      if (!series) throw new AppError("not_found", "No such series");
      await withFolderLock(`series:${seriesId}`, async () => {
        const current = (await deps.series.get(seriesId)) ?? series;
        await deps.library.removeArtwork(current, kind);
        const { [kind]: _old, ...others } = current.artworkFrom;
        await deps.series.update(seriesId, {
          [ARTWORK_FLAG[kind]]: false,
          artworkVersion: current.artworkVersion + 1,
          artworkFrom: others,
        });
      });
      deps.events.publish({ type: "series.updated", seriesId });
      await enqueueRefresh(seriesId, { replaceImages: true });
      return this.getSeries(seriesId);
    },
  };
}

export type UseCases = ReturnType<typeof createUseCases>;

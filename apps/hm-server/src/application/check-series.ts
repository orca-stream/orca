import { ExtractorError, type Extraction } from "@orca/extractor-core";
import {
  episodeOffset,
  keepsSiteNumbers,
  SPECIALS_SEASON,
  type EpisodeAdjustment,
} from "@orca/hm-contract";
import { PermanentError, RetryableError } from "../domain/errors.ts";
import { uuidv7 } from "../domain/ids.ts";
import type { Episode, Series, SeriesSource } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createEnqueueDownloads } from "./downloads.ts";
import { closeFinishedSources, newEpisode, numberOf, placeOnDisk, sourceOf } from "./episodes.ts";

export interface CheckResult {
  /** Some source was read again (its marker moved, or its extractor has none). */
  changed: boolean;
  /** How many episodes were found that the series did not have. */
  added: number;
  newEpisodes: Episode[];
  /** New episodes left out because their season and number belong to another episode. */
  skipped: number;
  skippedRefs: string[];
}

const UNCHANGED: CheckResult = {
  changed: false,
  added: 0,
  newEpisodes: [],
  skipped: 0,
  skippedRefs: [],
};

/** A site that is down or confused is worth another try; a series that is gone is not. */
export function toJobError(error: unknown): unknown {
  if (!(error instanceof ExtractorError)) return error;
  if (error.code === "not-found" || error.code === "unsupported-url") {
    return new PermanentError(error.message, { cause: error });
  }
  return new RetryableError(error.message, {
    cause: error,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  });
}

/** What reading one source again found, before anything is stored. */
interface SourceRead {
  source: SeriesSource;
  extraction: Extraction;
  marker: string | undefined;
}

/**
 * The `check_series` job: for each open source of the series (the whole show, or one season or part
 * of one), asks the site for a cheap marker, and only when it moved reads that source again, stores what
 * is new and (for a followed series) queues the new episodes. Every source is read before anything is
 * stored, so a site that fails leaves the whole series as it was, to be checked again; each marker is
 * saved after the episodes, so a failure in between is simply read again.
 */
export function createCheckSeries(deps: Deps) {
  const enqueueDownloads = createEnqueueDownloads(deps);

  async function read(source: SeriesSource, signal?: AbortSignal): Promise<SourceRead | null> {
    const extractor = deps.extractors.get(source.extractorId);
    if (!extractor) {
      throw new PermanentError(`The “${source.extractorId}” extractor is no longer installed`);
    }
    const options = signal ? { signal } : undefined;
    try {
      let marker: string | undefined;
      if (extractor.remoteMarker) {
        marker = await extractor.remoteMarker(source.sourceUrl, options);
        if (source.remoteMarker !== null && marker === source.remoteMarker) return null;
      }
      return { source, extraction: await extractor.extract(source.sourceUrl, options), marker };
    } catch (error) {
      throw toJobError(error);
    }
  }

  /**
   * The seasons the site lists for a followed series after the last one its sources read, each added
   * as a source of its own with the site's season number: what a new season of a show on the air needs
   * to be found, whichever order the site uploads them in. With a TMDB key, only seasons TMDB has.
   * Returns the episodes stored, not queued yet.
   */
  async function addNewSeasons(series: Series, signal?: AbortSignal): Promise<Episode[]> {
    const options = signal ? { signal } : undefined;
    const sources = await deps.series.listSources([series.id]);
    const existing = await deps.series.listEpisodes(series.id);
    // Where a source reaches: its last episode's season, or the season it is set to.
    const reach = (source: SeriesSource) =>
      Math.max(
        source.season ?? -1,
        ...existing.filter((e) => e.sourceId === source.id).map((e) => e.season),
      );
    const [last] = sources
      .filter((source) => {
        const extractor = deps.extractors.get(source.extractorId);
        return extractor != null && "seasonSources" in extractor;
      })
      .sort((a, b) => reach(b) - reach(a));
    // A source that moves the site's numbers is a part of a season: what follows can't be guessed.
    if (
      !last ||
      !keepsSiteNumbers({
        season: last.season,
        offset: last.episodeOffset,
        adjustments: last.adjustments,
      })
    ) {
      return [];
    }
    const extractor = deps.extractors.get(last.extractorId)!;
    let listed;
    try {
      listed = await extractor.seasonSources!(last.sourceUrl, options);
    } catch (error) {
      throw toJobError(error);
    }
    const at = listed.find((entry) => entry.url === last.sourceUrl);
    // Only where the site numbers seasons as the series does: one whose seasons 1–3 are TMDB's 1
    // says nothing of where its 4 goes.
    if (!at || (last.season !== null && last.season !== at.season)) return [];
    const tmdbSeasons =
      deps.episodeGuide && series.tmdbId
        ? await deps.episodeGuide
            .seasons(series.tmdbId, undefined, signal)
            .then((seasons) => (seasons ? new Set(seasons.map((season) => season.number)) : null))
            .catch(() => null)
        : null;
    const addresses = new Set(sources.map((source) => source.sourceUrl));
    const taken = new Set(existing.map((episode) => `${episode.season}:${episode.episode}`));
    const episodes = [...existing];
    const added: Episode[] = [];
    for (const entry of listed) {
      if (entry.season <= at.season || addresses.has(entry.url)) continue;
      if (tmdbSeasons && !tmdbSeasons.has(entry.season)) continue;
      let extraction: Extraction;
      try {
        extraction = await extractor.extract(entry.url, options);
      } catch (error) {
        throw toJobError(error);
      }
      if (await deps.series.findSourceByExternal(extractor.id, extraction.series.externalId)) {
        continue;
      }
      const now = deps.clock.now();
      // A site's episode 0 is an extra TMDB keeps among the specials (a recap, a prologue): it takes
      // the next free special number and isn't added, so episode 1 stays 1.
      const adjustments = leadingExtras(extraction.episodes, taken);
      const source: SeriesSource = {
        id: uuidv7(now),
        seriesId: series.id,
        extractorId: extractor.id,
        externalId: extraction.series.externalId,
        sourceUrl: extraction.series.sourceUrl,
        season: last.season === null ? null : entry.season,
        episodeOffset: episodeOffset(null, extraction.episodes, adjustments),
        adjustments,
        remoteMarker: extraction.series.remoteMarker ?? null,
        knownRefs: [],
        closed: false,
        createdAt: now,
      };
      const fresh: Episode[] = [];
      const extras = new Set(
        extraction.episodes
          .filter((found) => numberOf(source, found).season === SPECIALS_SEASON)
          .map((found) => found.sourceRef),
      );
      for (const found of extraction.episodes) {
        if (extras.has(found.sourceRef)) continue;
        const { season, episode } = numberOf(source, found);
        if (taken.has(`${season}:${episode}`)) continue;
        taken.add(`${season}:${episode}`);
        fresh.push(newEpisode(source, found, now));
      }
      // As a check leaves them: one whose number is taken is not known, so it comes once it is free.
      // The extras left out are known too, so a check doesn't add them later.
      const kept = new Set([...fresh.map((episode) => episode.sourceRef), ...extras]);
      source.knownRefs = extraction.episodes
        .map((found) => found.sourceRef)
        .filter((ref) => kept.has(ref));
      const placed = await placeOnDisk(deps.library, series, fresh);
      await deps.series.addSource(source, placed);
      await closeFinishedSources(deps.series, series.id, source.id, placed, episodes);
      addresses.add(source.sourceUrl);
      episodes.push(...placed);
      added.push(...placed);
    }
    return added;
  }

  async function checkSources(seriesId: string, signal?: AbortSignal): Promise<CheckResult> {
    const series = await deps.series.get(seriesId);
    if (!series) return UNCHANGED;

    const reads: SourceRead[] = [];
    for (const source of await deps.series.listSources([series.id])) {
      // A closed source was marked as bringing nothing new: reading it would only cost requests.
      if (source.closed) continue;
      const found = await read(source, signal);
      if (found) reads.push(found);
    }
    if (reads.length === 0) {
      await deps.series.update(series.id, { lastCheckedAt: deps.clock.now() });
      return UNCHANGED;
    }

    const now = deps.clock.now();
    const existing = await deps.series.listEpisodes(series.id);
    const byRef = new Map(existing.map((episode) => [episode.sourceRef, episode]));
    const taken = new Set(existing.map((episode) => `${episode.season}:${episode.episode}`));

    const update: Episode[] = [];
    let add: Episode[] = [];
    const skippedRefs: string[] = [];
    let learned = 0;
    const sourcePatches: { id: string; remoteMarker: string | null; knownRefs: string[] }[] = [];

    for (const { source, extraction, marker } of reads) {
      // A source from before `known_refs` has no list: what the site shows now is all "known", so
      // the first check learns it instead of adding every episode that was once declined.
      const learning = source.knownRefs === null;
      const known = new Set([...(source.knownRefs ?? []), ...byRef.keys()]);
      const skippedHere: string[] = [];
      for (const found of extraction.episodes) {
        const current = byRef.get(found.sourceRef);
        if (current) {
          update.push({
            ...current,
            title: found.title,
            plot: found.plot ?? null,
            airDate: found.airDate ?? null,
            inferred: found.inferred,
            source: sourceOf(found),
            durationSec: found.media.durationSec ?? null,
            sizeBytes: found.media.sizeBytes ?? null,
            format: found.media.format ?? null,
          });
        } else if (!learning && !known.has(found.sourceRef)) {
          const { season, episode } = numberOf(source, found);
          const number = `${season}:${episode}`;
          if (taken.has(number)) {
            skippedHere.push(found.sourceRef);
            continue;
          }
          taken.add(number);
          const added = newEpisode(source, found, now);
          add.push(added);
          byRef.set(added.sourceRef, added);
        }
      }
      if (learning) {
        learned += extraction.episodes.filter((found) => !known.has(found.sourceRef)).length;
      }
      skippedRefs.push(...skippedHere);
      sourcePatches.push({
        id: source.id,
        remoteMarker: extraction.series.remoteMarker ?? marker ?? null,
        // A skipped episode is not known yet: it is added by a later check once its number is free.
        knownRefs: [
          ...new Set([
            ...(source.knownRefs ?? []),
            ...extraction.episodes.map((found) => found.sourceRef),
          ]),
        ].filter((ref) => !skippedHere.includes(ref)),
      });
    }
    const skipped = skippedRefs.length;

    // What is already on disk comes in as available, and isn't downloaded or announced.
    add = await placeOnDisk(deps.library, series, add);
    await deps.series.upsertEpisodes(series.id, { update, add });
    // Only now: had the upsert failed, the stale markers make the next check read the sources again.
    for (const { id, ...patch } of sourcePatches) await deps.series.updateSource(id, patch);
    await deps.series.update(series.id, { lastCheckedAt: now });

    const missing = add.filter((episode) => episode.status !== "available");
    if (missing.length > 0 && series.follow) {
      await enqueueDownloads(missing.map((episode) => episode.id));
    }
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    const about = { id: series.id, title: series.title };
    if (missing.length > 0) {
      // The episodes are stored: a notification that cannot be made must not turn this into a retry.
      await deps.notifications
        .newEpisodes(about, missing)
        .catch((error: unknown) => console.error("notification failed:", error));
    }
    if (learned > 0) {
      await deps.notifications
        .episodesLearned(about, learned)
        .catch((error: unknown) => console.error("notification failed:", error));
    }
    if (skipped > 0) {
      await deps.notifications
        .episodesSkipped(about, skipped)
        .catch((error: unknown) => console.error("notification failed:", error));
    }
    return { changed: true, added: add.length, newEpisodes: add, skipped, skippedRefs };
  }

  return async function checkSeries(seriesId: string, signal?: AbortSignal): Promise<CheckResult> {
    const result = await checkSources(seriesId, signal);
    const series = await deps.series.get(seriesId);
    if (!series?.follow) return result;
    const added = await addNewSeasons(series, signal);
    if (added.length === 0) return result;
    const missing = added.filter((episode) => episode.status !== "available");
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    if (missing.length > 0) {
      await enqueueDownloads(missing.map((episode) => episode.id));
      await deps.notifications
        .newEpisodes({ id: series.id, title: series.title }, missing)
        .catch((error: unknown) => console.error("notification failed:", error));
    }
    return {
      ...result,
      changed: true,
      added: result.added + added.length,
      newEpisodes: [...result.newEpisodes, ...added],
    };
  };
}

/**
 * The episodes 0 of a season the site numbers on from 1, as specials with the next free numbers of
 * season 0 (`taken` holds `season:episode`, and is not changed).
 */
export function leadingExtras(
  episodes: readonly { season: number; episode: number }[],
  taken: ReadonlySet<string>,
): EpisodeAdjustment[] {
  const used = new Set(
    [...taken]
      .filter((key) => key.startsWith(`${SPECIALS_SEASON}:`))
      .map((key) => Number(key.split(":")[1])),
  );
  const adjustments: EpisodeAdjustment[] = [];
  for (const found of episodes) {
    if (found.episode !== 0) continue;
    if (!episodes.some((other) => other.season === found.season && other.episode > 0)) continue;
    let number = 1;
    while (used.has(number)) number++;
    used.add(number);
    adjustments.push({ season: found.season, episode: 0, kind: "special", number });
  }
  return adjustments;
}

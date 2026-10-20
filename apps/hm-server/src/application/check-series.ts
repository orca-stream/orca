import { ExtractorError, type Extraction } from "@orca/extractor-core";
import { PermanentError, RetryableError } from "../domain/errors.ts";
import type { Episode, SeriesSource } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createEnqueueDownloads } from "./downloads.ts";
import { newEpisode, numberOf, sourceOf } from "./episodes.ts";

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
 * The `check_series` job: for each source of the series (the whole show, or one season or part of
 * one), asks the site for a cheap marker, and only when it moved reads that source again, stores what
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

  return async function checkSeries(seriesId: string, signal?: AbortSignal): Promise<CheckResult> {
    const series = await deps.series.get(seriesId);
    if (!series) return UNCHANGED;

    const reads: SourceRead[] = [];
    for (const source of await deps.series.listSources([series.id])) {
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
    const add: Episode[] = [];
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

    await deps.series.upsertEpisodes(series.id, { update, add });
    // Only now: had the upsert failed, the stale markers make the next check read the sources again.
    for (const { id, ...patch } of sourcePatches) await deps.series.updateSource(id, patch);
    await deps.series.update(series.id, { lastCheckedAt: now });

    if (add.length > 0 && series.follow) {
      await enqueueDownloads(add.map((episode) => episode.id));
    }
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    const about = { id: series.id, title: series.title };
    if (add.length > 0) {
      // The episodes are stored: a notification that cannot be made must not turn this into a retry.
      await deps.notifications
        .newEpisodes(about, add)
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
  };
}

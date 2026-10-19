import { ExtractorError, type Extraction } from "@orca/extractor-core";
import { PermanentError, RetryableError } from "../domain/errors.ts";
import type { Episode } from "../domain/series.ts";
import type { Deps } from "./deps.ts";
import { createEnqueueDownloads } from "./downloads.ts";
import { newEpisode, sourceOf } from "./episodes.ts";

export interface CheckResult {
  /** The series was read again (the marker moved, or the extractor has none). */
  changed: boolean;
  /** How many episodes were found that the series did not have. */
  added: number;
  newEpisodes: Episode[];
  /** New episodes left out because their season and number belong to another episode. */
  skipped: number;
}

const UNCHANGED: CheckResult = { changed: false, added: 0, newEpisodes: [], skipped: 0 };

/** A site that is down or confused is worth another try; a series that is gone is not. */
function toJobError(error: unknown): unknown {
  if (!(error instanceof ExtractorError)) return error;
  if (error.code === "not-found" || error.code === "unsupported-url") {
    return new PermanentError(error.message, { cause: error });
  }
  return new RetryableError(error.message, {
    cause: error,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  });
}

/**
 * The `check_series` job: asks the site for a cheap marker, and only when it moved reads the series
 * again, stores what is new and (for a followed series) queues the new episodes. The marker is saved
 * after the episodes, so a failure in between is simply checked again.
 */
export function createCheckSeries(deps: Deps) {
  const enqueueDownloads = createEnqueueDownloads(deps);

  return async function checkSeries(seriesId: string, signal?: AbortSignal): Promise<CheckResult> {
    const series = await deps.series.get(seriesId);
    if (!series) return UNCHANGED;
    const extractor = deps.extractors
      .list()
      .find((candidate) => candidate.id === series.extractorId);
    if (!extractor) {
      throw new PermanentError(`The “${series.extractorId}” extractor is no longer installed`);
    }
    const options = signal ? { signal } : undefined;

    let marker: string | undefined;
    let extraction: Extraction;
    try {
      if (extractor.remoteMarker) {
        marker = await extractor.remoteMarker(series.sourceUrl, options);
        if (series.remoteMarker !== null && marker === series.remoteMarker) {
          await deps.series.update(series.id, { lastCheckedAt: deps.clock.now() });
          return UNCHANGED;
        }
      }
      extraction = await extractor.extract(series.sourceUrl, options);
    } catch (error) {
      throw toJobError(error);
    }

    const now = deps.clock.now();
    const existing = await deps.series.listEpisodes(series.id);
    const byRef = new Map(existing.map((episode) => [episode.sourceRef, episode]));
    const known = new Set([...series.knownRefs, ...byRef.keys()]);
    const taken = new Set(existing.map((episode) => `${episode.season}:${episode.episode}`));

    const update: Episode[] = [];
    const add: Episode[] = [];
    let skipped = 0;
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
      } else if (!known.has(found.sourceRef)) {
        const number = `${found.season}:${found.episode}`;
        if (taken.has(number)) {
          skipped++;
          continue;
        }
        taken.add(number);
        add.push(newEpisode(series.id, found, now));
      }
    }

    await deps.series.upsertEpisodes(series.id, { update, add });
    // Only now: had the upsert failed, the stale marker makes the next check read the series again.
    await deps.series.update(series.id, {
      remoteMarker: extraction.series.remoteMarker ?? marker ?? null,
      lastCheckedAt: now,
      knownRefs: [...known, ...extraction.episodes.map((found) => found.sourceRef)].filter(
        (ref, index, all) => all.indexOf(ref) === index,
      ),
    });

    if (add.length > 0 && series.follow) {
      await enqueueDownloads(add.map((episode) => episode.id));
    }
    deps.events.publish({ type: "series.updated", seriesId: series.id });
    if (add.length > 0) {
      // The episodes are stored: a notification that cannot be made must not turn this into a retry.
      await deps.notifications
        .newEpisodes({ id: series.id, title: series.title }, add)
        .catch((error: unknown) => console.error("notification failed:", error));
    }
    return { changed: true, added: add.length, newEpisodes: add, skipped };
  };
}

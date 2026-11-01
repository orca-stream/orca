import type { Extraction } from "@orca/extractor-core";
import { mapEpisode } from "@orca/hm-contract";
import { uuidv7 } from "../domain/ids.ts";
import type { Episode, SeriesSource, Source } from "../domain/series.ts";
import type { SeriesRepository } from "./ports.ts";

export type ExtractedEpisode = Extraction["episodes"][number];

export function sourceOf(episode: ExtractedEpisode): Source {
  const { media } = episode;
  if (media.kind === "page") return { kind: "page", url: media.url };
  if (media.kind === "mirrors") return { kind: "mirrors", url: media.url };
  return {
    kind: "direct",
    url: media.url,
    fileName: media.fileName,
    ...(media.sizeBytes !== undefined ? { sizeBytes: media.sizeBytes } : {}),
    ...(media.md5 ? { md5: media.md5 } : {}),
    ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
  };
}

/**
 * Where a source puts an episode the site found: its season, and its number moved by the offset and
 * by the episodes numbered by hand before it (a special goes to season 0).
 */
export function numberOf(
  source: Pick<SeriesSource, "season" | "episodeOffset" | "adjustments">,
  extracted: Pick<ExtractedEpisode, "season" | "episode">,
): { season: number; episode: number } {
  return mapEpisode(extracted, {
    season: source.season,
    offset: source.episodeOffset,
    adjustments: source.adjustments,
  });
}

/** A new, not yet downloaded episode row for something an extractor found on a source. */
export function newEpisode(
  source: Pick<SeriesSource, "id" | "seriesId" | "season" | "episodeOffset" | "adjustments">,
  extracted: ExtractedEpisode,
  now: number,
): Episode {
  const { season, episode } = numberOf(source, extracted);
  return {
    id: uuidv7(now),
    seriesId: source.seriesId,
    sourceId: source.id,
    season,
    episode,
    title: extracted.title,
    plot: extracted.plot ?? null,
    airDate: extracted.airDate ?? null,
    inferred: extracted.inferred,
    sourceRef: extracted.sourceRef,
    source: sourceOf(extracted),
    durationSec: extracted.media.durationSec ?? null,
    sizeBytes: extracted.media.sizeBytes ?? null,
    format: extracted.media.format ?? null,
    status: "missing",
    filePath: null,
    createdAt: now,
  };
}

/** Which of two episodes comes first in the series: by season, then by number. */
export function comparePlace(
  a: { season: number; episode: number },
  b: { season: number; episode: number },
): number {
  return a.season - b.season || a.episode - b.episode;
}

/**
 * A source that starts after everything another one lists means that one is finished — a new
 * season, or the next part of the same season the site lists under another address. Its source
 * would bring nothing new, so it is closed as the user would by hand. One that reaches as far as
 * the new one starts stays open. `existing` are the series' episodes before `added`.
 */
export async function closeFinishedSources(
  series: SeriesRepository,
  seriesId: string,
  sourceId: string,
  added: readonly Episode[],
  existing: readonly Episode[],
): Promise<void> {
  if (added.length === 0) return;
  const from = added.reduce((first, episode) =>
    comparePlace(episode, first) < 0 ? episode : first,
  );
  const lastOf = new Map<string, Episode>();
  for (const episode of existing) {
    if (!episode.sourceId) continue;
    const last = lastOf.get(episode.sourceId);
    if (!last || comparePlace(episode, last) > 0) lastOf.set(episode.sourceId, episode);
  }
  for (const other of await series.listSources([seriesId])) {
    if (other.id === sourceId || other.closed) continue;
    const last = lastOf.get(other.id);
    // With no episodes of its own, only its season tells: an earlier one is finished.
    const finished = last
      ? comparePlace(last, from) < 0
      : other.season !== null && other.season < from.season;
    if (finished) await series.updateSource(other.id, { closed: true });
  }
}

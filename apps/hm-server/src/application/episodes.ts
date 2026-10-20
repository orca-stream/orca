import type { Extraction } from "@orca/extractor-core";
import { mapEpisode } from "@orca/hm-contract";
import { uuidv7 } from "../domain/ids.ts";
import type { Episode, SeriesSource, Source } from "../domain/series.ts";

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

/** Where a source puts an episode the site found: its season, and its number moved by the offset. */
export function numberOf(
  source: Pick<SeriesSource, "season" | "episodeOffset">,
  extracted: Pick<ExtractedEpisode, "season" | "episode">,
): { season: number; episode: number } {
  return mapEpisode(extracted, { season: source.season, offset: source.episodeOffset });
}

/** A new, not yet downloaded episode row for something an extractor found on a source. */
export function newEpisode(
  source: Pick<SeriesSource, "id" | "seriesId" | "season" | "episodeOffset">,
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

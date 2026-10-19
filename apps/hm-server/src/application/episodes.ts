import type { Extraction } from "@orca/extractor-core";
import { uuidv7 } from "../domain/ids.ts";
import type { Episode, Source } from "../domain/series.ts";

export type ExtractedEpisode = Extraction["episodes"][number];

export function sourceOf(episode: ExtractedEpisode): Source {
  const { media } = episode;
  if (media.kind === "page") return { kind: "page", url: media.url };
  return {
    kind: "direct",
    url: media.url,
    fileName: media.fileName,
    ...(media.sizeBytes !== undefined ? { sizeBytes: media.sizeBytes } : {}),
    ...(media.md5 ? { md5: media.md5 } : {}),
    ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
  };
}

/** A new, not yet downloaded episode row for something an extractor found. */
export function newEpisode(seriesId: string, extracted: ExtractedEpisode, now: number): Episode {
  return {
    id: uuidv7(now),
    seriesId,
    season: extracted.season,
    episode: extracted.episode,
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

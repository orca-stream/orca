import type { EpisodeAdjustment, EpisodeStatus } from "@orca/hm-contract";

/** Where the bytes of an episode come from. `page` needs the StreamDetector to find a stream first. */
export type Source =
  | {
      kind: "direct";
      url: string;
      fileName: string;
      sizeBytes?: number;
      md5?: string;
      durationSec?: number;
      /** Request headers a browser used for it (Referer, Cookie…), when it came from a page. */
      headers?: Record<string, string>;
    }
  | { kind: "hls"; url: string; headers?: Record<string, string>; durationSec?: number }
  | { kind: "page"; url: string }
  /** An episode page listing several players of the same video; its extractor reads them. */
  | { kind: "mirrors"; url: string };

export interface Series {
  id: string;
  title: string;
  year: number | null;
  plot: string | null;
  /** Ids Jellyfin looks the show up by; with one, Jellyfin fetches the metadata and the images. */
  tmdbId: string | null;
  imdbId: string | null;
  /** Folder under MEDIA_ROOT, e.g. `The Beverly Hillbillies (1962)`. */
  folderName: string;
  hasPoster: boolean;
  follow: boolean;
  /** Its downloads wait in the queue until it is resumed; new episodes are still looked for. */
  paused: boolean;
  checkIntervalHours: number;
  lastCheckedAt: number | null;
  /** The series' own track choices; null follows the server's defaults. Languages are ISO 639-2. */
  maxHeight: number | null;
  audioLangs: string[] | null;
  subtitleLangs: string[] | null;
  /**
   * The source each season takes new episodes from, by season number: while it is open, what other
   * sources list for that season is left to it.
   */
  preferredSources: Record<string, string>;
  createdAt: number;
}

/**
 * One address a series is read from: the whole show, one season, or one part of a season. A series
 * has one or more, each read (and checked) on its own.
 */
export interface SeriesSource {
  id: string;
  seriesId: string;
  extractorId: string;
  externalId: string;
  sourceUrl: string;
  /** The season its episodes go to; null keeps the site's. */
  season: number | null;
  /** Added to the site's episode numbers. */
  episodeOffset: number;
  /** Its episodes numbered by hand, by the site's season and number (see `mapEpisode`). */
  adjustments: EpisodeAdjustment[];
  remoteMarker: string | null;
  /**
   * Every episode key the site listed when the address was last read, chosen or not. A check adds only
   * keys outside this list (plus the series' own episodes), so an episode the user left out stays out.
   * Null is a source from before the column existed: its first check only learns what is listed.
   */
  knownRefs: string[] | null;
  /** A source that will bring nothing new (a finished season): checks no longer read it. */
  closed: boolean;
  createdAt: number;
}

export interface Episode {
  id: string;
  seriesId: string;
  /** The address it was found on; null only if that source was removed. */
  sourceId: string | null;
  season: number;
  episode: number;
  title: string;
  plot: string | null;
  airDate: string | null;
  inferred: boolean;
  /** Stable id inside the series; what a re-check matches episodes by. */
  sourceRef: string;
  source: Source;
  durationSec: number | null;
  sizeBytes: number | null;
  format: string | null;
  status: EpisodeStatus;
  /** Path of the file under MEDIA_ROOT once it is in the library. */
  filePath: string | null;
  /**
   * The source its file came from, when that is not the one it takes its video from now (its source
   * was changed after it was downloaded); null when the file is its own source's, or there is none.
   * Such a file stays available, and downloading again replaces it once the new one is complete.
   */
  fileSourceId: string | null;
  createdAt: number;
}

/** `S01E02`. */
export function episodeCode(season: number, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `S${pad(season)}E${pad(episode)}`;
}

/** Its file is from another source than the one it takes its video from now. */
export function fileOutdated(episode: Pick<Episode, "filePath" | "fileSourceId">): boolean {
  return episode.filePath !== null && episode.fileSourceId !== null;
}

import type { HmEvent } from "./events.ts";

/**
 * The contract's runtime rules that need no schema library. The panel imports its runtime code from
 * here (`@orca/hm-contract/rules`) and only types from the main entry, so Zod stays out of its bundle.
 * Keep this file free of imports other than types.
 */

/** Titles become folder names; this keeps them well under file-name limits. */
export const MAX_TITLE_LENGTH = 150;

/** Smallest and tallest video a height limit can name (144p to 8K). */
export const MIN_MAX_HEIGHT = 144;
export const MAX_MAX_HEIGHT = 4320;

/** The settings' limits, kept by the schema and offered by the panel's fields. */
export const SETTING_LIMITS = {
  /** Downloads, ffmpeg processes and player pages at once; downloads at once per host. */
  jobs: 32,
  /** Connections one file is fetched over. */
  connections: 16,
  metadataPerSec: 100,
  /** Pages the browser has open at once. */
  pages: 8,
  skipPlayers: 50,
  /** Languages one track list can name. */
  languages: 10,
  /** ffprobe's least time to read a stream, in seconds. */
  minProbeSec: 1,
} as const;

/** The shortest password the local administrator can have. */
export const MIN_PASSWORD_LENGTH = 8;

/** An ISO 639-2 language code: three lower-case letters (`eng`, `spa`, `jpn`). */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{3}$/;

/** A TMDB id is a number; an IMDb id is `tt` and digits. Jellyfin reads both from tvshow.nfo. */
export const TMDB_ID_PATTERN = /^\d{1,10}$/;
export const IMDB_ID_PATTERN = /^tt\d{5,10}$/;

/**
 * One episode of an address numbered by hand, by the site's own season and number, where a single
 * offset can't place it: an extra the site counts that TMDB doesn't (a recap, an episode 0), or one
 * from which the numbers move.
 */
export type EpisodeAdjustment =
  /** Goes to the specials (season 0) as this number, and doesn't count: those after it move up. */
  | { season: number; episode: number; kind: "special"; number: number }
  /** Takes this number, and those after it in its season carry on from it. */
  | { season: number; episode: number; kind: "renumber"; number: number };

/** Where the episodes of one address go: a season, and how far their numbers move. */
export interface EpisodeMapping {
  /** Null keeps the season the site gives. */
  season: number | null;
  /** Added to the site's episode number. */
  offset: number;
  /** The episodes numbered by hand, applied after the offset; none when left out. */
  adjustments?: readonly EpisodeAdjustment[];
}

/** The season specials go to, as TMDB and Jellyfin keep them. */
export const SPECIALS_SEASON = 0;

const adjustmentOf = (
  adjustments: readonly EpisodeAdjustment[],
  found: { season: number; episode: number },
) => adjustments.find((a) => a.season === found.season && a.episode === found.episode);

/**
 * The offset that makes the lowest episode of an address that counts (not a special) become
 * `firstEpisode`, whether the site numbers the part from 1 or carries on from the part before. Null
 * keeps the site's numbers for it — so an episode 0 sent to the specials leaves 1 as 1.
 */
export function episodeOffset(
  firstEpisode: number | null,
  siteEpisodes: readonly { season: number; episode: number }[],
  adjustments: readonly EpisodeAdjustment[] = [],
): number {
  const counted = siteEpisodes.filter(
    (found) => adjustmentOf(adjustments, found)?.kind !== "special",
  );
  if (counted.length === 0) return 0;
  const lowest = counted.reduce((low, found) => (found.episode < low.episode ? found : low));
  // Where it lands with no offset: the specials before it already moved it.
  const unmoved = mapEpisode(lowest, { season: null, offset: 0, adjustments }).episode;
  return (firstEpisode ?? lowest.episode) - unmoved;
}

/**
 * The season and number an episode the site calls `found` ends up with in the library: the offset,
 * then the adjustments of its site season before it in order — a special takes no number, a
 * renumbered one sets where the count goes on.
 */
export function mapEpisode(
  found: { season: number; episode: number },
  mapping: EpisodeMapping,
): { season: number; episode: number } {
  const adjustments = mapping.adjustments ?? [];
  const season = mapping.season ?? found.season;
  const own = adjustmentOf(adjustments, found);
  if (own?.kind === "special") return { season: SPECIALS_SEASON, episode: own.number };
  if (own?.kind === "renumber") return { season, episode: own.number };
  let shift = mapping.offset;
  const before = adjustments
    .filter((a) => a.season === found.season && a.episode < found.episode)
    .sort((a, b) => a.episode - b.episode);
  for (const adjustment of before) {
    shift = adjustment.kind === "special" ? shift - 1 : adjustment.number - adjustment.episode;
  }
  return { season, episode: found.episode + shift };
}

/**
 * Whether an address starts its season where the site does: nothing renumbered, and no offset beyond
 * what its episodes 0 sent to the specials take back. A part of a season doesn't.
 */
export function keepsSiteNumbers(mapping: EpisodeMapping): boolean {
  const adjustments = mapping.adjustments ?? [];
  if (adjustments.some((a) => a.kind === "renumber")) return false;
  const leading = adjustments.filter((a) => a.kind === "special" && a.episode === 0).length;
  return mapping.offset === leading;
}

/** Every `type` the event stream sends; each is also the SSE event name. */
export const HM_EVENT_TYPES = [
  "job.updated",
  "job.progress",
  "series.updated",
  "notification.created",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || typeof value === "number";

/**
 * A cheap structural check of one event from the stream, standing in for the `HmEvent` schema where
 * Zod isn't available. It checks the fields the panel reads; the server is the source of the rest.
 */
export function isHmEvent(value: unknown): value is HmEvent {
  if (!isRecord(value) || !Number.isInteger(value.seq)) return false;
  switch (value.type) {
    case "job.updated":
      return (
        isRecord(value.job) &&
        isString(value.job.id) &&
        isString(value.job.status) &&
        isNumberOrNull(value.job.progress)
      );
    case "job.progress":
      return isString(value.jobId) && isNumberOrNull(value.progress);
    case "series.updated":
      return isString(value.seriesId);
    case "notification.created":
      return (
        isRecord(value.notification) &&
        isString(value.notification.id) &&
        isString(value.notification.kind) &&
        isString(value.notification.title)
      );
    default:
      return false;
  }
}

import type {
  CreateSeriesBody,
  EpisodeAdjustment,
  EpisodeDto,
  ExtractorDto,
  PreviewDto,
  PreviewWarning,
} from "@orca/hm-contract";
import {
  episodeOffset,
  IMDB_ID_PATTERN,
  mapEpisode,
  SPECIALS_SEASON,
  TMDB_ID_PATTERN,
} from "@orca/hm-contract/rules";

/** What the person edits in the preview before adding the series. Numbers stay text while typed. */
export interface PreviewForm {
  /**
   * "" makes a new series; a series id adds the address to that series (another season, or a part);
   * `jellyfin:<id>` (see `jellyfinTarget`) adds it to a show Jellyfin has and this server doesn't.
   */
  addTo: string;
  title: string;
  year: string;
  /** Let Jellyfin fetch the metadata and the images itself. */
  tmdbId: string;
  imdbId: string;
  /** The season the episodes go to; "" keeps the site's. */
  season: string;
  /** The number the lowest episode of this address gets in that season; "" keeps the site's. */
  firstEpisode: string;
  /** Episodes numbered by hand, by the site's season and number. */
  adjustments: EpisodeAdjustment[];
  /** Keys of the episodes to add. */
  included: string[];
  follow: boolean;
  downloadNow: boolean;
}

const JELLYFIN_TARGET = "jellyfin:";

/** The `addTo` of a show Jellyfin has and this server doesn't. */
export const jellyfinTarget = (showId: string) => `${JELLYFIN_TARGET}${showId}`;

/** The Jellyfin show an `addTo` names, or null when it names none. */
export const jellyfinShowOf = (addTo: string): string | null =>
  addTo.startsWith(JELLYFIN_TARGET) ? addTo.slice(JELLYFIN_TARGET.length) : null;

/**
 * The episodes 0 of a site season numbered on from 1: an extra TMDB keeps among the specials (a
 * recap, a prologue), so they start there — numbered 1 on, and left out until someone picks them.
 */
function leadingExtras(preview: PreviewDto): EpisodeAdjustment[] {
  return preview.episodes
    .filter(
      (found) =>
        found.episode === 0 &&
        preview.episodes.some((other) => other.season === found.season && other.episode > 0),
    )
    .map((found, index) => ({
      season: found.season,
      episode: 0,
      kind: "special",
      number: index + 1,
    }));
}

export function initialForm(preview: PreviewDto): PreviewForm {
  const only = preview.selectedKey;
  const adjustments = leadingExtras(preview);
  const extras = new Set(
    preview.episodes
      .filter((found) =>
        adjustments.some((a) => a.season === found.season && a.episode === found.episode),
      )
      .map((found) => found.key),
  );
  return {
    addTo: "",
    // Empty on purpose: the TMDB id fills it in with the show's real name, never the site's.
    title: "",
    year: preview.series.year === null ? "" : String(preview.series.year),
    tmdbId: "",
    imdbId: "",
    season: "",
    firstEpisode: "",
    adjustments,
    included: only
      ? [only]
      : preview.episodes.map((episode) => episode.key).filter((key) => !extras.has(key)),
    follow: false,
    downloadNow: false,
  };
}

const MIN_YEAR = 1800;
const MAX_YEAR = 2200;
const MAX_SEASON = 999;
const MAX_EPISODE = 9999;

/** A four-digit year, null for none, or "invalid" for anything else. */
export function parseYear(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}$/.test(trimmed)) return "invalid";
  const year = Number(trimmed);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : "invalid";
}

/** A whole number from 0 to `max`, null for none, or "invalid". */
export function parseCount(text: string, max: number): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,4}$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value <= max ? value : "invalid";
}

/** The id typed, trimmed; null for none. Whether it is a valid one is `isInvalidId`'s to say. */
const parseId = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};
const isInvalidId = (text: string, pattern: RegExp): boolean => {
  const id = parseId(text);
  return id !== null && !pattern.test(id);
};

export const parseSeason = (text: string) => parseCount(text, MAX_SEASON);
export const parseFirstEpisode = (text: string) => parseCount(text, MAX_EPISODE);
export const parseTmdbId = parseId;
export const parseImdbId = parseId;
export const isInvalidTmdbId = (text: string) => isInvalidId(text, TMDB_ID_PATTERN);
export const isInvalidImdbId = (text: string) => isInvalidId(text, IMDB_ID_PATTERN);

/** What a field says is wrong with it, by name; empty when the form can be sent. */
export function invalidFields(
  form: PreviewForm,
): Set<"year" | "season" | "firstEpisode" | "tmdbId" | "imdbId"> {
  const invalid = new Set<"year" | "season" | "firstEpisode" | "tmdbId" | "imdbId">();
  if (parseSeason(form.season) === "invalid") invalid.add("season");
  if (parseFirstEpisode(form.firstEpisode) === "invalid") invalid.add("firstEpisode");
  // A series that exists keeps its own title, year and ids.
  if (form.addTo === "") {
    if (parseYear(form.year) === "invalid") invalid.add("year");
    if (isInvalidTmdbId(form.tmdbId)) invalid.add("tmdbId");
    if (isInvalidImdbId(form.imdbId)) invalid.add("imdbId");
  }
  return invalid;
}

export function canConfirm(form: PreviewForm, clashes: readonly string[] = []): boolean {
  if (form.addTo === "" && form.title.trim() === "") return false;
  if (form.included.length === 0) return false;
  if (clashes.length > 0) return false;
  return invalidFields(form).size === 0;
}

const valueOr = <T>(value: T | "invalid"): T | null => (value === "invalid" ? null : value);

/**
 * Where an episode of the preview ends up with the form's season, first episode and adjustments,
 * exactly as the server will number it (the offset is measured on every episode the address lists).
 */
export function numberer(
  preview: PreviewDto,
  form: PreviewForm,
): (episode: { season: number; episode: number }) => { season: number; episode: number } {
  const mapping = {
    season: valueOr(parseSeason(form.season)),
    offset: episodeOffset(
      valueOr(parseFirstEpisode(form.firstEpisode)),
      preview.episodes,
      form.adjustments,
    ),
    adjustments: form.adjustments,
  };
  return (episode) => mapEpisode(episode, mapping);
}

/** How the site's episode is numbered by hand, or null when it simply counts. */
export function adjustmentOf(
  form: PreviewForm,
  found: { season: number; episode: number },
): EpisodeAdjustment | null {
  return (
    form.adjustments.find((a) => a.season === found.season && a.episode === found.episode) ?? null
  );
}

/** Numbers the site's episode by hand, or lets it count again with null. */
export function setAdjustment(
  form: PreviewForm,
  found: { season: number; episode: number },
  next: Pick<EpisodeAdjustment, "kind" | "number"> | null,
): PreviewForm {
  const rest = form.adjustments.filter(
    (a) => a.season !== found.season || a.episode !== found.episode,
  );
  return {
    ...form,
    adjustments: next ? [...rest, { season: found.season, episode: found.episode, ...next }] : rest,
  };
}

/** The first special number neither the series (`taken` codes) nor another of the form's has. */
export function nextSpecial(form: PreviewForm, taken: ReadonlySet<string>): number {
  const used = new Set(form.adjustments.filter((a) => a.kind === "special").map((a) => a.number));
  let number = 1;
  while (used.has(number) || taken.has(episodeCode(SPECIALS_SEASON, number))) number++;
  return number;
}

/**
 * The episode after the last one the series has in a season, or null when it has none there — or
 * when the season, `length` episodes long, has nothing after it: a full season isn't continued.
 */
export function nextEpisode(
  existing: readonly Pick<EpisodeDto, "season" | "episode">[],
  season: number,
  length?: number,
): number | null {
  const numbers = existing.filter((episode) => episode.season === season).map((e) => e.episode);
  if (numbers.length === 0) return null;
  const next = Math.max(...numbers) + 1;
  return length !== undefined && next > length ? null : next;
}

/**
 * The season an address goes to when the one it says is already complete in the series: the first
 * season after it, as TMDB lists them (`seasons`, specials aside), that the series doesn't have
 * whole — continued after its last episode, or started. Null when the season it says isn't complete
 * there (nothing to move), or every one after it is.
 */
export function nextOpenSeason(
  existing: readonly Pick<EpisodeDto, "season" | "episode">[],
  seasons: readonly { number: number; episodeCount: number }[],
  from: number,
): number | null {
  const complete = (season: number, length: number) =>
    existing.some((episode) => episode.season === season) &&
    nextEpisode(existing, season, length) === null;
  const own = seasons.find((season) => season.number === from);
  if (!own || !complete(own.number, own.episodeCount)) return null;
  const after = seasons
    .filter((season) => season.number > from && season.number > 0)
    .toSorted((a, b) => a.number - b.number);
  return after.find((season) => !complete(season.number, season.episodeCount))?.number ?? null;
}

/** The codes the chosen episodes would take that the series already has (or that repeat). */
export function clashingCodes(
  preview: PreviewDto,
  form: PreviewForm,
  existing: readonly Pick<EpisodeDto, "season" | "episode">[],
): string[] {
  const taken = new Set(existing.map((episode) => episodeCode(episode.season, episode.episode)));
  const number = numberer(preview, form);
  const chosen = new Set(form.included);
  const clashes = new Set<string>();
  for (const episode of preview.episodes) {
    if (!chosen.has(episode.key)) continue;
    const mapped = number(episode);
    const code = episodeCode(mapped.season, mapped.episode);
    if (taken.has(code)) clashes.add(code);
    taken.add(code);
  }
  return [...clashes];
}

export function toCreateBody(preview: PreviewDto, form: PreviewForm): CreateSeriesBody {
  const chosen = new Set(form.included);
  const common = {
    previewId: preview.previewId,
    season: valueOr(parseSeason(form.season)),
    firstEpisode: valueOr(parseFirstEpisode(form.firstEpisode)),
    adjustments: form.adjustments,
    episodeKeys: preview.episodes.map((e) => e.key).filter((key) => chosen.has(key)),
    downloadNow: form.downloadNow,
  };
  const jellyfinId = jellyfinShowOf(form.addTo);
  if (jellyfinId !== null) {
    // The show's title, year and ids come from Jellyfin.
    return { ...common, jellyfinId, tmdbId: null, imdbId: null, follow: form.follow };
  }
  if (form.addTo !== "") {
    // The series' own title, year, ids and follow setting stay as they are.
    return { ...common, seriesId: form.addTo, tmdbId: null, imdbId: null, follow: false };
  }
  return {
    ...common,
    title: form.title.trim(),
    year: valueOr(parseYear(form.year)),
    tmdbId: parseTmdbId(form.tmdbId),
    imdbId: parseImdbId(form.imdbId),
    follow: form.follow,
  };
}

export function toggleEpisode(form: PreviewForm, key: string): PreviewForm {
  return {
    ...form,
    included: form.included.includes(key)
      ? form.included.filter((item) => item !== key)
      : [...form.included, key],
  };
}

export function setAllIncluded(preview: PreviewDto, form: PreviewForm, on: boolean): PreviewForm {
  return { ...form, included: on ? preview.episodes.map((episode) => episode.key) : [] };
}

export function warningsByEpisode(preview: PreviewDto): Map<string, PreviewWarning[]> {
  const map = new Map<string, PreviewWarning[]>();
  for (const warning of preview.warnings) {
    for (const key of warning.keys ?? []) map.set(key, [...(map.get(key) ?? []), warning]);
  }
  return map;
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/** The key a TMDB episode is found by: where an episode of the address lands. */
export const guideKey = (season: number, episode: number) => `${season}:${episode}`;

/** `S01E01–S01E12, S02E01–S02E03`: what a series has, season by season. */
export function episodeRanges(episodes: readonly Pick<EpisodeDto, "season" | "episode">[]): string {
  const bySeason = new Map<number, number[]>();
  for (const { season, episode } of episodes) {
    bySeason.set(season, [...(bySeason.get(season) ?? []), episode]);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, numbers]) => {
      const low = Math.min(...numbers);
      const high = Math.max(...numbers);
      return low === high
        ? episodeCode(season, low)
        : `${episodeCode(season, low)}–${episodeCode(season, high)}`;
    })
    .join(", ");
}

/** `S01E01–E12, S02E01`: the same as `episodeRanges`, short enough for a corner of the bar. */
export function shortRanges(episodes: readonly Pick<EpisodeDto, "season" | "episode">[]): string {
  return episodeRanges(episodes).replace(/–S\d+(E\d+)/g, "–$1");
}

/** Which extractor reads this address, judging by host only (the server has the last word). */
export function matchExtractor(
  address: string,
  extractors: readonly ExtractorDto[],
): ExtractorDto | null {
  const text = address.trim();
  if (text === "") return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase();
  if (!host.includes(".")) return null;
  return (
    extractors.find((extractor) =>
      extractor.hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`)),
    ) ?? null
  );
}

/** What a field that only takes a number keeps of what was typed or pasted. */
export const digitsOf = (text: string) => text.replace(/\D/g, "");

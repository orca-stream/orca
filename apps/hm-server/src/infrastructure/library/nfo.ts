import type { Episode, Series } from "../../domain/series.ts";

function escape(value: string): string {
  return (
    value
      // XML 1.0 cannot carry most control characters, escaped or not.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );
}

const tag = (name: string, value: string | number | null | undefined, attributes = ""): string[] =>
  value === null || value === undefined || value === ""
    ? []
    : [`  <${name}${attributes}>${escape(String(value))}</${name}>`];

function document(root: string, lines: string[]): string {
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<${root}>\n${lines.join("\n")}\n</${root}>\n`;
}

/** The series names a show Jellyfin can look up online (TMDB or IMDb). */
export function isLookedUp(series: Pick<Series, "tmdbId" | "imdbId">): boolean {
  return series.tmdbId !== null || series.imdbId !== null;
}

/** Every episode .nfo says it was written by this server. */
const SOURCE_ID_TYPE = "orca-hm";

/**
 * `tvshow.nfo`. Without an online id, `lockdata` stops Jellyfin's online fetchers from replacing it
 * with a wrong match. With one, the file only names the show (title, year and the ids) and leaves
 * the rest (plot, images, episode titles) to Jellyfin: what an nfo says always wins over TMDB.
 * Dates and years we don't know are left out, never invented.
 */
export function tvshowNfo(series: Series): string {
  if (isLookedUp(series)) {
    return document("tvshow", [
      ...tag("title", series.title),
      ...tag("year", series.year),
      ...tag("uniqueid", series.tmdbId, ` type="tmdb" default="true"`),
      ...tag(
        "uniqueid",
        series.imdbId,
        ` type="imdb"${series.tmdbId === null ? ' default="true"' : ""}`,
      ),
      ...tag("tmdbid", series.tmdbId),
      ...tag("imdb_id", series.imdbId),
    ]);
  }
  return document("tvshow", [
    ...tag("title", series.title),
    ...tag("originaltitle", series.title),
    ...tag("year", series.year),
    ...tag("plot", series.plot),
    "  <lockdata>true</lockdata>",
  ]);
}

/**
 * `movie.nfo`, in a movie's folder. As `tvshow.nfo` does: with an online id it only names the movie
 * and Jellyfin fetches the rest from TMDB; without one it carries what is known and locks it.
 */
export function movieNfo(series: Series): string {
  if (isLookedUp(series)) {
    return document("movie", [
      ...tag("title", series.title),
      ...tag("year", series.year),
      ...tag("uniqueid", series.tmdbId, ` type="tmdb" default="true"`),
      ...tag(
        "uniqueid",
        series.imdbId,
        ` type="imdb"${series.tmdbId === null ? ' default="true"' : ""}`,
      ),
      ...tag("tmdbid", series.tmdbId),
      ...tag("imdbid", series.imdbId),
    ]);
  }
  return document("movie", [
    ...tag("title", series.title),
    ...tag("originaltitle", series.title),
    ...tag("year", series.year),
    ...tag("plot", series.plot),
    "  <lockdata>true</lockdata>",
  ]);
}

/** The `.nfo` beside an episode file; null for a looked-up series, whose episodes Jellyfin names. */
export function episodeNfo(series: Series, episode: Episode): string | null {
  if (isLookedUp(series)) return null;
  return document("episodedetails", [
    ...tag("title", episode.title),
    ...tag("showtitle", series.title),
    ...tag("season", episode.season),
    ...tag("episode", episode.episode),
    ...tag("aired", episode.airDate),
    ...tag("plot", episode.plot),
    ...tag("uniqueid", episode.sourceRef, ` type="${SOURCE_ID_TYPE}"`),
    "  <lockdata>true</lockdata>",
  ]);
}

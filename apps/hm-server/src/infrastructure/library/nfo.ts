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

/**
 * `tvshow.nfo`. `lockdata` stops Jellyfin's online fetchers from replacing it with a wrong match;
 * dates and years we don't know are left out, never invented.
 */
export function tvshowNfo(series: Series): string {
  return document("tvshow", [
    ...tag("title", series.title),
    ...tag("originaltitle", series.title),
    ...tag("year", series.year),
    ...tag("plot", series.plot),
    ...tag("uniqueid", series.externalId, ` type="${escape(series.extractorId)}" default="true"`),
    "  <lockdata>true</lockdata>",
  ]);
}

/** The `.nfo` beside an episode file. */
export function episodeNfo(series: Series, episode: Episode): string {
  return document("episodedetails", [
    ...tag("title", episode.title),
    ...tag("showtitle", series.title),
    ...tag("season", episode.season),
    ...tag("episode", episode.episode),
    ...tag("aired", episode.airDate),
    ...tag("plot", episode.plot),
    ...tag("uniqueid", episode.sourceRef, ` type="${escape(series.extractorId)}"`),
    "  <lockdata>true</lockdata>",
  ]);
}

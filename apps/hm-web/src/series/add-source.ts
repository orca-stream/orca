import type { EpisodeDto, SeriesDto } from "@orca/hm-contract";
import { sortBySpan } from "./source-spans";

type Source = SeriesDto["sources"][number];

/**
 * Where the next source most likely is: what the latest source says comes after it (its next
 * season), unless the series already reads that address.
 */
function nextAddress(sources: readonly Source[]): string | null {
  const known = new Set(sources.map((source) => source.sourceUrl));
  const next = sources
    .map((source) => source.nextUrl)
    .filter((url): url is string => url !== null && !known.has(url));
  return next.at(-1) ?? null;
}

/**
 * One more address for a series: adding a series, with this one already chosen and, when the site
 * tells, the address of what comes next already written. The sources go in the order they are
 * listed, so the latest one says what comes next.
 */
export function addSourceHref(series: SeriesDto, episodes: readonly EpisodeDto[]) {
  const next = nextAddress(sortBySpan(series.sources, episodes));
  const query = new URLSearchParams({ into: series.id, ...(next ? { url: next } : {}) });
  return `/series/new?${query}`;
}

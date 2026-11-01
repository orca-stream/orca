import type { EpisodeDto } from "@orca/hm-contract";

/** The episodes one source brought to one season: from the first number to the last. */
export interface SourceSpan {
  season: number;
  from: number;
  to: number;
  /** The numbers between the first and the last that it doesn't bring, lowest first. */
  gaps: number[];
}

/**
 * What a source holds, a season at a time in order: the lowest and highest episode in each, and the
 * numbers it skips in between.
 */
export function sourceSpans(episodes: readonly EpisodeDto[], sourceId: string): SourceSpan[] {
  const bySeason = new Map<number, Set<number>>();
  for (const episode of episodes) {
    if (episode.sourceId !== sourceId) continue;
    const numbers = bySeason.get(episode.season) ?? new Set<number>();
    numbers.add(episode.episode);
    bySeason.set(episode.season, numbers);
  }
  return [...bySeason]
    .map(([season, numbers]) => {
      const from = Math.min(...numbers);
      const to = Math.max(...numbers);
      const gaps: number[] = [];
      for (let n = from + 1; n < to; n++) if (!numbers.has(n)) gaps.push(n);
      return { season, from, to, gaps };
    })
    .sort((a, b) => a.season - b.season);
}

/**
 * The sources in the order of what they bring: by the season and episode they start at, lowest
 * first. One with no episodes yet goes by the season it is set to, after those at the same start;
 * ties keep the order they were added in.
 */
export function sortBySpan<S extends { id: string; season: number | null }>(
  sources: readonly S[],
  episodes: readonly EpisodeDto[],
): S[] {
  const startOf = (source: S): [number, number] => {
    const [first] = sourceSpans(episodes, source.id);
    if (first) return [first.season, first.from];
    return [source.season ?? Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  };
  const starts = new Map(sources.map((source) => [source.id, startOf(source)]));
  return [...sources].sort((a, b) => {
    const [seasonA, fromA] = starts.get(a.id) ?? [0, 0];
    const [seasonB, fromB] = starts.get(b.id) ?? [0, 0];
    return seasonA - seasonB || fromA - fromB;
  });
}

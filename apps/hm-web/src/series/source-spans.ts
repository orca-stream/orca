import type { EpisodeDto } from "@orca/hm-contract";

/** The episodes one source brought to one season: from the first number to the last. */
export interface SourceSpan {
  season: number;
  from: number;
  to: number;
}

/** What a source holds, a season at a time in order: the lowest and highest episode in each. */
export function sourceSpans(episodes: readonly EpisodeDto[], sourceId: string): SourceSpan[] {
  const bySeason = new Map<number, SourceSpan>();
  for (const episode of episodes) {
    if (episode.sourceId !== sourceId) continue;
    const span = bySeason.get(episode.season);
    if (!span) {
      bySeason.set(episode.season, {
        season: episode.season,
        from: episode.episode,
        to: episode.episode,
      });
    } else {
      span.from = Math.min(span.from, episode.episode);
      span.to = Math.max(span.to, episode.episode);
    }
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
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

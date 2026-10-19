import type { EpisodeDto } from "@orca/hm-contract";

export interface SeasonGroup {
  season: number;
  episodes: EpisodeDto[];
}

/** Seasons in order with specials (season 0) last, episodes in order inside each. */
export function groupBySeason(episodes: readonly EpisodeDto[]): SeasonGroup[] {
  const bySeason = new Map<number, EpisodeDto[]>();
  for (const episode of episodes) {
    bySeason.set(episode.season, [...(bySeason.get(episode.season) ?? []), episode]);
  }
  const rank = (season: number) => (season === 0 ? Number.POSITIVE_INFINITY : season);
  return [...bySeason.entries()]
    .toSorted(([a], [b]) => rank(a) - rank(b))
    .map(([season, list]) => ({
      season,
      episodes: list.toSorted((a, b) => a.episode - b.episode),
    }));
}

/** A download in progress cannot be queued again; everything else can (re-download included). */
export function isSelectable(episode: EpisodeDto): boolean {
  return episode.status !== "downloading";
}

/** What "download missing" queues: episodes not on disk and not already on their way. */
export function missingIds(episodes: readonly EpisodeDto[]): string[] {
  return episodes
    .filter((episode) => episode.status === "missing" || episode.status === "failed")
    .map((episode) => episode.id);
}

export function toggleSelected(
  selection: ReadonlySet<string>,
  episodes: readonly EpisodeDto[],
  id: string,
): Set<string> {
  const next = new Set(selection);
  if (next.delete(id)) return next;
  const episode = episodes.find((item) => item.id === id);
  if (episode && isSelectable(episode)) next.add(id);
  return next;
}

export function setSeason(
  selection: ReadonlySet<string>,
  episodes: readonly EpisodeDto[],
  season: number,
  on: boolean,
): Set<string> {
  const next = new Set(selection);
  for (const episode of episodes) {
    if (episode.season !== season) continue;
    if (!on) next.delete(episode.id);
    else if (isSelectable(episode)) next.add(episode.id);
  }
  return next;
}

export function seasonState(
  selection: ReadonlySet<string>,
  episodes: readonly EpisodeDto[],
  season: number,
): "none" | "some" | "all" {
  const pickable = episodes.filter((episode) => episode.season === season && isSelectable(episode));
  const picked = pickable.filter((episode) => selection.has(episode.id)).length;
  if (picked === 0) return "none";
  return picked === pickable.length ? "all" : "some";
}

export function selectAllSelectable(episodes: readonly EpisodeDto[]): Set<string> {
  return new Set(episodes.filter(isSelectable).map((episode) => episode.id));
}

/** Drops picks that no longer make sense after the list changed (live updates). */
export function pruneSelection(
  selection: ReadonlySet<string>,
  episodes: readonly EpisodeDto[],
): ReadonlySet<string> {
  const valid = new Set(episodes.filter(isSelectable).map((episode) => episode.id));
  const kept = [...selection].filter((id) => valid.has(id));
  return kept.length === selection.size ? selection : new Set(kept);
}

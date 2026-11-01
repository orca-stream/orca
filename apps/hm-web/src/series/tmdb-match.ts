import type { GuideEpisodeDto, GuideSeasonDto } from "@orca/hm-contract";
import { episodeCode } from "./preview-form";

/** How the episodes an address lands in a season compare with what TMDB lists for it. */
export interface SeasonMatch {
  season: number;
  /** The address's episodes that land in it. */
  site: number;
  /** The episodes TMDB lists for it; 0 when TMDB has no such season. */
  tmdb: number;
  /** Numbers the address lands on that TMDB doesn't list. */
  extra: number[];
  /** Numbers TMDB lists as aired that nothing covers: not the address, not the series already. */
  missing: number[];
  /** Numbers TMDB lists without having aired yet (or with no date), and nothing covers. */
  upcoming: number[];
  /** Numbers TMDB lists that the address lacks but the series already has. */
  covered: number[];
}

/**
 * Season by season, where the address and TMDB disagree. `guide` holds TMDB's episodes of each
 * season the address lands in (an empty list for a season TMDB doesn't have; a season left out is
 * not known yet and isn't compared). `covered` are the codes the series it goes to has already.
 * `today` is `YYYY-MM-DD`, compared with TMDB's air dates.
 */
export function matchTmdb(
  landed: readonly { season: number; episode: number }[],
  guide: ReadonlyMap<number, readonly GuideEpisodeDto[]>,
  covered: ReadonlySet<string>,
  today: string,
): SeasonMatch[] {
  const seasons = [...new Set(landed.map((episode) => episode.season))]
    .filter((season) => guide.has(season))
    .sort((a, b) => a - b);
  return seasons.map((season) => {
    const listed = guide.get(season) ?? [];
    const known = new Set(listed.map((episode) => episode.number));
    const numbers = new Set(
      landed.filter((episode) => episode.season === season).map((episode) => episode.episode),
    );
    const uncovered = listed.filter(
      (episode) =>
        !numbers.has(episode.number) && !covered.has(episodeCode(season, episode.number)),
    );
    const aired = (episode: GuideEpisodeDto) =>
      episode.airDate !== null && episode.airDate <= today;
    return {
      season,
      site: numbers.size,
      tmdb: listed.length,
      extra: [...numbers].filter((number) => !known.has(number)).sort((a, b) => a - b),
      missing: uncovered.filter(aired).map((episode) => episode.number),
      upcoming: uncovered.filter((episode) => !aired(episode)).map((episode) => episode.number),
      covered: listed
        .filter(
          (episode) =>
            !numbers.has(episode.number) && covered.has(episodeCode(season, episode.number)),
        )
        .map((episode) => episode.number),
    };
  });
}

/**
 * The seasons TMDB has as aired (with a year and episodes, specials aside) that the series has
 * nothing of: no source brings them.
 */
export function absentSeasons(
  guide: readonly GuideSeasonDto[],
  have: ReadonlySet<number>,
): GuideSeasonDto[] {
  return guide.filter(
    (season) =>
      season.number > 0 &&
      season.year !== null &&
      season.episodeCount > 0 &&
      !have.has(season.number),
  );
}

/** Whether a season's address and TMDB agree: nothing extra and nothing aired left out. */
export const agrees = (match: SeasonMatch) =>
  match.extra.length === 0 && match.missing.length === 0;

/** Today in the panel's own time zone, as TMDB writes its dates. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Episode numbers as short ranges: `E05–E07, E09`; or with another way to write each. */
export function numberRanges(
  numbers: readonly number[],
  code = (n: number) => `E${String(n).padStart(2, "0")}`,
): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]!;
    let to = from;
    while (sorted[i + 1] === to + 1) to = sorted[++i]!;
    parts.push(from === to ? code(from) : `${code(from)}–${code(to)}`);
  }
  return parts.join(", ");
}

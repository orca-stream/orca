import type { JobDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { posterUrl, queries } from "@/api/queries";
import { useLocale } from "@/i18n/locale";

/** `S01E02` → season 1, episode 2; null for a job about no episode. */
export function parseEpisodeCode(code: string | null): { season: number; episode: number } | null {
  const match = code && /^S(\d+)E(\d+)$/i.exec(code);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

/**
 * What a job looks like: its episode's frame and name from TMDB, the player it is on, and the
 * series' poster while there is no frame. All of it from queries the series screens share, so
 * opening the list twice asks nothing new.
 */
export function useJobArt(job: JobDto, { withPlayer = false }: { withPlayer?: boolean } = {}) {
  const api = useApi();
  const locale = useLocale();
  const code = parseEpisodeCode(job.episodeCode);
  const series = useQuery(queries.seriesList(api)).data?.find((s) => s.id === job.seriesId);
  const tmdbId = series?.tmdbId ?? null;
  const guide = useQuery({
    ...queries.guideEpisodes(api, tmdbId ?? "", code?.season ?? 0, locale),
    enabled: tmdbId !== null && code !== null,
  });
  const episodes = useQuery({
    ...queries.episodes(api, job.seriesId ?? ""),
    enabled: withPlayer && job.seriesId !== null,
  });
  const tmdb = code ? guide.data?.find((e) => e.number === code.episode) : undefined;
  const episode = episodes.data?.find((e) => e.id === job.episodeId);
  return {
    still: tmdb?.stillUrl ?? null,
    poster: series?.hasPoster ? posterUrl(series) : null,
    title: tmdb?.name || episode?.title || null,
    player: episode?.player ?? null,
  };
}

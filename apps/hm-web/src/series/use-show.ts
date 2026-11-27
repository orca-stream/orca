import type { SeriesDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { posterUrl, queries } from "@/api/queries";
import { airingHint, finishedStatus } from "./airing";

/**
 * What TMDB tells of a series for its card (the same cached lookup its page asks for): the cover,
 * its own when the server has one, and whether the show still airs.
 */
export function useShow(series: SeriesDto) {
  const api = useApi();
  const tmdbId = series.tmdbId ?? "";
  const lookup = useQuery({
    ...queries.showLookup(api, tmdbId, series.kind),
    enabled: tmdbId !== "",
  });
  const show = lookup.data?.tmdbId === tmdbId ? lookup.data : null;
  return {
    cover: series.hasPoster ? posterUrl(series) : (show?.posterUrl ?? null),
    hint: airingHint(series.follow, show?.status ?? null),
    ended: finishedStatus(show?.status),
    nextEpisode: show?.nextEpisode ?? null,
  };
}

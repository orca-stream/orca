import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type {
  ArtworkKind,
  ArtworkOptionsDto,
  EpisodeDto,
  ExtractorDto,
  JobDto,
  LibraryEpisodeDto,
  LibraryShowDto,
  NotificationList,
  SeriesDto,
  ShowLookupDto,
  GuideEpisodeDto,
  GuideSeasonDto,
} from "./types";
import type { ApiClient } from "./client";
import { keys } from "./keys";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** How many finished jobs the history shows at a time. */
export const HISTORY_PAGE_SIZE = 20;
const ACTIVE_LIMIT = 200;
const FAILED_LIMIT = 100;

function jobsPath(statuses: string[], limit: number, cursor?: string): string {
  const params = new URLSearchParams({ status: statuses.join(","), limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `/jobs?${params}`;
}

const id = encodeURIComponent;

/** Every read of the API as query options, so screens and the live-event handler share the keys. */
export const queries = {
  extractors: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.extractors,
      queryFn: ({ signal }) => api.get<ExtractorDto[]>("/extractors", { signal }),
      staleTime: 5 * 60_000,
    }),

  jobsActive: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.jobsActive,
      queryFn: async ({ signal }) =>
        (await api.get<Page<JobDto>>(jobsPath(["queued", "running"], ACTIVE_LIMIT), { signal }))
          .items,
    }),

  jobsFailed: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.jobsFailed,
      queryFn: async ({ signal }) =>
        (await api.get<Page<JobDto>>(jobsPath(["failed"], FAILED_LIMIT), { signal })).items,
    }),

  jobsHistory: (api: ApiClient) =>
    infiniteQueryOptions({
      queryKey: keys.jobsHistory,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam, signal }) =>
        api.get<Page<JobDto>>(jobsPath(["done", "cancelled"], HISTORY_PAGE_SIZE, pageParam), {
          signal,
        }),
      getNextPageParam: (page: Page<JobDto>) => page.nextCursor ?? undefined,
    }),

  notifications: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.notifications,
      queryFn: ({ signal }) => api.get<NotificationList>("/notifications", { signal }),
    }),

  seriesList: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.seriesList,
      queryFn: ({ signal }) => api.get<SeriesDto[]>("/series", { signal }),
    }),

  seriesDetail: (api: ApiClient, seriesId: string) =>
    queryOptions({
      queryKey: keys.seriesDetail(seriesId),
      queryFn: ({ signal }) => api.get<SeriesDto>(`/series/${id(seriesId)}`, { signal }),
    }),

  episodes: (api: ApiClient, seriesId: string) =>
    queryOptions({
      queryKey: keys.episodes(seriesId),
      queryFn: ({ signal }) =>
        api.get<EpisodeDto[]>(`/series/${id(seriesId)}/episodes`, { signal }),
    }),

  /** The shows Jellyfin already has, and the series this server has for each. */
  libraryShows: (api: ApiClient) =>
    queryOptions({
      queryKey: keys.libraryShows,
      queryFn: ({ signal }) => api.get<LibraryShowDto[]>("/library/shows", { signal }),
      staleTime: 60_000,
      // Without Jellyfin the panel still adds series; it just can't offer its shows.
      retry: false,
    }),

  /** The episodes a Jellyfin show has as files, which adding to it keeps instead of downloading. */
  libraryEpisodes: (api: ApiClient, showId: string) =>
    queryOptions({
      queryKey: keys.libraryEpisodes(showId),
      queryFn: ({ signal }) =>
        api.get<LibraryEpisodeDto[]>(`/library/shows/${id(showId)}/episodes`, { signal }),
      staleTime: 60_000,
    }),

  /** What TMDB calls a show; a show's name doesn't change while the panel is open. */
  showLookup: (api: ApiClient, tmdbId: string) =>
    queryOptions({
      queryKey: keys.showLookup(tmdbId),
      queryFn: ({ signal }) => api.get<ShowLookupDto>(`/lookup/tmdb/${id(tmdbId)}`, { signal }),
      staleTime: Infinity,
      // A 404 is the answer, not a hiccup; and nobody waits through retries while typing.
      retry: false,
    }),

  /** Every image TMDB has for a series' show, to choose its own artwork from. */
  artworkOptions: (api: ApiClient, seriesId: string) =>
    queryOptions({
      queryKey: keys.artworkOptions(seriesId),
      queryFn: ({ signal }) =>
        api.get<ArtworkOptionsDto>(`/series/${id(seriesId)}/artwork`, { signal }),
      staleTime: 10 * 60_000,
      // A 409 (no TMDB id) or a 503 (no key) is the answer: only uploading is offered then.
      retry: false,
    }),

  /** A show's seasons as TMDB numbers them; a 503 means no TMDB key, and the numbers are typed. */
  guideSeasons: (api: ApiClient, tmdbId: string, language: string) =>
    queryOptions({
      queryKey: keys.guideSeasons(tmdbId, language),
      queryFn: ({ signal }) =>
        api.get<GuideSeasonDto[]>(
          `/lookup/tmdb/${id(tmdbId)}/seasons?language=${encodeURIComponent(language)}`,
          { signal },
        ),
      staleTime: Infinity,
      retry: false,
    }),

  /** The episodes of one of those seasons. */
  guideEpisodes: (api: ApiClient, tmdbId: string, season: number, language: string) =>
    queryOptions({
      queryKey: keys.guideEpisodes(tmdbId, season, language),
      queryFn: ({ signal }) =>
        api.get<GuideEpisodeDto[]>(
          `/lookup/tmdb/${id(tmdbId)}/seasons/${season}?language=${encodeURIComponent(language)}`,
          { signal },
        ),
      staleTime: Infinity,
      retry: false,
    }),
};

/**
 * A series' own poster, backdrop or logo. The version makes a changed image a new address, so the
 * browser never shows the one it had cached.
 */
export function artworkUrl(
  series: { id: string; artworkVersion: number },
  kind: ArtworkKind,
): string {
  return `/api/series/${id(series.id)}/${kind}?v=${series.artworkVersion}`;
}

export function posterUrl(series: { id: string; artworkVersion: number }): string {
  return artworkUrl(series, "poster");
}

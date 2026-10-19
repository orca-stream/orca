import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { EpisodeDto, ExtractorDto, JobDto, SeriesDto } from "./types";
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
};

export function posterUrl(seriesId: string): string {
  return `/api/series/${id(seriesId)}/poster`;
}

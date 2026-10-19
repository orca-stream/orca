import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { useApi } from "./context";
import type { CreateSeriesBody, JobDto, PreviewDto, SeriesDto, SeriesPatch } from "./types";

const id = encodeURIComponent;

/** Every write to the API as a hook; each refreshes what it changed (the live stream would too, but may lag). */
export function useMutations() {
  const api = useApi();
  const queryClient = useQueryClient();
  const refreshJobs = () => queryClient.invalidateQueries({ queryKey: keys.jobs });
  const refreshSeries = () => queryClient.invalidateQueries({ queryKey: keys.series });
  const refreshAll = () => Promise.all([refreshJobs(), refreshSeries()]);

  return {
    preview: useMutation({
      mutationFn: (url: string) => api.post<PreviewDto>("/series/preview", { url }),
    }),
    createSeries: useMutation({
      mutationFn: (body: CreateSeriesBody) => api.post<SeriesDto>("/series", body),
      onSuccess: refreshAll,
    }),
    patchSeries: useMutation({
      mutationFn: ({ seriesId, patch }: { seriesId: string; patch: SeriesPatch }) =>
        api.patch<SeriesDto>(`/series/${id(seriesId)}`, patch),
      onSuccess: refreshSeries,
    }),
    enqueue: useMutation({
      mutationFn: (episodeIds: string[]) => api.post<JobDto[]>("/jobs", { episodeIds }),
      onSuccess: refreshAll,
    }),
    downloadSeries: useMutation({
      mutationFn: (seriesId: string) => api.post<JobDto[]>(`/series/${id(seriesId)}/download`),
      onSuccess: refreshAll,
    }),
    retryJob: useMutation({
      mutationFn: (jobId: string) => api.post<JobDto>(`/jobs/${id(jobId)}/retry`),
      onSuccess: refreshAll,
    }),
    cancelJob: useMutation({
      mutationFn: (jobId: string) => api.post<JobDto>(`/jobs/${id(jobId)}/cancel`),
      onSuccess: refreshAll,
    }),
    /** One after another: the server rejects a retry when another job of the same work is active. */
    retryJobs: useMutation({
      mutationFn: async (jobIds: string[]) => {
        let rejected = 0;
        for (const jobId of jobIds) {
          try {
            await api.post<JobDto>(`/jobs/${id(jobId)}/retry`);
          } catch {
            rejected += 1;
          }
        }
        return rejected;
      },
      onSettled: refreshAll,
    }),
  };
}

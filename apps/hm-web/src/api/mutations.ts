import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { useApi } from "./context";
import type {
  ArtworkKind,
  CreateSeriesBody,
  EpisodeDto,
  JobDto,
  PreviewDto,
  SeriesDto,
  SeriesPatch,
  SourcePatch,
  SwitchSourceBody,
  SwitchSourceResult,
} from "./types";

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
      mutationFn: ({ url, extractorId }: { url: string; extractorId?: string }) =>
        api.post<PreviewDto>("/series/preview", extractorId ? { url, extractorId } : { url }),
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
    /** The series' own poster, backdrop or logo: one of TMDB's (`url`) or an uploaded `file`. */
    setArtwork: useMutation({
      mutationFn: ({
        seriesId,
        kind,
        from,
      }: {
        seriesId: string;
        kind: ArtworkKind;
        from: { url: string } | { file: File };
      }) =>
        "url" in from
          ? api.put<SeriesDto>(`/series/${id(seriesId)}/${kind}`, { url: from.url })
          : api.putFile<SeriesDto>(`/series/${id(seriesId)}/${kind}`, from.file),
      onSuccess: refreshSeries,
    }),
    /** Back to TMDB's (or Jellyfin's) artwork of that kind. */
    removeArtwork: useMutation({
      mutationFn: ({ seriesId, kind }: { seriesId: string; kind: ArtworkKind }) =>
        api.delete<SeriesDto>(`/series/${id(seriesId)}/${kind}`),
      onSuccess: refreshSeries,
    }),
    patchSource: useMutation({
      mutationFn: ({
        seriesId,
        sourceId,
        patch,
      }: {
        seriesId: string;
        sourceId: string;
        patch: SourcePatch;
      }) => api.patch<SeriesDto>(`/series/${id(seriesId)}/sources/${id(sourceId)}`, patch),
      onSuccess: refreshSeries,
    }),
    enqueue: useMutation({
      mutationFn: (episodeIds: string[]) => api.post<JobDto[]>("/jobs", { episodeIds }),
      onSuccess: refreshAll,
    }),
    /** No ids: every unread one. */
    markNotificationsRead: useMutation({
      mutationFn: (ids?: string[]) =>
        api.post<{ unreadCount: number }>("/notifications/read", ids ? { ids } : {}),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications }),
    }),
    checkSeries: useMutation({
      mutationFn: (seriesId: string) => api.post<JobDto>(`/series/${id(seriesId)}/check`),
      onSuccess: refreshAll,
    }),
    /** The episode stays in the series as missing; only its file goes. */
    deleteEpisodeFile: useMutation({
      mutationFn: ({ seriesId, episodeId }: { seriesId: string; episodeId: string }) =>
        api.delete<EpisodeDto>(`/series/${id(seriesId)}/episodes/${id(episodeId)}/file`),
      onSettled: refreshAll,
    }),
    /** The episodes take their video from that source from now on; nothing is downloaded. */
    switchSource: useMutation({
      mutationFn: ({ seriesId, body }: { seriesId: string; body: SwitchSourceBody }) =>
        api.post<SwitchSourceResult>(`/series/${id(seriesId)}/episodes/source`, body),
      onSettled: refreshAll,
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
    /** Every download still waiting in the queue; the running ones go on. */
    cancelQueued: useMutation({
      mutationFn: () => api.post<{ cancelled: number }>("/jobs/cancel-queued"),
      onSettled: refreshAll,
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

/** Query keys in one place, so SSE handling and mutations invalidate exactly what screens read. */
export const keys = {
  me: ["auth", "me"] as const,
  extractors: ["extractors"] as const,
  jobs: ["jobs"] as const,
  jobsActive: ["jobs", "active"] as const,
  jobsFailed: ["jobs", "failed"] as const,
  jobsHistory: ["jobs", "history"] as const,
  series: ["series"] as const,
  seriesList: ["series", "list"] as const,
  seriesDetail: (id: string) => ["series", "detail", id] as const,
  episodes: (id: string) => ["series", "episodes", id] as const,
};

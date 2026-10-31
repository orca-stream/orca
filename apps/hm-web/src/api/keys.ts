/** Query keys in one place, so SSE handling and mutations invalidate exactly what screens read. */
export const keys = {
  me: ["auth", "me"] as const,
  extractors: ["extractors"] as const,
  jobs: ["jobs"] as const,
  jobsActive: ["jobs", "active"] as const,
  jobsFailed: ["jobs", "failed"] as const,
  jobsHistory: ["jobs", "history"] as const,
  notifications: ["notifications"] as const,
  series: ["series"] as const,
  seriesList: ["series", "list"] as const,
  seriesDetail: (id: string) => ["series", "detail", id] as const,
  episodes: (id: string) => ["series", "episodes", id] as const,
  libraryShows: ["library", "shows"] as const,
  libraryEpisodes: (showId: string) => ["library", "shows", showId, "episodes"] as const,
  showLookup: (tmdbId: string) => ["lookup", "tmdb", tmdbId] as const,
  guideSeasons: (tmdbId: string, language: string) =>
    ["lookup", "tmdb", tmdbId, "seasons", language] as const,
  guideEpisodes: (tmdbId: string, season: number, language: string) =>
    ["lookup", "tmdb", tmdbId, "seasons", season, language] as const,
};

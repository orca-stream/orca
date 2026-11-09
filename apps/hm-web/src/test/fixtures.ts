import type { JobDto } from "@orca/hm-contract";

export function makeJob(over: Partial<JobDto> = {}): JobDto {
  return {
    id: "j1",
    kind: "download_episode",
    status: "queued",
    seriesId: "s1",
    seriesTitle: "Beverly Hillbillies",
    episodeId: "e1",
    episodeCode: "S01E01",
    progress: null,
    progressDetail: null,
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    errorKind: null,
    runAfter: 0,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

import type { EpisodeDto, PreviewDto, SeriesDto } from "@orca/hm-contract";

export function makePreview(over: Partial<PreviewDto> = {}): PreviewDto {
  return {
    previewId: "p1",
    extractorId: "internet-archive",
    series: {
      externalId: "bevhill",
      sourceUrl: "https://archive.org/details/bevhill",
      title: "The Beverly Hillbillies",
      year: 1962,
      plot: "A family strikes oil.",
    },
    seasons: [{ number: 1, episodeCount: 3 }],
    episodes: [
      ep("e1", 1, 1, "The Clampetts Strike Oil"),
      ep("e2", 1, 2, "Getting Settled", { inferred: true }),
      ep("e4", 1, 4, "Jed Buys Stock"),
    ],
    license: { kind: "public-domain", url: "https://example.test/license" },
    warnings: [
      { kind: "gap", message: "Episode 3 is missing", keys: ["e4"] },
      { kind: "inferred", message: "Numbering was inferred", keys: ["e2"] },
    ],
    selectedKey: null,
    posterUrl: "/api/series/preview/p1/poster",
    ...over,
  };
}

function ep(
  key: string,
  season: number,
  episode: number,
  title: string,
  over: Partial<PreviewDto["episodes"][number]> = {},
): PreviewDto["episodes"][number] {
  return {
    key,
    season,
    episode,
    title,
    inferred: false,
    durationSec: 1500,
    sizeBytes: 100 * 1024 * 1024,
    format: "mp4",
    source: { kind: "direct", host: "archive.org" },
    ...over,
  };
}

export function makeEpisode(over: Partial<EpisodeDto> = {}): EpisodeDto {
  return {
    id: "e1",
    seriesId: "s1",
    sourceId: "s1",
    season: 1,
    episode: 1,
    title: "Pilot",
    plot: null,
    airDate: null,
    inferred: false,
    durationSec: 1500,
    sizeBytes: 100 * 1024 * 1024,
    format: "mp4",
    status: "missing",
    fileOutdated: false,
    progress: null,
    progressDetail: null,
    player: null,
    ...over,
  };
}

export function makeSeries(over: Partial<SeriesDto> = {}): SeriesDto {
  return {
    id: "s1",
    kind: "show",
    title: "Beverly Hillbillies",
    year: 1962,
    plot: "A family strikes oil.",
    tmdbId: null,
    imdbId: null,
    sources: [
      {
        id: "s1",
        extractorId: "internet-archive",
        externalId: "bevhill",
        sourceUrl: "https://archive.org/details/bevhill",
        season: null,
        episodeOffset: 0,
        adjustments: [],
        closed: false,
        nextUrl: null,
      },
    ],
    follow: false,
    paused: false,
    checkIntervalHours: 24,
    lastCheckedAt: null,
    maxHeight: null,
    audioLangs: null,
    subtitleLangs: null,
    preferredSources: {},
    hasPoster: true,
    hasBackdrop: false,
    hasLogo: false,
    artworkVersion: 0,
    artworkFrom: {},
    lastDownloadAt: null,
    episodeCount: 36,
    availableCount: 12,
    downloadingCount: 0,
    running: [],
    createdAt: 0,
    ...over,
  };
}

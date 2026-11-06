import type { Extraction, ExtractionWarning } from "@orca/extractor-core";
import type {
  EpisodeDto,
  JobDto,
  NotificationDto,
  PreviewDto,
  PreviewWarning,
  SeriesDto,
  SourceDto,
} from "@orca/hm-contract";
import type { Notification } from "../domain/notification.ts";
import { HOST_LANE_PREFIX, isHostLane, type Job } from "../domain/job.ts";
import {
  episodeCode,
  fileOutdated,
  type Episode,
  type Series,
  type SeriesSource,
} from "../domain/series.ts";
import type { SeriesWithCounts } from "./ports.ts";

const WARNING_KIND: Record<ExtractionWarning["code"], PreviewWarning["kind"]> = {
  gap: "gap",
  duplicate: "duplicate",
  compilation: "compilation",
  "season-inferred": "inferred",
  "numbering-inferred": "inferred",
  "license-unknown": "license",
  "license-recent": "license",
  "year-missing": "year",
  "multiple-videos": "skipped",
  "no-video": "skipped",
};

/** The host of an address an extractor gave, or null when it isn't one. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname || null;
  } catch {
    return null;
  }
}

export function toPreviewDto(
  extraction: Extraction,
  previewId: string,
  extractorId: string,
  hasPoster: boolean,
): PreviewDto {
  const { series, license } = extraction;
  return {
    previewId,
    extractorId,
    series: {
      externalId: series.externalId,
      sourceUrl: series.sourceUrl,
      title: series.title,
      year: series.year ?? null,
      plot: series.plot ?? null,
    },
    seasons: extraction.seasons,
    episodes: extraction.episodes.map((episode) => ({
      key: episode.sourceRef,
      season: episode.season,
      episode: episode.episode,
      title: episode.title,
      inferred: episode.inferred,
      durationSec: episode.media.durationSec ?? null,
      sizeBytes: episode.media.sizeBytes ?? null,
      format: episode.media.format ?? null,
      source: { kind: episode.media.kind, host: hostOf(episode.media.url) },
    })),
    license: { kind: license.kind, url: license.url ?? null },
    warnings: extraction.warnings.map((warning) => ({
      kind: WARNING_KIND[warning.code],
      message: warning.message,
      ...(warning.sourceRefs ? { keys: warning.sourceRefs } : {}),
    })),
    selectedKey: extraction.selectedSourceRef ?? null,
    posterUrl: hasPoster ? `/api/series/preview/${encodeURIComponent(previewId)}/poster` : null,
  };
}

/** Where a source's site keeps what comes after it, as its extractor guesses it. */
export type NextSourceUrl = (source: SeriesSource) => string | null;

export function toSourceDto(source: SeriesSource, nextUrl: NextSourceUrl): SourceDto {
  return {
    id: source.id,
    extractorId: source.extractorId,
    externalId: source.externalId,
    sourceUrl: source.sourceUrl,
    season: source.season,
    episodeOffset: source.episodeOffset,
    adjustments: source.adjustments,
    closed: source.closed,
    nextUrl: nextUrl(source),
  };
}

/** A series' episode downloads: how many are queued or running, and the running ones' progress. */
export interface SeriesDownloads {
  count: number;
  running: SeriesDto["running"];
}

/** How far a job is, 0–1: its own fraction, else bytes over a known total; null while unknown. */
function fractionOf(job: Job): number | null {
  if (job.progress !== null) return job.progress;
  const { bytes, total } = job.progressDetail ?? {};
  return bytes !== undefined && total ? bytes / total : null;
}

/** Each series' downloads, from the per-series counts and the downloads running now. */
export function downloadsBySeries(
  counts: ReadonlyMap<string, number>,
  running: readonly Job[],
): (seriesId: string) => SeriesDownloads {
  return (seriesId) => ({
    count: counts.get(seriesId) ?? 0,
    running: running.flatMap((job) =>
      job.seriesId === seriesId && job.episodeId
        ? [{ episodeId: job.episodeId, progress: fractionOf(job) }]
        : [],
    ),
  });
}

export function toSeriesDto(
  series: Series | SeriesWithCounts,
  sources: readonly SeriesSource[],
  nextUrl: NextSourceUrl,
  downloads: SeriesDownloads,
  counts?: { episodeCount: number; availableCount: number; lastDownloadAt?: number | null },
): SeriesDto {
  const c: { episodeCount: number; availableCount: number; lastDownloadAt?: number | null } =
    counts ?? ("episodeCount" in series ? series : { episodeCount: 0, availableCount: 0 });
  return {
    id: series.id,
    title: series.title,
    year: series.year,
    plot: series.plot,
    tmdbId: series.tmdbId,
    imdbId: series.imdbId,
    sources: sources.map((source) => toSourceDto(source, nextUrl)),
    follow: series.follow,
    paused: series.paused,
    checkIntervalHours: series.checkIntervalHours,
    lastCheckedAt: series.lastCheckedAt,
    maxHeight: series.maxHeight,
    audioLangs: series.audioLangs,
    subtitleLangs: series.subtitleLangs,
    preferredSources: series.preferredSources,
    hasPoster: series.hasPoster,
    hasBackdrop: series.hasBackdrop,
    hasLogo: series.hasLogo,
    artworkVersion: series.artworkVersion,
    artworkFrom: series.artworkFrom,
    lastDownloadAt: c.lastDownloadAt ?? null,
    episodeCount: c.episodeCount,
    availableCount: c.availableCount,
    downloadingCount: downloads.count,
    running: downloads.running,
    createdAt: series.createdAt,
  };
}

/** `job` is the episode's live download (queued or running), if it has one. */
export function toEpisodeDto(episode: Episode, job: Job | null = null): EpisodeDto {
  return {
    id: episode.id,
    seriesId: episode.seriesId,
    sourceId: episode.sourceId,
    season: episode.season,
    episode: episode.episode,
    title: episode.title,
    plot: episode.plot,
    airDate: episode.airDate,
    inferred: episode.inferred,
    durationSec: episode.durationSec,
    sizeBytes: episode.sizeBytes,
    format: episode.format,
    status: episode.status,
    fileOutdated: fileOutdated(episode),
    progress: job?.status === "running" ? job.progress : null,
    progressDetail: job?.status === "running" ? job.progressDetail : null,
    player: job && isHostLane(job.resource) ? job.resource.slice(HOST_LANE_PREFIX.length) : null,
  };
}

export function toJobDto(job: Job, seriesTitle: string | null, episode: Episode | null): JobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    seriesId: job.seriesId,
    seriesTitle,
    episodeId: job.episodeId,
    episodeCode: episode ? episodeCode(episode.season, episode.episode) : null,
    progress: job.progress,
    progressDetail: job.progressDetail,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    errorKind: job.errorKind,
    runAfter: job.runAfter,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export function toNotificationDto(notification: Notification): NotificationDto {
  return { ...notification, data: { ...notification.data } };
}

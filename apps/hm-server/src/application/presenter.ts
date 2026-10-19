import type { Extraction, ExtractionWarning } from "@orca/extractor-core";
import type { EpisodeDto, JobDto, PreviewDto, PreviewWarning, SeriesDto } from "@orca/hm-contract";
import type { Job } from "../domain/job.ts";
import { episodeCode, type Episode, type Series } from "../domain/series.ts";
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
    })),
    license: { kind: license.kind, url: license.url ?? null, requiresAck: license.requiresAck },
    warnings: extraction.warnings.map((warning) => ({
      kind: WARNING_KIND[warning.code],
      message: warning.message,
      ...(warning.sourceRefs ? { keys: warning.sourceRefs } : {}),
    })),
    selectedKey: extraction.selectedSourceRef ?? null,
    posterUrl: hasPoster ? `/api/series/preview/${encodeURIComponent(previewId)}/poster` : null,
  };
}

export function toSeriesDto(
  series: Series | SeriesWithCounts,
  downloadingCount: number,
  counts?: { episodeCount: number; availableCount: number },
): SeriesDto {
  const c = counts ?? ("episodeCount" in series ? series : { episodeCount: 0, availableCount: 0 });
  return {
    id: series.id,
    title: series.title,
    year: series.year,
    plot: series.plot,
    extractorId: series.extractorId,
    externalId: series.externalId,
    sourceUrl: series.sourceUrl,
    follow: series.follow,
    checkIntervalHours: series.checkIntervalHours,
    lastCheckedAt: series.lastCheckedAt,
    hasPoster: series.hasPoster,
    episodeCount: c.episodeCount,
    availableCount: c.availableCount,
    downloadingCount,
    createdAt: series.createdAt,
  };
}

export function toEpisodeDto(episode: Episode, progress: number | null = null): EpisodeDto {
  return {
    id: episode.id,
    seriesId: episode.seriesId,
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
    progress,
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

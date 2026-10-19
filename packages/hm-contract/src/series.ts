import * as z from "zod";
import { LicenseKindSchema } from "./common.ts";
import { LANGUAGE_CODE_PATTERN, MAX_MAX_HEIGHT, MIN_MAX_HEIGHT } from "./rules.ts";

/** Titles become folder names; this keeps them well under file-name limits. */
export const MAX_TITLE_LENGTH = 150;

export const EpisodeStatus = z.enum(["missing", "queued", "downloading", "available", "failed"]);
export type EpisodeStatus = z.infer<typeof EpisodeStatus>;

export const PreviewRequest = z.object({
  url: z.string().min(1),
  /** Use this extractor instead of the one that matches the address (required for an explicit one). */
  extractorId: z.string().min(1).optional(),
});
export type PreviewRequest = z.infer<typeof PreviewRequest>;

export const LicenseDto = z.object({
  kind: LicenseKindSchema,
  url: z.string().nullable(),
  requiresAck: z.boolean(),
});
export type LicenseDto = z.infer<typeof LicenseDto>;

export const PreviewEpisode = z.object({
  /** Stable id inside the preview (the source reference); `CreateSeriesBody.episodeKeys` picks from these. */
  key: z.string(),
  season: z.number().int(),
  episode: z.number().int(),
  title: z.string(),
  inferred: z.boolean(),
  durationSec: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  format: z.string().nullable(),
});
export type PreviewEpisode = z.infer<typeof PreviewEpisode>;

export const PreviewWarning = z.object({
  kind: z.enum(["gap", "inferred", "duplicate", "compilation", "license", "year", "skipped"]),
  message: z.string(),
  keys: z.array(z.string()).optional(),
});
export type PreviewWarning = z.infer<typeof PreviewWarning>;

export const PreviewDto = z.object({
  /** Hand it back in `POST /api/series`; previews are kept for a short while only. */
  previewId: z.string(),
  extractorId: z.string(),
  series: z.object({
    externalId: z.string(),
    sourceUrl: z.string(),
    title: z.string(),
    year: z.number().int().nullable(),
    plot: z.string().nullable(),
  }),
  seasons: z.array(z.object({ number: z.number().int(), episodeCount: z.number().int() })),
  episodes: z.array(PreviewEpisode),
  license: LicenseDto,
  warnings: z.array(PreviewWarning),
  /** The episode the pasted URL pointed at, when it named a file. */
  selectedKey: z.string().nullable(),
  /** The cover, as a path on this server (never the remote address); null when there is none. */
  posterUrl: z.string().nullable(),
});
export type PreviewDto = z.infer<typeof PreviewDto>;

export const CreateSeriesBody = z.object({
  previewId: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  year: z.number().int().min(1800).max(2200).nullable(),
  episodeKeys: z.array(z.string()).min(1),
  follow: z.boolean().default(false),
  downloadNow: z.boolean().default(false),
  licenseAck: z.boolean().default(false),
});
export type CreateSeriesBody = z.infer<typeof CreateSeriesBody>;

/**
 * An ISO 639-2 language code: three lower-case letters, as ffprobe reports a track's language
 * (`eng`, `spa`, `jpn`). Not the two-letter ISO 639-1 code (`en`) and not a name.
 */
export const LanguageCode = z
  .string()
  .regex(LANGUAGE_CODE_PATTERN, "Use a three-letter ISO 639-2 code");

const MAX_LANGUAGES = 10;

export const SeriesPatch = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  year: z.number().int().min(1800).max(2200).nullable().optional(),
  follow: z.boolean().optional(),
  checkIntervalHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  /** Tallest video to download, for streams that come in several sizes. `null`: the server's default. */
  maxHeight: z.number().int().min(MIN_MAX_HEIGHT).max(MAX_MAX_HEIGHT).nullable().optional(),
  /** Audio languages to keep, original first. `null`: the server's default (every track). */
  audioLangs: z.array(LanguageCode).min(1).max(MAX_LANGUAGES).nullable().optional(),
  /** Subtitle languages to keep; empty means none. `null`: the server's default (every text track). */
  subtitleLangs: z.array(LanguageCode).max(MAX_LANGUAGES).nullable().optional(),
});
export type SeriesPatch = z.infer<typeof SeriesPatch>;

export const SeriesDto = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  plot: z.string().nullable(),
  extractorId: z.string(),
  externalId: z.string(),
  sourceUrl: z.string(),
  follow: z.boolean(),
  checkIntervalHours: z.number().int(),
  lastCheckedAt: z.number().nullable(),
  /** The series' own track choices; `null` means it follows the server's defaults. */
  maxHeight: z.number().int().nullable(),
  audioLangs: z.array(z.string()).nullable(),
  subtitleLangs: z.array(z.string()).nullable(),
  hasPoster: z.boolean(),
  episodeCount: z.number().int(),
  availableCount: z.number().int(),
  /** Episode downloads of this series that are queued or running right now. */
  downloadingCount: z.number().int(),
  createdAt: z.number(),
});
export type SeriesDto = z.infer<typeof SeriesDto>;

export const EpisodeDto = z.object({
  id: z.string(),
  seriesId: z.string(),
  season: z.number().int(),
  episode: z.number().int(),
  title: z.string(),
  plot: z.string().nullable(),
  airDate: z.string().nullable(),
  inferred: z.boolean(),
  durationSec: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  format: z.string().nullable(),
  status: EpisodeStatus,
  /** 0..1 while downloading. */
  progress: z.number().nullable(),
});
export type EpisodeDto = z.infer<typeof EpisodeDto>;

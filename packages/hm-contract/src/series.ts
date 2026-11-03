import * as z from "zod";
import { LicenseKindSchema } from "./common.ts";
import { ProgressDetail } from "./jobs.ts";
import {
  IMDB_ID_PATTERN,
  LANGUAGE_CODE_PATTERN,
  MAX_MAX_HEIGHT,
  MAX_TITLE_LENGTH,
  MIN_MAX_HEIGHT,
  TMDB_ID_PATTERN,
} from "./rules.ts";

export { MAX_TITLE_LENGTH };

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
  /**
   * Where it is fetched from: a file (`direct`), a page that plays it (`page`), or a page listing
   * several players of it (`mirrors`, one is picked when it downloads). `host` is that address's.
   */
  source: z.object({
    kind: z.enum(["direct", "page", "mirrors"]),
    host: z.string().nullable(),
  }),
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

/** The TMDB id of a show, as on its page (`themoviedb.org/tv/<id>`). */
export const TmdbId = z.string().trim().regex(TMDB_ID_PATTERN, "A TMDB id is a number");
/** The IMDb id of a show, as on its page (`imdb.com/title/<id>`). */
export const ImdbId = z.string().trim().regex(IMDB_ID_PATTERN, "An IMDb id looks like tt0123456");

export const ShowLookupParams = z.object({ tmdbId: TmdbId });
export type ShowLookupParams = z.infer<typeof ShowLookupParams>;

/**
 * What TMDB says a show is called, as Jellyfin looks it up: in the server's preferred metadata
 * language, which is the language the rest of the show's metadata comes in.
 */
export const ShowLookupDto = z.object({
  tmdbId: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  imdbId: z.string().nullable(),
  /** TMDB's synopsis, in that same language. */
  overview: z.string().nullable(),
  /** TMDB's poster, an absolute http(s) address the panel loads as is. */
  posterUrl: z.string().nullable(),
  /** A wide still of the show from TMDB's image host; null without a TMDB key of this server's own. */
  backdropUrl: z.string().nullable(),
  /**
   * Whether the show still airs, as TMDB says: `airing` with a next episode on the calendar,
   * `returning` when more is expected but undated, `ended` / `canceled` once no new episodes will
   * come; null without a TMDB key of this server's own, or for a status it can't read.
   */
  status: z.enum(["airing", "returning", "ended", "canceled"]).nullable(),
  /** The next episode on TMDB's calendar (`airDate` is `YYYY-MM-DD`); null when none is dated. */
  nextEpisode: z
    .object({ season: z.number().int(), number: z.number().int(), airDate: z.string().nullable() })
    .nullable(),
});
export type ShowLookupDto = z.infer<typeof ShowLookupDto>;

/** The language TMDB answers in (`es`, `en-US`); TMDB's default when absent. */
const GuideLanguage = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "A language looks like es or en-US")
  .optional();

export const GuideSeasonsParams = z.object({ tmdbId: TmdbId });
export type GuideSeasonsParams = z.infer<typeof GuideSeasonsParams>;
export const GuideEpisodesParams = z.object({
  tmdbId: TmdbId,
  season: z.coerce.number().int().min(0).max(999),
});
export type GuideEpisodesParams = z.infer<typeof GuideEpisodesParams>;
export const GuideQuery = z.object({ language: GuideLanguage });
export type GuideQuery = z.infer<typeof GuideQuery>;

/** A season as TMDB numbers it: 0 holds the specials. */
export const GuideSeasonDto = z.object({
  number: z.number().int(),
  name: z.string(),
  episodeCount: z.number().int(),
  year: z.number().int().nullable(),
});
export type GuideSeasonDto = z.infer<typeof GuideSeasonDto>;

/** An episode of a TMDB season, to pick where an address starts and to show what it is. */
export const GuideEpisodeDto = z.object({
  number: z.number().int(),
  name: z.string(),
  airDate: z.string().nullable(),
  overview: z.string().nullable(),
  runtimeMin: z.number().int().nullable(),
  /** A frame of the episode from TMDB's image host, an absolute https address loaded as is. */
  stillUrl: z.string().nullable(),
});
export type GuideEpisodeDto = z.infer<typeof GuideEpisodeDto>;

/** A show in Jellyfin's libraries, and whether this server already has it as a series. */
export const LibraryShowDto = z.object({
  /** Jellyfin's item id; `CreateSeriesBody.jellyfinId` takes it. */
  id: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  tmdbId: z.string().nullable(),
  imdbId: z.string().nullable(),
  /** The series this server has for it (same folder, or same TMDB or IMDb id); null when none. */
  seriesId: z.string().nullable(),
  /** False when its folder is outside this server's media root: it can be seen, not added to. */
  adoptable: z.boolean(),
});
export type LibraryShowDto = z.infer<typeof LibraryShowDto>;

/** An episode a Jellyfin show has as a file: adopting the show keeps it instead of downloading it. */
export const LibraryEpisodeDto = z.object({
  season: z.number().int(),
  episode: z.number().int(),
});
export type LibraryEpisodeDto = z.infer<typeof LibraryEpisodeDto>;

const Title = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

/** One episode of an address numbered by hand (see `EpisodeAdjustment` in the rules). */
export const EpisodeAdjustment = z.object({
  season: z.number().int().min(0).max(999),
  episode: z.number().int().min(0).max(9999),
  kind: z.enum(["special", "renumber"]),
  number: z.number().int().min(0).max(9999),
});
const Year = z.number().int().min(1800).max(2200).nullable();

export const CreateSeriesBody = z
  .object({
    previewId: z.string().min(1),
    /**
     * Adds the address to this series (another season, or another part of one) instead of making a
     * new series; title, year and the ids are the series' own then and are left out.
     */
    seriesId: z.string().min(1).optional(),
    /**
     * Adds the address to a show Jellyfin already has and this server doesn't (see
     * `GET /api/library/shows`): the series takes the show's folder, title, year and ids, its episode
     * files are renamed to this server's names, and the chosen episodes already there aren't downloaded.
     */
    jellyfinId: z.string().min(1).optional(),
    title: Title.optional(),
    year: Year.optional(),
    /** Lets Jellyfin fetch the show's metadata and images itself. */
    tmdbId: TmdbId.nullable().default(null),
    imdbId: ImdbId.nullable().default(null),
    /** The season this address's episodes go to; null keeps the site's. */
    season: z.number().int().min(0).max(999).nullable().default(null),
    /** The number the lowest episode of this address gets in that season; null keeps the site's. */
    firstEpisode: z.number().int().min(0).max(9999).nullable().default(null),
    /**
     * Episodes numbered by hand, by the site's season and number: an extra sent to the specials, or
     * one from which the numbers move. The offset of `firstEpisode` is measured around them.
     */
    adjustments: z.array(EpisodeAdjustment).max(500).default([]),
    episodeKeys: z.array(z.string()).min(1),
    follow: z.boolean().default(false),
    downloadNow: z.boolean().default(false),
  })
  .refine(
    (body) =>
      body.seriesId !== undefined || body.jellyfinId !== undefined || body.title !== undefined,
    { message: "A new series needs a title", path: ["title"] },
  )
  .refine((body) => body.seriesId === undefined || body.jellyfinId === undefined, {
    message: "Add to a series or to a show in Jellyfin, not both",
    path: ["jellyfinId"],
  });
export type CreateSeriesBody = z.infer<typeof CreateSeriesBody>;
/** What a caller may send: the fields with a default can be left out. */
export type CreateSeriesInput = z.input<typeof CreateSeriesBody>;

/**
 * An ISO 639-2 language code: three lower-case letters, as ffprobe reports a track's language
 * (`eng`, `spa`, `jpn`). Not the two-letter ISO 639-1 code (`en`) and not a name.
 */
export const LanguageCode = z
  .string()
  .regex(LANGUAGE_CODE_PATTERN, "Use a three-letter ISO 639-2 code");

const MAX_LANGUAGES = 10;

export const SeriesPatch = z.object({
  title: Title.optional(),
  year: Year.optional(),
  tmdbId: TmdbId.nullable().optional(),
  imdbId: ImdbId.nullable().optional(),
  follow: z.boolean().optional(),
  /** Holds the series' downloads (the one under way stops and keeps what it has) until `false`. */
  paused: z.boolean().optional(),
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

/** What can change of one address of a series. */
export const SourcePatch = z.strictObject({
  /** A closed source (a finished season) is no longer read when the series is checked. */
  closed: z.boolean(),
});
export type SourcePatch = z.infer<typeof SourcePatch>;

/** One address a series is read from: a whole show, a season, or a part of a season. */
export const SourceDto = z.object({
  id: z.string(),
  extractorId: z.string(),
  externalId: z.string(),
  sourceUrl: z.string(),
  /** The season its episodes go to; null keeps the site's. */
  season: z.number().int().nullable(),
  /** Added to the site's episode numbers. */
  episodeOffset: z.number().int(),
  /** Its episodes numbered by hand; what it finds later is numbered around them too. */
  adjustments: z.array(EpisodeAdjustment),
  /** Marked as bringing nothing new: checks skip it. */
  closed: z.boolean(),
  /** Where its site most likely keeps what comes next (the next season); null when unknown. */
  nextUrl: z.string().nullable(),
});
export type SourceDto = z.infer<typeof SourceDto>;

export const SeriesDto = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  plot: z.string().nullable(),
  tmdbId: z.string().nullable(),
  imdbId: z.string().nullable(),
  /** Oldest first. */
  sources: z.array(SourceDto),
  follow: z.boolean(),
  /** Its downloads wait in the queue until it is resumed. */
  paused: z.boolean(),
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
  /** Of those, the ones fetching right now and how far each is (0–1; null while unknown). */
  running: z.array(z.object({ episodeId: z.string(), progress: z.number().nullable() })),
  createdAt: z.number(),
});
export type SeriesDto = z.infer<typeof SeriesDto>;

export const EpisodeDto = z.object({
  id: z.string(),
  seriesId: z.string(),
  /** The source it was found on; null only if that source was removed. */
  sourceId: z.string().nullable(),
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
  /** 0..1 while downloading, when the total size is known. */
  progress: z.number().nullable(),
  /** Bytes so far, total, speed and ETA of the download in progress. */
  progressDetail: ProgressDetail.nullable(),
  /** The host of the video player being tried, while queued or downloading from mirrors. */
  player: z.string().nullable(),
});
export type EpisodeDto = z.infer<typeof EpisodeDto>;

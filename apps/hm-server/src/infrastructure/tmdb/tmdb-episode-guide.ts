import * as z from "zod";
import type { ArtworkKind, ArtworkOptionDto, ArtworkOptionsDto } from "@orca/hm-contract";
import type {
  AiringStatus,
  EpisodeGuide,
  GuideEpisode,
  GuideSeason,
  GuideShow,
  ShowMatch,
} from "../../application/ports.ts";
import { AppError } from "../../domain/errors.ts";

/** TMDB's API, version 3: the one with `/tv/{id}` and `/tv/{id}/season/{n}`. */
const TMDB_API = "https://api.themoviedb.org/3";
/** TMDB's image host, at the width of a card in the panel's episode grid. */
const TMDB_STILL = "https://image.tmdb.org/t/p/w400";
/** A show's backdrop, wide enough to fill the panel's background behind a blur. */
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/w1280";
/** A show's poster, as wide as the panel's cards show it. */
const TMDB_POSTER = "https://image.tmdb.org/t/p/w500";
/** The image as TMDB has it, which is what a series folder keeps. */
const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original";
/** The smaller copy the panel lays out to choose from, per kind. */
const TMDB_CHOICE: Record<ArtworkKind, string> = {
  poster: "https://image.tmdb.org/t/p/w342",
  backdrop: "https://image.tmdb.org/t/p/w780",
  // Also what the panel shows over the series' banner: sharp at the size it is laid out.
  logo: "https://image.tmdb.org/t/p/w500",
};
/** More than anyone browses; TMDB has hundreds of posters for a long-running show. */
const MAX_CHOICES = 60;

const ImageItem = z.object({
  file_path: z.string(),
  iso_639_1: z.string().nullish(),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  vote_average: z.number().default(0),
});
type ImageItem = z.infer<typeof ImageItem>;

const ImagesBody = z.object({
  posters: z.array(ImageItem).default([]),
  backdrops: z.array(ImageItem).default([]),
  logos: z.array(ImageItem).default([]),
});

export interface TmdbEpisodeGuideOptions {
  /** A v3 API key, or a v4 read access token (a JWT, sent as a bearer token). */
  apiKey: string;
  userAgent: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const ShowBody = z.object({
  backdrop_path: z.string().nullish(),
  images: ImagesBody.nullish(),
  status: z.string().nullish(),
  next_episode_to_air: z
    .object({
      season_number: z.number().int(),
      episode_number: z.number().int(),
      air_date: z.string().nullish(),
    })
    .nullish(),
  seasons: z
    .array(
      z.object({
        season_number: z.number().int(),
        name: z.string().nullish(),
        episode_count: z.number().int().nullish(),
        air_date: z.string().nullish(),
      }),
    )
    .default([]),
});

const MatchBody = z.object({
  name: z.string().nullish(),
  original_name: z.string().nullish(),
  first_air_date: z.string().nullish(),
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  external_ids: z.object({ imdb_id: z.string().nullish() }).nullish(),
});

const SeasonBody = z.object({
  episodes: z
    .array(
      z.object({
        episode_number: z.number().int(),
        name: z.string().nullish(),
        air_date: z.string().nullish(),
        overview: z.string().nullish(),
        runtime: z.number().int().nullish(),
        still_path: z.string().nullish(),
      }),
    )
    .default([]),
});

const yearOf = (date: string | null | undefined): number | null => {
  const match = /^(\d{4})-/.exec(date ?? "");
  return match ? Number(match[1]) : null;
};

/** An image's address, only for a path TMDB's way (`/abc.jpg`): nothing else reaches the panel. */
const imageOf = (base: string, path: string | null | undefined): string | null =>
  path && /^\/[\w-]+\.(jpe?g|png|webp)$/i.test(path) ? `${base}${path}` : null;

/**
 * TMDB's images of one kind, best first: ones in `language` (its first two letters), then English,
 * then without text, then the rest. A backdrop puts the ones without text first: the logo is laid
 * over it, and the name twice reads badly. Within each, TMDB's votes, then the widest. Only the
 * files TMDB's way (`imageOf`).
 */
export function rankArtwork(
  kind: ArtworkKind,
  items: readonly ImageItem[],
  language: string | undefined,
): ArtworkOptionDto[] {
  const own = language?.slice(0, 2).toLowerCase();
  const order =
    kind === "backdrop" ? [null, own, "en"] : ([own, "en", null] as (string | null | undefined)[]);
  const rank = (item: ImageItem) => {
    const at = order.findIndex(
      (wanted) => wanted !== undefined && (item.iso_639_1 ?? null) === wanted,
    );
    return at === -1 ? order.length : at;
  };
  return items
    .filter((item) => imageOf(TMDB_ORIGINAL, item.file_path) !== null)
    .toSorted((a, b) => rank(a) - rank(b) || b.vote_average - a.vote_average || b.width - a.width)
    .slice(0, MAX_CHOICES)
    .map((item) => ({
      url: `${TMDB_ORIGINAL}${item.file_path}`,
      previewUrl: `${TMDB_CHOICE[kind]}${item.file_path}`,
      language: item.iso_639_1 || null,
      width: item.width,
      height: item.height,
    }));
}

/**
 * TMDB's statuses for a show (in English, whatever the language asked for). "Returning Series"
 * only means more is expected, even years after the last episode: whether it airs now is told by
 * the next episode on the calendar.
 */
const STATUSES: Record<string, AiringStatus> = {
  "Returning Series": "returning",
  "In Production": "returning",
  Planned: "returning",
  Pilot: "returning",
  Ended: "ended",
  Canceled: "canceled",
  Cancelled: "canceled",
};

/** TMDB answers a v4 token in the header and a v3 key only in the query. */
const isReadToken = (key: string) => key.startsWith("eyJ");

export class TmdbEpisodeGuide implements EpisodeGuide {
  private readonly options: TmdbEpisodeGuideOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TmdbEpisodeGuideOptions) {
    this.options = options;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async seasons(
    tmdbId: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<GuideSeason[] | null> {
    const body = await this.get(`/tv/${encodeURIComponent(tmdbId)}`, language, signal);
    if (body === null) return null;
    const show = this.parse(ShowBody, body);
    return show.seasons
      .map((season) => ({
        number: season.season_number,
        name: season.name?.trim() || "",
        episodeCount: season.episode_count ?? 0,
        year: yearOf(season.air_date),
      }))
      .sort((a, b) => a.number - b.number);
  }

  async episodes(
    tmdbId: string,
    season: number,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<GuideEpisode[] | null> {
    const path = `/tv/${encodeURIComponent(tmdbId)}/season/${season}`;
    const body = await this.get(path, language, signal);
    if (body === null) return null;
    return this.parse(SeasonBody, body)
      .episodes.map((episode) => ({
        number: episode.episode_number,
        name: episode.name?.trim() || "",
        airDate: episode.air_date || null,
        overview: episode.overview?.trim() || null,
        runtimeMin: episode.runtime ?? null,
        stillUrl: imageOf(TMDB_STILL, episode.still_path),
      }))
      .sort((a, b) => a.number - b.number);
  }

  async show(tmdbId: string, signal?: AbortSignal, language?: string): Promise<GuideShow | null> {
    // Without a language TMDB picks the image it ranks best, text-free or not, and lists the images
    // of every language: the logo is chosen from them.
    const body = await this.get(
      `/tv/${encodeURIComponent(tmdbId)}?append_to_response=images`,
      undefined,
      signal,
    );
    if (body === null) return null;
    const show = this.parse(ShowBody, body);
    const next = show.next_episode_to_air;
    const status = (show.status && STATUSES[show.status]) || null;
    const logo = rankArtwork("logo", show.images?.logos ?? [], language)[0];
    return {
      backdropUrl: imageOf(TMDB_BACKDROP, show.backdrop_path),
      // Its smaller copy is the one the panel shows over the banner.
      logoUrl: logo?.previewUrl ?? null,
      status: status === "returning" && next ? "airing" : status,
      nextEpisode: next
        ? {
            season: next.season_number,
            number: next.episode_number,
            airDate: next.air_date || null,
          }
        : null,
    };
  }

  async artwork(
    tmdbId: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<ArtworkOptionsDto | null> {
    // No language: TMDB then lists the images of every language.
    const body = await this.get(`/tv/${encodeURIComponent(tmdbId)}/images`, undefined, signal);
    if (body === null) return null;
    const images = this.parse(ImagesBody, body);
    return {
      poster: rankArtwork("poster", images.posters, language),
      backdrop: rankArtwork("backdrop", images.backdrops, language),
      logo: rankArtwork("logo", images.logos, language),
    };
  }

  async match(
    tmdbId: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<ShowMatch | null> {
    const body = await this.get(
      `/tv/${encodeURIComponent(tmdbId)}?append_to_response=external_ids`,
      language,
      signal,
    );
    if (body === null) return null;
    const show = this.parse(MatchBody, body);
    const title = show.name?.trim() || show.original_name?.trim();
    if (!title) return null;
    return {
      title,
      year: yearOf(show.first_air_date),
      imdbId: show.external_ids?.imdb_id || null,
      overview: show.overview?.trim() || null,
      posterUrl: imageOf(TMDB_POSTER, show.poster_path),
    };
  }

  /** The JSON TMDB answers, or null for its 404. */
  private async get(
    path: string,
    language: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const { apiKey, userAgent, timeoutMs } = this.options;
    const url = new URL(`${TMDB_API}${path}`);
    if (language) url.searchParams.set("language", language);
    const headers: Record<string, string> = { accept: "application/json", "user-agent": userAgent };
    if (isReadToken(apiKey)) headers["authorization"] = `Bearer ${apiKey}`;
    else url.searchParams.set("api_key", apiKey);
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AppError("upstream", "Could not reach TMDB", { cause: error });
    }
    if (response.status === 404) return null;
    if (response.status === 401) throw new AppError("upstream", "TMDB rejected the API key");
    if (!response.ok) throw new AppError("upstream", `TMDB answered ${response.status}`);
    try {
      return await response.json();
    } catch (error) {
      throw new AppError("upstream", "TMDB did not answer with JSON", { cause: error });
    }
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("upstream", "TMDB answered something unexpected", { cause: parsed.error });
    }
    return parsed.data;
  }
}

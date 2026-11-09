import {
  ExtractorError,
  searchFields,
  normalizeUrl,
  numberingWarnings,
  ownedUrl,
  parseUrl,
  type ExtractedEpisode,
  type Extraction,
  type ExtractionWarning,
  type HttpClient,
  type Mirror,
  type SiteExtractor,
} from "@orca/extractor-core";
import type * as z from "zod";
import { envelope, EpisodeListData, PlayerData, ShowData } from "./schema.ts";
import type { ShowApiSite } from "./site.ts";

/**
 * The site lists every season under the show's one address; H&M reads one season per source, so the
 * season goes in the address as this query parameter (ours, not the site's).
 */
const SEASON_PARAM = "season";
const EPISODE_LIST = "/single/episodes/list";

export interface ShowApiExtractorOptions {
  site: ShowApiSite;
  http: HttpClient;
}

/** The show's name without the year some sites append: `The Show (2026)` → `The Show`. */
const withoutYear = (title: string): string => title.replace(/\s*\(\d{4}\)\s*$/, "").trim();

function yearOf(releaseDate: string | undefined, title: string | undefined): number | undefined {
  const digits =
    /^(\d{4})-/.exec(releaseDate ?? "")?.[1] ?? /\((\d{4})\)\s*$/.exec(title ?? "")?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** What a pasted address asks for: a show, and maybe one of its seasons. */
interface Address {
  slug: string;
  /** The show's address, without query, fragment or trailing slash. */
  show: URL;
  /** Null: the address names no season, and the first one is read. */
  season: number | null;
}

/** The address a season is kept under: the same season always reads the same. */
function seasonUrl(show: URL, season: number): string {
  const url = new URL(show.href);
  url.searchParams.set(SEASON_PARAM, String(season));
  return url.href;
}

/** Changes when the season gains or loses an episode. */
const markerOf = (season: number, total: number): string => `${season}:${total}`;

export function createShowApiExtractor({ site, http }: ShowApiExtractorOptions): SiteExtractor {
  const showPath = new RegExp(site.showPath);
  const headers = site.userAgent ? { "user-agent": site.userAgent } : undefined;
  const referer = `${new URL(site.example).origin}/`;
  /** An image path the API gave, under where the site serves its images. */
  const imageUrl = (path: string): string =>
    /^https?:\/\//.test(path) || !site.images
      ? new URL(path, referer).href
      : `${site.images}/${path.replace(/^\/+/, "")}`;

  async function get<T extends z.ZodType>(
    data: T,
    path: string,
    query: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<z.infer<T>> {
    const url = new URL(`${site.api}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const raw = await http.getJson(url.href, {
      ...(signal ? { signal } : {}),
      ...(headers ? { headers } : {}),
    });
    const loose = raw as { error?: unknown; data?: unknown; message?: unknown } | null;
    if (loose && (loose.error === true || loose.data === null || loose.data === undefined)) {
      const said = typeof loose.message === "string" && loose.message ? `: ${loose.message}` : "";
      throw new ExtractorError("not-found", `${site.name} has nothing at ${path}${said}`);
    }
    const parsed = envelope(data).safeParse(raw);
    if (!parsed.success) {
      throw new ExtractorError(
        "invalid-response",
        `${site.name} answered ${path} in an unknown shape`,
        { cause: parsed.error },
      );
    }
    return (parsed.data as { data: z.infer<T> }).data;
  }

  function addressOf(input: string): Address | null {
    const url = ownedUrl(site.hosts, input);
    if (!url) return null;
    const slug = showPath.exec(url.pathname)?.[1];
    if (!slug) return null;
    const asked = url.searchParams.get(SEASON_PARAM);
    if (asked !== null && !/^\d+$/.test(asked)) return null;
    return {
      slug: decodeURIComponent(slug),
      show: normalizeUrl(url),
      season: asked === null ? null : Number(asked),
    };
  }

  function owned(input: string): Address {
    const address = addressOf(input);
    if (!address) {
      throw new ExtractorError("unsupported-url", `${site.name} does not read this address`);
    }
    return address;
  }

  const show = (slug: string, signal?: AbortSignal) =>
    get(ShowData, "/single/tvshow", { slug, postType: "tvshow" }, signal);

  /** The show's season numbers, in numeric order (the site sends them as text). */
  async function seasonNumbers(showId: number, signal?: AbortSignal): Promise<number[]> {
    const { seasons } = await get(EpisodeListData, EPISODE_LIST, { _id: showId }, signal);
    const numbers = new Set(seasons.map(Number).filter((n) => Number.isInteger(n) && n >= 0));
    return [...numbers].sort((a, b) => a - b);
  }

  /** The season the address names, or the show's first one; refused when the show lacks it. */
  async function pickSeason(
    address: Address,
    showId: number,
    signal?: AbortSignal,
  ): Promise<{ season: number; all: number[] }> {
    const all = await seasonNumbers(showId, signal);
    const season = address.season ?? all[0];
    if (season === undefined) {
      throw new ExtractorError("no-episodes", `No seasons found on ${address.show.href}`);
    }
    if (!all.includes(season)) {
      throw new ExtractorError(
        "not-found",
        `The show has no season ${season}; it has ${all.join(", ") || "none"}`,
      );
    }
    return { season, all };
  }

  const canHandle = (input: string): boolean => addressOf(input) !== null;

  return {
    id: site.id,
    name: site.name,
    hosts: site.hosts,
    example: site.example,
    ...(site.limits ? { limits: site.limits } : {}),
    canHandle,
    ...searchFields(site, http, canHandle),

    async extract(input: string, options?: { signal?: AbortSignal }): Promise<Extraction> {
      const address = owned(input);
      const signal = options?.signal;
      const data = await show(address.slug, signal);
      const { season, all } = await pickSeason(address, data._id, signal);

      // A first page, and the rest in one more request when the season does not fit in it.
      const first = await get(EpisodeListData, EPISODE_LIST, { _id: data._id, season }, signal);
      const total = first.pagination.total;
      const posts =
        first.posts.length >= total
          ? first.posts
          : (
              await get(
                EpisodeListData,
                EPISODE_LIST,
                { _id: data._id, season, postsPerPage: total },
                signal,
              )
            ).posts;

      const warnings: ExtractionWarning[] = [];
      if (address.season === null && all.length > 1) {
        warnings.push({
          code: "season-inferred",
          message: `The address names no season, so season ${season} was read. The show has seasons ${all.join(", ")}: add ?${SEASON_PARAM}=N to the address to read another one.`,
        });
      }
      const episodes: ExtractedEpisode[] = [];
      for (const post of posts) {
        const sourceRef = String(post._id);
        // The list was asked for one season: an episode of another one is the site's mistake.
        if (post.season_number !== season || episodes.some((e) => e.sourceRef === sourceRef)) {
          continue;
        }
        episodes.push({
          season,
          episode: post.episode_number,
          title: post.title ?? `Episode ${post.episode_number}`,
          ...(post.overview ? { plot: post.overview } : {}),
          inferred: false,
          sourceRef,
          media: {
            kind: "mirrors",
            url: `${site.api}/player?postId=${encodeURIComponent(sourceRef)}`,
            fileName: "video",
          },
        });
      }
      if (episodes.length === 0) {
        throw new ExtractorError(
          "no-episodes",
          `No episodes found on ${seasonUrl(address.show, season)}`,
        );
      }
      episodes.sort((a, b) => a.episode - b.episode);
      warnings.push(...numberingWarnings(episodes));

      const title = data.original_title ?? (data.title ? withoutYear(data.title) : address.slug);
      const year = yearOf(data.release_date, data.title);
      if (year === undefined) {
        warnings.push({ code: "year-missing", message: "The site gives no year for this show" });
      }
      const poster = data.images?.poster;
      return {
        series: {
          // One source per season: two seasons of the same show are two addresses, never one.
          externalId: `${data._id}:${season}`,
          sourceUrl: seasonUrl(address.show, season),
          title,
          ...(year !== undefined ? { year } : {}),
          ...(data.overview ? { plot: data.overview } : {}),
          ...(poster ? { posterUrl: imageUrl(poster) } : {}),
          remoteMarker: markerOf(season, total),
        },
        seasons: [{ number: season, episodeCount: episodes.length }],
        episodes,
        license: { kind: "unknown" },
        warnings,
      };
    },

    nextSourceUrl(input: string): string | null {
      const address = addressOf(input);
      // Without a season, the one read is whichever the site lists first: no way to know the next.
      return address?.season == null ? null : seasonUrl(address.show, address.season + 1);
    },

    async seasonSources(input: string, options?: { signal?: AbortSignal }) {
      const address = owned(input);
      const { _id } = await show(address.slug, options?.signal);
      return (await seasonNumbers(_id, options?.signal)).map((season) => ({
        season,
        url: seasonUrl(address.show, season),
      }));
    },

    async remoteMarker(input: string, options?: { signal?: AbortSignal }): Promise<string> {
      const address = owned(input);
      const signal = options?.signal;
      const { _id } = await show(address.slug, signal);
      const season = address.season ?? (await pickSeason(address, _id, signal)).season;
      const { pagination } = await get(
        EpisodeListData,
        EPISODE_LIST,
        { _id, season, postsPerPage: 1 },
        signal,
      );
      return markerOf(season, pagination.total);
    },

    async resolveMirrors(
      episodeUrl: string,
      options?: { signal?: AbortSignal },
    ): Promise<Mirror[]> {
      const url = parseUrl(episodeUrl);
      const postId = url?.searchParams.get("postId");
      if (!url || !url.href.startsWith(`${site.api}/player?`) || !postId) {
        throw new ExtractorError("unsupported-url", `Not a player of ${site.name}: ${episodeUrl}`);
      }
      const { embeds } = await get(PlayerData, "/player", { postId }, options?.signal);
      const wanted = site.languages;
      // Dual audio comes as every track at once (`Latino - Inglés`): ranked by its best one.
      const rank = (lang: string | undefined) => {
        if (!wanted) return 0;
        const tracks = (lang ?? "").split(" - ").map((track) => track.trim());
        const ranks = tracks.map((track) => wanted.indexOf(track)).filter((i) => i >= 0);
        return ranks.length > 0 ? Math.min(...ranks) : -1;
      };
      const seen = new Set<string>();
      return embeds
        .flatMap((embed) => {
          const player = parseUrl(embed.url);
          if (!player || seen.has(player.href) || rank(embed.lang) < 0) return [];
          seen.add(player.href);
          return [{ player, rank: rank(embed.lang) }];
        })
        .sort((a, b) => a.rank - b.rank)
        .map(({ player }) => ({ url: player.href, referer }));
    },
  };
}

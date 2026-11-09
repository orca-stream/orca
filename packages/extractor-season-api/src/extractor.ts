import {
  createSearch,
  ExtractorError,
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
import { SeasonData } from "./schema.ts";
import type { SeasonApiSite, Track } from "./site.ts";

/** Where the API answers a season, under the site's API base. */
const SEASON_PATH = "/series/";
/** The episode an episode's address stands for (ours, not the site's: the API answers a season). */
const EPISODE_PARAM = "episode";
/** The site numbers no seasons: one address is one season, and its target season is picked on adding. */
const SEASON = 1;
const ALL_TRACKS: readonly Track[] = ["sub", "dub"];

export interface SeasonApiExtractorOptions {
  site: SeasonApiSite;
  http: HttpClient;
}

type Episode = SeasonData["episodeList"][number];

/** The first few fields the answer got wrong, by where they are, so a changed site says what changed. */
function problemsOf(error: z.ZodError): string {
  const shown = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(answer)"}: ${issue.message}`);
  const more = error.issues.length - shown.length;
  return more > 0 ? `${shown.join("; ")}; and ${more} more` : shown.join("; ");
}

export function createSeasonApiExtractor({ site, http }: SeasonApiExtractorOptions): SiteExtractor {
  const seasonPath = new RegExp(site.seasonPath);
  const headers = site.userAgent ? { "user-agent": site.userAgent } : undefined;
  // The pages people browse and the API may live on different domains of the same site: the players
  // are embedded in the pages, and the API's own relative addresses are relative to the API.
  const referer = `${new URL(site.example).origin}/`;
  const tracks = site.tracks ?? ALL_TRACKS;
  const seasonApi = (id: string) => `${site.api}${SEASON_PATH}${encodeURIComponent(id)}`;

  /** The season's id and its address without query, fragment or trailing slash; null when not ours. */
  function addressOf(input: string): { id: string; url: URL } | null {
    const url = ownedUrl(site.hosts, input);
    if (!url) return null;
    const id = seasonPath.exec(url.pathname)?.[1];
    if (!id) return null;
    return { id: decodeURIComponent(id), url: normalizeUrl(url) };
  }

  function owned(input: string): { id: string; url: URL } {
    const address = addressOf(input);
    if (!address) {
      throw new ExtractorError("unsupported-url", `${site.name} does not read this address`);
    }
    return address;
  }

  async function season(id: string, signal?: AbortSignal): Promise<SeasonData> {
    const raw = await http.getJson(seasonApi(id), {
      ...(signal ? { signal } : {}),
      ...(headers ? { headers } : {}),
    });
    // The site answers `{ data: season }`; a bare season is read the same.
    const wrapped = raw !== null && typeof raw === "object" && "data" in raw;
    const body: unknown = wrapped ? (raw as { data: unknown }).data : raw;
    if (body === null || body === undefined) {
      const said = (raw as { message?: unknown; error?: unknown } | null) ?? {};
      const why =
        typeof said.message === "string"
          ? said.message
          : typeof said.error === "string"
            ? said.error
            : "";
      throw new ExtractorError(
        "not-found",
        `${site.name} has no season ${id}${why ? `: ${why}` : ""}`,
      );
    }
    const parsed = SeasonData.safeParse(body);
    if (!parsed.success) {
      throw new ExtractorError(
        "invalid-response",
        `${site.name} answered ${id} in an unknown shape (${problemsOf(parsed.error)})`,
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  /** The players of an episode in the wanted tracks, best first: only those the site says it has. */
  function playersOf(episode: Episode): string[] {
    const seen = new Set<string>();
    return tracks.flatMap((track) => {
      const player = episode.available?.[track] ? parseUrl(episode.embed?.[track] ?? "") : null;
      if (!player || seen.has(player.href)) return [];
      seen.add(player.href);
      return [player.href];
    });
  }

  /** Changes when an episode starts or stops having a player in the wanted tracks. */
  const markerOf = (data: SeasonData): string =>
    data.episodeList
      .filter((episode) => playersOf(episode).length > 0)
      .map((episode) => episode.number)
      .sort((a, b) => a - b)
      .join(",");

  const canHandle = (input: string): boolean => addressOf(input) !== null;

  return {
    id: site.id,
    name: site.name,
    hosts: site.hosts,
    example: site.example,
    ...(site.limits ? { limits: site.limits } : {}),
    canHandle,
    ...(site.search
      ? { search: createSearch({ site: { ...site, search: site.search }, http, canHandle }) }
      : {}),

    async extract(input: string, options?: { signal?: AbortSignal }): Promise<Extraction> {
      const address = owned(input);
      const data = await season(address.id, options?.signal);

      const warnings: ExtractionWarning[] = [];
      const episodes: ExtractedEpisode[] = [];
      const silent: number[] = [];
      for (const item of data.episodeList) {
        if (playersOf(item).length === 0) {
          silent.push(item.number);
          continue;
        }
        // Unique across the whole series: its other seasons, from this same site, number from 1 too.
        const sourceRef = `${address.id}:${item.number}`;
        const url = new URL(seasonApi(address.id));
        url.searchParams.set(EPISODE_PARAM, String(item.number));
        const airDate = /^\d{4}-\d{2}-\d{2}/.exec(item.aired ?? "")?.[0];
        episodes.push({
          season: SEASON,
          episode: item.number,
          title: item.title ?? `Episode ${item.number}`,
          ...(airDate ? { airDate } : {}),
          inferred: false,
          sourceRef,
          media: {
            kind: "mirrors",
            url: url.href,
            fileName: "video",
            ...(item.runtimeSeconds ? { durationSec: item.runtimeSeconds } : {}),
          },
        });
      }
      if (silent.length > 0) {
        warnings.push({
          code: "no-video",
          message: `Episodes ${silent.join(", ")} have no player in ${tracks.join(" or ")} yet and were left out`,
        });
      }
      if (episodes.length === 0) {
        throw new ExtractorError("no-episodes", `No episodes found on ${address.url.href}`);
      }
      episodes.sort((a, b) => a.episode - b.episode);
      warnings.push(...numberingWarnings(episodes));
      const year = data.year ?? undefined;
      if (year === undefined) {
        warnings.push({ code: "year-missing", message: "The site gives no year for this season" });
      }

      return {
        series: {
          externalId: address.id,
          sourceUrl: address.url.href,
          title: data.title ?? data.nativeTitle ?? address.id,
          ...(year !== undefined ? { year } : {}),
          ...(data.synopsis ? { plot: data.synopsis } : {}),
          ...(data.poster ? { posterUrl: new URL(data.poster, site.api).href } : {}),
          remoteMarker: markerOf(data),
        },
        seasons: [{ number: SEASON, episodeCount: episodes.length }],
        episodes,
        license: { kind: "unknown" },
        warnings,
      };
    },

    async remoteMarker(input: string, options?: { signal?: AbortSignal }): Promise<string> {
      return markerOf(await season(owned(input).id, options?.signal));
    },

    async resolveMirrors(
      episodeUrl: string,
      options?: { signal?: AbortSignal },
    ): Promise<Mirror[]> {
      const url = parseUrl(episodeUrl);
      const number = url?.searchParams.get(EPISODE_PARAM);
      const id = url?.pathname.startsWith(new URL(`${site.api}${SEASON_PATH}`).pathname)
        ? decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf("/") + 1))
        : undefined;
      if (
        !url ||
        !id ||
        !number ||
        !/^\d+$/.test(number) ||
        url.origin !== new URL(site.api).origin
      ) {
        throw new ExtractorError(
          "unsupported-url",
          `Not an episode of ${site.name}: ${episodeUrl}`,
        );
      }
      // Read when downloading, not when listing: the players may have changed since.
      const data = await season(id, options?.signal);
      const episode = data.episodeList.find((item) => item.number === Number(number));
      if (!episode) {
        throw new ExtractorError("not-found", `${site.name} no longer lists episode ${number}`);
      }
      // An `embed` is an iframe player: opened on its own, it may send the visitor to the show page.
      return playersOf(episode).map((player) => ({ url: player, referer, framed: true }));
    },
  };
}

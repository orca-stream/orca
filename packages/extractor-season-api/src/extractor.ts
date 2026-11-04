import {
  ExtractorError,
  type ExtractedEpisode,
  type Extraction,
  type ExtractionWarning,
  type HttpClient,
  type Mirror,
  type SiteExtractor,
} from "@orca/extractor-core";
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

const ownsHost = (hosts: readonly string[], host: string): boolean =>
  hosts.some((own) => host === own || host.endsWith(`.${own}`));

function parseUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

type Episode = SeasonData["episodeList"][number];

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
    const url = parseUrl(input);
    if (!url || !ownsHost(site.hosts, url.hostname.toLowerCase())) return null;
    const id = seasonPath.exec(url.pathname)?.[1];
    if (!id) return null;
    const clean = new URL(url.href);
    clean.search = "";
    clean.hash = "";
    clean.pathname = clean.pathname.replace(/\/+$/, "") || "/";
    return { id: decodeURIComponent(id), url: clean };
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
    const parsed = SeasonData.safeParse(raw);
    if (!parsed.success) {
      throw new ExtractorError(
        "invalid-response",
        `${site.name} answered ${id} in an unknown shape`,
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

  return {
    id: site.id,
    name: site.name,
    hosts: site.hosts,
    example: site.example,
    ...(site.limits ? { limits: site.limits } : {}),
    canHandle: (input) => addressOf(input) !== null,

    async extract(input: string, options?: { signal?: AbortSignal }): Promise<Extraction> {
      const address = owned(input);
      const data = await season(address.id, options?.signal);

      const warnings: ExtractionWarning[] = [];
      const episodes: ExtractedEpisode[] = [];
      const seen = new Map<number, string[]>();
      const silent: number[] = [];
      for (const item of data.episodeList) {
        if (playersOf(item).length === 0) {
          silent.push(item.number);
          continue;
        }
        const sourceRef = String(item.number);
        const url = new URL(seasonApi(address.id));
        url.searchParams.set(EPISODE_PARAM, sourceRef);
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
        seen.set(item.number, [...(seen.get(item.number) ?? []), sourceRef]);
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
      for (const [number, refs] of seen) {
        if (refs.length > 1) {
          warnings.push({
            code: "duplicate",
            message: `Episode ${number} is listed ${refs.length} times`,
            sourceRefs: refs,
          });
        }
      }
      const numbers = [...seen.keys()];
      const missing: number[] = [];
      for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) {
        if (!seen.has(n)) missing.push(n);
      }
      if (missing.length > 0) {
        warnings.push({ code: "gap", message: `Missing episode numbers: ${missing.join(", ")}` });
      }
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
      return playersOf(episode).map((player) => ({ url: player, referer }));
    },
  };
}

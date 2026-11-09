import {
  ExtractorError,
  normalizeUrl as normalize,
  numberingWarnings,
  ownsHost,
  parseUrl,
  type ExtractedEpisode,
  type Extraction,
  type ExtractionWarning,
  type HttpClient,
  type Mirror,
  type SeasonSource,
  type SiteExtractor,
} from "@orca/extractor-core";
import { parse, type HTMLElement } from "node-html-parser";
import type { Pick, SiteConfig } from "./site.ts";

/** A season spread over more pages than this is a listing gone wrong, not a season. */
const MAX_LISTING_PAGES = 100;

export interface HtmlExtractorOptions {
  site: SiteConfig;
  http: HttpClient;
}

/** Every value `pick` reads on the page, in page order; empty ones left out. */
function readAll(root: HTMLElement, pick: Pick): string[] {
  return root
    .querySelectorAll(pick.selector)
    .map((element) =>
      pick.attribute === undefined ? element.textContent : element.getAttribute(pick.attribute),
    )
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value) => value !== "");
}

/** An address a page wrote (maybe relative), made absolute against the page; null if it is no web address. */
function resolveOn(page: URL, value: string): URL | null {
  try {
    const url = new URL(value, page);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The number a pattern finds in a path (its first group, or the whole match), and where it is. */
function numberIn(
  path: string,
  pattern: RegExp,
): { value: number; start: number; end: number } | null {
  const match = pattern.exec(path);
  if (!match) return null;
  const [start, end] = match.indices?.[1] ?? match.indices?.[0] ?? [];
  const digits = match[1] ?? match[0];
  if (start === undefined || end === undefined || !/^\d+$/.test(digits)) return null;
  return { value: Number(digits), start, end };
}

/** What a mirror attribute holds once `decode` undid how the site wrote it; null if it can't be undone. */
function decoded(value: string, decode: "base64" | undefined): string | null {
  if (decode === undefined) return value;
  try {
    return atob(value).trim();
  } catch {
    return null;
  }
}

/** A readable title from the last piece of the path: `my-show` → `my show`. */
function titleFromPath(url: URL): string {
  const last =
    url.pathname
      .split("/")
      .filter((part) => part !== "")
      .at(-1) ?? url.hostname;
  return decodeURIComponent(last)
    .replace(/[-_.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createHtmlExtractor({ site, http }: HtmlExtractorOptions): SiteExtractor {
  const getText = http.getText?.bind(http);
  if (!getText) throw new Error("The HTML extractor needs an HttpClient that reads pages");
  const headers = site.userAgent ? { "user-agent": site.userAgent } : undefined;
  const seasonPath = site.seasonPath === undefined ? null : new RegExp(site.seasonPath);
  const LAST_NUMBER = /(\d+)(?!.*\d)/d;
  const numberPattern =
    site.listing.number === undefined ? LAST_NUMBER : new RegExp(site.listing.number, "d");
  const seasons = site.seasons;
  const showPath = seasons ? new RegExp(seasons.showPath) : null;
  const showFrom = seasons ? new RegExp(seasons.show.from) : null;
  const seasonNumberPattern =
    seasons?.number === undefined ? LAST_NUMBER : new RegExp(seasons.number, "d");

  async function load(url: URL, signal?: AbortSignal, referer?: URL): Promise<HTMLElement> {
    const html = await getText!(url.href, {
      ...(signal ? { signal } : {}),
      ...(headers || referer
        ? { headers: { ...headers, ...(referer ? { referer: referer.href } : {}) } }
        : {}),
    });
    return parse(html);
  }

  function episodeNumber(url: URL): number | null {
    return numberIn(decodeURIComponent(url.pathname), numberPattern)?.value ?? null;
  }

  /** The number of the season at this address, when the site says how its seasons are numbered. */
  function seasonNumber(url: URL): number | null {
    return seasons ? (numberIn(url.pathname, seasonNumberPattern)?.value ?? null) : null;
  }

  const isShow = (url: URL): boolean => showPath?.test(normalize(url).pathname) ?? false;

  /** The show page a season belongs to, from the season's address alone. */
  function showOf(season: URL): URL | null {
    const match = showFrom?.exec(normalize(season).pathname);
    if (!seasons || !match) return null;
    const path = seasons.show.to.replace(
      /\{(\d+)\}/g,
      (_, group: string) => match[Number(group)] ?? "",
    );
    const show = resolveOn(season, path);
    return show && normalize(show);
  }

  /** The seasons a show page lists, lowest first, each at its normalized address. */
  async function listSeasons(show: URL, signal?: AbortSignal): Promise<SeasonSource[]> {
    const root = await load(show, signal);
    const found = new Map<number, string>();
    for (const value of readAll(root, seasons!.links)) {
      const url = resolveOn(show, value);
      if (!url || !ownsHost(site.hosts, url.hostname.toLowerCase())) continue;
      const season = normalize(url);
      const number = seasonNumber(season);
      if (number !== null && !found.has(number)) found.set(number, season.href);
    }
    return [...found].sort(([a], [b]) => a - b).map(([season, url]) => ({ season, url }));
  }

  /** The pages that hold the season's episodes: the season page itself, or the ones it lists. */
  async function listingPages(season: URL, root: HTMLElement): Promise<URL[]> {
    const pages = site.listing.pages;
    if (!pages) return [season];
    const values = [...new Set(readAll(root, pages))];
    if (values.length === 0) return [season];
    if (values.length > MAX_LISTING_PAGES) {
      throw new ExtractorError("invalid-response", `The season lists ${values.length} pages`);
    }
    const base = season.href.replace(/\/+$/, "");
    return values.flatMap((value) => {
      const address = pages.path
        .replaceAll("{url}", base)
        .replaceAll("{value}", encodeURIComponent(value));
      const url = resolveOn(season, address);
      return url ? [url] : [];
    });
  }

  function canHandle(input: string): boolean {
    const url = parseUrl(input);
    if (!url || !ownsHost(site.hosts, url.hostname.toLowerCase())) return false;
    return seasonPath === null || seasonPath.test(normalize(url).pathname) || isShow(url);
  }

  return {
    id: site.id,
    name: site.name,
    hosts: site.hosts,
    example: site.example,
    ...(site.limits ? { limits: site.limits } : {}),
    canHandle,

    async extract(input: string, options?: { signal?: AbortSignal }): Promise<Extraction> {
      const parsed = parseUrl(input);
      if (!parsed || !canHandle(input)) {
        throw new ExtractorError("unsupported-url", `${site.name} does not read this address`);
      }
      const signal = options?.signal;
      let season = normalize(parsed);
      // A show stands for its first season: one source is always one season.
      if (isShow(season)) {
        const [first] = await listSeasons(season, signal);
        if (!first) throw new ExtractorError("no-episodes", `No seasons found on ${season.href}`);
        season = new URL(first.url);
      }
      const seasonNo = seasonNumber(season) ?? 1;
      const root = await load(season, signal);

      const links: URL[] = [];
      const titles = new Map<string, string>();
      for (const page of await listingPages(season, root)) {
        const listing = page.href === season.href ? root : await load(page, signal, season);
        for (const element of listing.querySelectorAll(site.listing.episodes.selector)) {
          const value = element.getAttribute(site.listing.episodes.attribute)?.trim();
          const url = value ? resolveOn(page, value) : null;
          // The server reads each episode page later: a link to another host is not this site's.
          if (!url || !ownsHost(site.hosts, url.hostname.toLowerCase())) continue;
          const key = normalize(url).href;
          if (titles.has(key)) continue;
          const titlePick = site.listing.episodes.title;
          const title = titlePick ? readAll(element, titlePick)[0] : undefined;
          titles.set(key, title ?? "");
          links.push(normalize(url));
        }
      }

      const warnings: ExtractionWarning[] = [];
      const unnumbered = links.filter((url) => episodeNumber(url) === null);
      if (unnumbered.length > 0) {
        warnings.push({
          code: "no-video",
          message: `${unnumbered.length} links have no episode number in their address and were left out`,
        });
      }
      const episodes: ExtractedEpisode[] = links.flatMap((url) => {
        const number = episodeNumber(url);
        if (number === null) return [];
        const title = titles.get(url.href) || `Episode ${number}`;
        return [
          {
            season: seasonNo,
            episode: number,
            title,
            inferred: false,
            sourceRef: url.pathname,
            media: { kind: "mirrors", url: url.href, fileName: "video" },
          },
        ];
      });
      if (episodes.length === 0) {
        throw new ExtractorError("no-episodes", `No episodes found on ${season.href}`);
      }
      episodes.sort((a, b) => a.episode - b.episode);

      warnings.push(...numberingWarnings(episodes));

      const title =
        (site.title ? readAll(root, site.title)[0] : undefined) ?? titleFromPath(season);
      return {
        series: { externalId: season.pathname, sourceUrl: season.href, title },
        seasons: [{ number: seasonNo, episodeCount: episodes.length }],
        episodes,
        license: { kind: "unknown" },
        warnings,
      };
    },

    ...(seasons
      ? {
          nextSourceUrl(input: string): string | null {
            const url = parseUrl(input);
            if (!url || !canHandle(input) || isShow(url)) return null;
            const season = normalize(url);
            const at = numberIn(season.pathname, seasonNumberPattern);
            if (!at) return null;
            const path = season.pathname;
            season.pathname = `${path.slice(0, at.start)}${at.value + 1}${path.slice(at.end)}`;
            return season.href;
          },

          async seasonSources(
            input: string,
            options?: { signal?: AbortSignal },
          ): Promise<SeasonSource[]> {
            const url = parseUrl(input);
            const show =
              url && canHandle(input) ? (isShow(url) ? normalize(url) : showOf(url)) : null;
            if (!show) {
              throw new ExtractorError("unsupported-url", `${site.name} has no show for ${input}`);
            }
            return listSeasons(show, options?.signal);
          },
        }
      : {}),

    async resolveMirrors(
      episodeUrl: string,
      options?: { signal?: AbortSignal },
    ): Promise<Mirror[]> {
      const page = parseUrl(episodeUrl);
      if (!page) throw new ExtractorError("unsupported-url", `Not a web address: ${episodeUrl}`);
      const root = await load(page, options?.signal);
      const seen = new Set<string>();
      const mirrors: Mirror[] = [];
      const { decode, unwrap } = site.mirrors;
      for (const value of readAll(root, site.mirrors)) {
        const written = decoded(value, decode);
        const url = written === null ? null : resolveOn(page, written);
        if (!url) continue;
        // A wrapper only frames the player: the player is what the browser opens, framed by it.
        const inner = unwrap ? parseUrl(url.searchParams.get(unwrap) ?? "") : null;
        const mirror = inner
          ? { url: inner.href, referer: url.href }
          : { url: url.href, referer: page.href };
        if (seen.has(mirror.url)) continue;
        seen.add(mirror.url);
        mirrors.push(mirror);
      }
      return mirrors;
    },
  };
}

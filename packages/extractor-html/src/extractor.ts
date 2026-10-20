import {
  ExtractorError,
  type ExtractedEpisode,
  type Extraction,
  type ExtractionWarning,
  type HttpClient,
  type Mirror,
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

const ownsHost = (hosts: readonly string[], host: string): boolean =>
  hosts.some((own) => host === own || host.endsWith(`.${own}`));

/** The address without query, fragment or trailing slash: the same season always reads the same. */
function normalize(url: URL): URL {
  const clean = new URL(url.href);
  clean.search = "";
  clean.hash = "";
  clean.pathname = clean.pathname.replace(/\/+$/, "") || "/";
  return clean;
}

function parseUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
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
  const numberPattern = site.listing.number === undefined ? null : new RegExp(site.listing.number);

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
    const path = decodeURIComponent(url.pathname);
    const match = numberPattern ? numberPattern.exec(path) : /(\d+)(?!.*\d)/.exec(path);
    const digits = match?.[1] ?? match?.[0];
    if (digits === undefined || !/^\d+$/.test(digits)) return null;
    return Number(digits);
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
    return seasonPath === null || seasonPath.test(normalize(url).pathname);
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
      const season = normalize(parsed);
      const signal = options?.signal;
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
            season: 1,
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

      const seen = new Map<number, string[]>();
      for (const episode of episodes) {
        seen.set(episode.episode, [...(seen.get(episode.episode) ?? []), episode.sourceRef]);
      }
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

      const title =
        (site.title ? readAll(root, site.title)[0] : undefined) ?? titleFromPath(season);
      return {
        series: { externalId: season.pathname, sourceUrl: season.href, title },
        seasons: [{ number: 1, episodeCount: episodes.length }],
        episodes,
        license: { kind: "unknown" },
        warnings,
      };
    },

    async resolveMirrors(
      episodeUrl: string,
      options?: { signal?: AbortSignal },
    ): Promise<Mirror[]> {
      const page = parseUrl(episodeUrl);
      if (!page) throw new ExtractorError("unsupported-url", `Not a web address: ${episodeUrl}`);
      const root = await load(page, options?.signal);
      const seen = new Set<string>();
      const mirrors: Mirror[] = [];
      for (const value of readAll(root, site.mirrors)) {
        const url = resolveOn(page, value);
        if (!url || seen.has(url.href)) continue;
        seen.add(url.href);
        mirrors.push({ url: url.href, referer: page.href });
      }
      return mirrors;
    },
  };
}

import type { JsonSearch, SiteBase } from "./site.ts";
import {
  ExtractorError,
  type HttpClient,
  type SearchResult,
  type SearchResultKind,
  type SiteExtractor,
} from "./types.ts";
import { parseUrl } from "./url.ts";

/** More than this many results is a list nobody reads: the best ones are kept. */
const MAX_RESULTS = 120;
/** A paged search reads no more than this many pages: the rest are rarely what was meant. */
const MAX_PAGES = 5;
const PAGE_SLOT = "{page}";
const SLOT = /\{([^{}]+)\}/g;
const YEAR = /\d{4}/;

export interface SearchOptions {
  site: Pick<SiteBase, "name" | "example" | "userAgent"> & { search: JsonSearch };
  http: HttpClient;
  /** The extractor's own test: a result it would not read is never offered. */
  canHandle: (url: string) => boolean;
}

/** The value at `path` (`images.poster`) inside `item`, or undefined. */
function at(item: unknown, path: string): unknown {
  let value = item;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const FILTER = /^(.*?):slug(?:\((\d+)\))?$/s;
const QUOTED = /^'(.*)'$/s;

/** As an address writes a name: lower case, without accents, a dash for anything else. */
function slugOf(text: string, length?: number): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return length === undefined ? slug : slug.slice(0, length).replace(/-+$/g, "");
}

/** What one slot writes for `item`: its first field (or quoted word) that has something. */
function slotOf(slot: string, item: unknown): string {
  const filtered = FILTER.exec(slot);
  const choices = (filtered ? filtered[1]! : slot).split("|");
  const length = filtered?.[2] === undefined ? undefined : Number(filtered[2]);
  for (const choice of choices) {
    const name = choice.trim();
    const quoted = QUOTED.exec(name);
    const value = quoted ? quoted[1] : at(item, name);
    let written =
      typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (filtered) written = slugOf(written, length);
    if (written !== "") return written;
  }
  return "";
}

/** The template with every slot filled in from `item`; undefined when a slot has nothing. */
function fill(template: string | undefined, item: unknown): string | undefined {
  if (template === undefined) return undefined;
  let missing = false;
  const text = template.replace(SLOT, (_, slot: string) => {
    const written = slotOf(slot, item);
    if (written === "") missing = true;
    return written;
  });
  return missing || text.trim() === "" ? undefined : text.trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Text as it reads: a site may answer a title or a plot in HTML (`<br>`, `&amp;`). */
function readable(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const plainText = text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
  return plainText === "" ? undefined : plainText;
}

/** The body with `{query}` and `{page}` filled in: a text that is just `{page}` becomes a number. */
function bodyOf(body: unknown, query: string, page: number): unknown {
  if (typeof body === "string") {
    if (body === PAGE_SLOT) return page;
    return body.replaceAll("{query}", query).replaceAll(PAGE_SLOT, String(page));
  }
  if (Array.isArray(body)) return body.map((value) => bodyOf(value, query, page));
  if (body !== null && typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, bodyOf(value, query, page)]),
    );
  }
  return body;
}

/** Lower case, without accents or punctuation: how titles are compared. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** 0 the same title, 1 starts with it, 2 a word starts with it, 3 has it, 4 none of those. */
function closeness(title: string, query: string): number {
  const text = plain(title);
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (` ${text}`.includes(` ${query}`)) return 2;
  return text.includes(query) ? 3 : 4;
}

/**
 * The results best match first, by their title or original title against what was typed. Sites
 * answer in their own order (often the latest updated first), which is no order for a name.
 */
export function rankByTitle<T extends Pick<SearchResult, "title" | "originalTitle">>(
  results: readonly T[],
  query: string,
): T[] {
  const wanted = plain(query);
  const score = (result: T) =>
    Math.min(
      closeness(result.title, wanted),
      result.originalTitle ? closeness(result.originalTitle, wanted) : 4,
    );
  return results
    .map((result, index) => ({ result, index, score: score(result) }))
    .toSorted((a, b) => a.score - b.score || a.index - b.index)
    .map(({ result }) => result);
}

/** A search described in the site's file, asked through its JSON API. */
export function createSearch({ site, http, canHandle }: SearchOptions) {
  const config = site.search;
  const origin = new URL(site.example).origin;
  const headers = site.userAgent ? { "user-agent": site.userAgent } : undefined;

  function kindOf(item: unknown): SearchResultKind | null {
    if (!config.type) return "series";
    const word = fill(config.type.from, item);
    if (word === undefined) return null;
    if (config.type.series.includes(word)) return "series";
    return config.type.movie?.includes(word) ? "movie" : null;
  }

  function resultOf(item: unknown): SearchResult | null {
    const kind = kindOf(item);
    const path = kind && fill(config.result.url[kind], item);
    const title = readable(fill(config.result.title, item));
    if (!kind || !path || !title) return null;
    const url = parseUrl(new URL(path, origin).href);
    if (!url || !canHandle(url.href)) return null;
    const originalTitle = readable(fill(config.result.originalTitle, item));
    const year = YEAR.exec(fill(config.result.year, item) ?? "")?.[0];
    const plot = readable(fill(config.result.plot, item));
    const poster = fill(config.result.poster, item);
    const posterUrl = poster === undefined ? null : parseUrl(new URL(poster, origin).href);
    return {
      kind,
      url: url.href,
      title,
      ...(originalTitle && plain(originalTitle) !== plain(title) ? { originalTitle } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(plot ? { plot } : {}),
      ...(posterUrl ? { posterUrl: posterUrl.href } : {}),
    };
  }

  return async function search(
    query: string,
    options?: { signal?: AbortSignal },
  ): Promise<SearchResult[]> {
    const typed = query.trim();
    if (typed === "") return [];
    const { body } = config;
    const address = body ? config.url : config.url.replaceAll("{query}", encodeURIComponent(typed));
    const paged = (body ? `${address}${JSON.stringify(body)}` : address).includes(PAGE_SLOT);
    const post = http.postJson?.bind(http);
    if (body && !post) {
      throw new ExtractorError(
        "network",
        `${site.name} is searched by POST, which this server can't send`,
      );
    }
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    const asked = {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(headers ? { headers } : {}),
    };
    // One page after another, never at once: the site's limits hold for its search too.
    for (let page = 1; page <= (paged ? MAX_PAGES : 1); page++) {
      const pageAddress = address.replaceAll(PAGE_SLOT, String(page));
      const answer =
        body && post
          ? await post(pageAddress, bodyOf(body, typed, page), asked)
          : await http.getJson(pageAddress, asked);
      const items = config.items === undefined ? answer : at(answer, config.items);
      if (!Array.isArray(items)) {
        throw new ExtractorError(
          "invalid-response",
          `${site.name} answered the search without a list at ${config.items ?? "its top"}`,
        );
      }
      for (const item of items) {
        const result = resultOf(item);
        if (!result || seen.has(result.url)) continue;
        seen.add(result.url);
        results.push(result);
      }
      const last = config.lastPage === undefined ? undefined : Number(at(answer, config.lastPage));
      const more = config.nextPage === undefined || at(answer, config.nextPage) === true;
      if (
        items.length === 0 ||
        !more ||
        (last !== undefined && Number.isFinite(last) && page >= last)
      )
        break;
    }
    return rankByTitle(results, typed).slice(0, MAX_RESULTS);
  };
}

/**
 * The search fields of an extractor whose site's file describes one (its search, and the hosts its
 * posters may come from); none when it doesn't.
 */
export function searchFields(
  site: Pick<SiteBase, "name" | "example" | "userAgent" | "search">,
  http: HttpClient,
  canHandle: (url: string) => boolean,
): Pick<SiteExtractor, "search" | "posterHosts"> {
  const config = site.search;
  if (!config) return {};
  return {
    search: createSearch({ site: { ...site, search: config }, http, canHandle }),
    ...(config.posterHosts ? { posterHosts: config.posterHosts } : {}),
  };
}

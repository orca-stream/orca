import type { JsonSearch, SiteBase } from "./site.ts";
import {
  ExtractorError,
  type HttpClient,
  type SearchResult,
  type SearchResultKind,
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

/** The template with every slot filled in from `item`; undefined when a slot has nothing. */
function fill(template: string | undefined, item: unknown): string | undefined {
  if (template === undefined) return undefined;
  let missing = false;
  const text = template.replace(SLOT, (_, path: string) => {
    const value = at(item, path.trim());
    const written = typeof value === "string" || typeof value === "number" ? String(value) : "";
    if (written.trim() === "") missing = true;
    return written.trim();
  });
  return missing || text.trim() === "" ? undefined : text.trim();
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
    const title = fill(config.result.title, item);
    if (!kind || !path || !title) return null;
    const url = parseUrl(new URL(path, origin).href);
    if (!url || !canHandle(url.href)) return null;
    const originalTitle = fill(config.result.originalTitle, item);
    const year = YEAR.exec(fill(config.result.year, item) ?? "")?.[0];
    const plot = fill(config.result.plot, item);
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
    const address = config.url.replaceAll("{query}", encodeURIComponent(typed));
    const paged = address.includes(PAGE_SLOT);
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    // One page after another, never at once: the site's limits hold for its search too.
    for (let page = 1; page <= (paged ? MAX_PAGES : 1); page++) {
      const answer = await http.getJson(address.replaceAll(PAGE_SLOT, String(page)), {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(headers ? { headers } : {}),
      });
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
      if (items.length === 0 || (last !== undefined && Number.isFinite(last) && page >= last))
        break;
    }
    return rankByTitle(results, typed).slice(0, MAX_RESULTS);
  };
}

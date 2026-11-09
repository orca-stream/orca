import type { LicenseKind } from "./license.ts";

/** The only way an extractor reaches the network. Tests answer from fixtures. */
export interface HttpClient {
  /** `headers` (a browser's User-Agent) go with the request. */
  getJson(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<unknown>;
  /**
   * The JSON answer to `body`, sent as JSON by POST (a GraphQL query). Optional: only a search
   * described with a `body` needs it.
   */
  postJson?(
    url: string,
    body: unknown,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<unknown>;
  /**
   * The body of a web page as text. `headers` (a Referer, a browser's User-Agent) go with the
   * request. Optional: an extractor that reads only JSON never needs it.
   */
  getText?(
    url: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<string>;
}

export type ExtractorErrorCode =
  | "unsupported-url"
  | "not-found"
  | "invalid-response"
  | "no-episodes"
  | "network";

/** An extraction failed in a way the panel can explain. */
export class ExtractorError extends Error {
  readonly code: ExtractorErrorCode;
  /** From a `Retry-After` header, when the site asked us to wait. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ExtractorErrorCode,
    message: string,
    options?: ErrorOptions & { retryAfterMs?: number },
  ) {
    super(message, options);
    this.name = "ExtractorError";
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * A file that can be fetched with a plain HTTP GET (Range supported). With kind `page`, `url` is
 * the address of a web page that plays the video: the server finds the stream on it with a browser
 * when it downloads, and `fileName` is only a placeholder. With kind `mirrors`, `url` is the
 * episode's page, which lists several players of the same video (`SiteExtractor.resolveMirrors`):
 * the server picks one when it downloads, and moves on to the next when it fails.
 */
export interface DirectMedia {
  kind: "direct" | "page" | "mirrors";
  url: string;
  fileName: string;
  sizeBytes?: number;
  md5?: string;
  durationSec?: number;
  format?: string;
  height?: number;
}

export interface ExtractedSeries {
  /** The site's own id for the show. */
  externalId: string;
  /** Where the user pasted from, normalized. */
  sourceUrl: string;
  title: string;
  year?: number;
  plot?: string;
  /** A cover image to fetch, when the site has one. */
  posterUrl?: string;
  /** Changes when the remote item changes; lets a later check skip an unchanged series. */
  remoteMarker?: string;
}

export interface ExtractedEpisode {
  season: number;
  episode: number;
  title: string;
  plot?: string;
  /** yyyy-mm-dd; left out when unknown, never invented. */
  airDate?: string;
  /** The season or the number was guessed (neighbours, or file order), not read from a name. */
  inferred: boolean;
  /** Stable id inside the series, e.g. `item/file.mp4`. */
  sourceRef: string;
  media: DirectMedia;
}

export interface ExtractedLicense {
  kind: LicenseKind;
  url?: string;
}

export type ExtractionWarningCode =
  | "season-inferred"
  | "numbering-inferred"
  | "gap"
  | "duplicate"
  | "compilation"
  | "multiple-videos"
  | "no-video"
  | "license-unknown"
  | "license-recent"
  | "year-missing";

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  message: string;
  /** The episodes (by `sourceRef`) the warning is about, when it is about some. */
  sourceRefs?: string[];
}

export interface ExtractedSeason {
  number: number;
  episodeCount: number;
}

export interface Extraction {
  series: ExtractedSeries;
  seasons: ExtractedSeason[];
  episodes: ExtractedEpisode[];
  license: ExtractedLicense;
  warnings: ExtractionWarning[];
  /** The episode the pasted URL pointed at, when it named a file. */
  selectedSourceRef?: string;
}

/** How hard the extractor's hosts may be hit; the server enforces it, and config can override it. */
export interface ExtractorLimits {
  /** Requests per second for metadata calls (JSON). May be below 1: `0.5` is one every 2 s. */
  metadataPerSec: number;
  /** Simultaneous file downloads from one host. */
  downloadsPerHost: number;
  /** Connections one file is fetched over. Absent: whatever the server is configured with. */
  connectionsPerDownload?: number;
}

export interface ExtractorInfo {
  id: string;
  name: string;
  hosts: string[];
  example: string;
}

/** A season a site lists for a show, and the address it is read at. */
export interface SeasonSource {
  season: number;
  url: string;
}

/** One player of an episode, on whichever host serves it. */
export interface Mirror {
  /** The player's page: the browser opens it and records the stream it plays. */
  url: string;
  /** The page the player is embedded in, sent as the Referer when the browser opens it. */
  referer?: string;
  /** The player only plays inside an iframe: the browser opens it in one, on the referer's origin. */
  framed?: boolean;
}

/** What a site holds: H&M reads series; movies are kept apart for when it reads them too. */
export type SearchResultKind = "series" | "movie";

/** Something a site's search found, at the address its extractor reads it from. */
export interface SearchResult {
  kind: SearchResultKind;
  /** An address `canHandle` claims, to be read the way a pasted one is. */
  url: string;
  title: string;
  /** The name it first aired with, when the site gives one that differs from the title. */
  originalTitle?: string;
  year?: number;
  plot?: string;
  posterUrl?: string;
}

/** The port every site implements. */
export interface SiteExtractor extends ExtractorInfo {
  /** True when the extractor must be chosen by the user: `canHandle` never claims an address. */
  explicitOnly?: boolean;
  /** Politeness limits for the hosts above. Absent: the server's defaults. */
  limits?: ExtractorLimits;
  /** Pure: says whether this extractor owns the URL, without touching the network. */
  canHandle(url: string): boolean;
  extract(url: string, options?: { signal?: AbortSignal }): Promise<Extraction>;
  /**
   * A cheap fingerprint of the series on the site (one or two small requests, never the episodes).
   * It must equal `extract(url).series.remoteMarker` while nothing changed, and differ once
   * something did. Optional: an extractor without it is re-extracted on every check.
   */
  remoteMarker?(url: string, options?: { signal?: AbortSignal }): Promise<string>;
  /**
   * Pure: the address that most likely comes after this one on the same site (its next season), so
   * adding another source can start from it. Null or absent: nothing to suggest.
   */
  nextSourceUrl?(url: string): string | null;
  /**
   * Every season the site lists for the show this address is part of, lowest first, each under the
   * address `extract` keeps it at (its `sourceUrl`). A followed series reads it to find the seasons
   * the site has that none of its sources reads yet. Absent: the site can't say.
   */
  seasonSources?(url: string, options?: { signal?: AbortSignal }): Promise<SeasonSource[]>;
  /**
   * Pure: the address of the show this one is part of (a season's, its show's), so a season added
   * long ago is known as the show a search finds. Null or absent: the address stands for itself.
   */
  showUrl?(url: string): string | null;
  /**
   * The players an episode page of kind `mirrors` offers, in the site's order. Read when the episode
   * is downloaded, not when it is listed: the addresses may expire. Required for `mirrors` media.
   */
  resolveMirrors?(episodeUrl: string, options?: { signal?: AbortSignal }): Promise<Mirror[]>;
  /**
   * What the site finds by a name, best match first. Every result's address is one this extractor
   * reads. Absent: the site can't be searched, only pasted from.
   */
  search?: (query: string, options?: { signal?: AbortSignal }) => Promise<SearchResult[]>;
  /** The hosts the search's posters may come from besides `hosts`. Absent: only `hosts`. */
  posterHosts?: readonly string[];
}

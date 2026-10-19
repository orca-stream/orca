import type { LicenseKind } from "./license.ts";

/** The only way an extractor reaches the network: JSON in, JSON out. Tests answer from fixtures. */
export interface HttpClient {
  getJson(url: string, options?: { signal?: AbortSignal }): Promise<unknown>;
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

  constructor(code: ExtractorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractorError";
    this.code = code;
  }
}

/** A file that can be fetched with a plain HTTP GET (Range supported). */
export interface DirectMedia {
  kind: "direct";
  url: string;
  fileName: string;
  sizeBytes?: number;
  md5?: string;
  durationSec?: number;
  format?: string;
  height?: number;
}

export interface ExtractedSeries {
  /** The site's own id for the show (for Internet Archive, the item or collection identifier). */
  externalId: string;
  /** Where the user pasted from, normalized. */
  sourceUrl: string;
  title: string;
  year?: number;
  plot?: string;
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
  /** Needs the "I have the right to download this" confirmation before it can be added. */
  requiresAck: boolean;
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

export interface ExtractorInfo {
  id: string;
  name: string;
  hosts: string[];
  example: string;
}

/** The port every site (Internet Archive today, others later) implements. */
export interface SiteExtractor extends ExtractorInfo {
  /** Pure: says whether this extractor owns the URL, without touching the network. */
  canHandle(url: string): boolean;
  extract(url: string, options?: { signal?: AbortSignal }): Promise<Extraction>;
}

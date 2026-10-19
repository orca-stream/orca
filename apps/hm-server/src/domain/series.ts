import type { EpisodeStatus } from "@orca/hm-contract";

/** Where the bytes of an episode come from. `page` needs the StreamDetector to find a stream first. */
export type Source =
  | {
      kind: "direct";
      url: string;
      fileName: string;
      sizeBytes?: number;
      md5?: string;
      durationSec?: number;
    }
  | { kind: "hls"; url: string; headers?: Record<string, string>; durationSec?: number }
  | { kind: "page"; url: string };

export interface Series {
  id: string;
  title: string;
  year: number | null;
  plot: string | null;
  extractorId: string;
  externalId: string;
  sourceUrl: string;
  /** Folder under MEDIA_ROOT, e.g. `The Beverly Hillbillies (1962)`. */
  folderName: string;
  hasPoster: boolean;
  follow: boolean;
  checkIntervalHours: number;
  lastCheckedAt: number | null;
  remoteMarker: string | null;
  createdAt: number;
}

export interface Episode {
  id: string;
  seriesId: string;
  season: number;
  episode: number;
  title: string;
  plot: string | null;
  airDate: string | null;
  inferred: boolean;
  /** Stable id inside the series; what a re-check matches episodes by. */
  sourceRef: string;
  source: Source;
  durationSec: number | null;
  sizeBytes: number | null;
  format: string | null;
  status: EpisodeStatus;
  /** Path of the file under MEDIA_ROOT once it is in the library. */
  filePath: string | null;
  createdAt: number;
}

/** `S01E02`. */
export function episodeCode(season: number, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `S${pad(season)}E${pad(episode)}`;
}

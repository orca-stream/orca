import type { IaFile } from "./schema.ts";

const VIDEO_EXTENSION = /\.(mp4|m4v|mkv|avi|mpe?g|ogv|mov|wmv|webm|flv|divx|ts|m2ts)$/i;
const IGNORED_FORMATS = new Set(
  [
    "Thumbnail",
    "Metadata",
    "Item Tile",
    "JPEG Thumb",
    "Animated GIF",
    "Archive BitTorrent",
    "Text",
    "Web Video Text Tracks",
  ].map((format) => format.toLowerCase()),
);

export interface VideoGroup {
  /** The original file every candidate comes from (or the only file there is). */
  key: string;
  candidates: IaFile[];
  best: IaFile;
  /** Seconds, from the chosen file or else from any candidate. */
  durationSec: number | undefined;
}

function isVideo(file: IaFile): boolean {
  const format = file.format?.toLowerCase();
  return VIDEO_EXTENSION.test(file.name) && !(format && IGNORED_FORMATS.has(format));
}

/**
 * Lower is better:
 * 1. an mp4 or mkv original, 2. the h.264 derivative (what to use when the original is MPEG1, an
 * AVI or an m4v Jellyfin would have to transcode), 3. any other original, 4. the legacy 512Kb
 * MPEG4, 5. Ogg Video, 6. whatever else is left.
 */
function tier(file: IaFile): number {
  const format = file.format?.toLowerCase();
  if (file.source === "original" && /\.(mp4|mkv)$/i.test(file.name)) return 1;
  if (format === "h.264") return 2;
  if (file.source === "original") return 3;
  if (format === "512kb mpeg4") return 4;
  if (format === "ogg video") return 5;
  return 6;
}

function compare(a: IaFile, b: IaFile): number {
  return tier(a) - tier(b) || (b.height ?? 0) - (a.height ?? 0) || (b.size ?? 0) - (a.size ?? 0);
}

/** One group per video: the original and its derivatives, with the file worth downloading picked. */
export function videoGroups(files: readonly IaFile[]): VideoGroup[] {
  const groups = new Map<string, IaFile[]>();
  for (const file of files) {
    if (!isVideo(file)) continue;
    const key = file.original ?? file.name;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return [...groups].map(([key, candidates]) => {
    const best = [...candidates].sort(compare)[0] as IaFile;
    const durationSec = best.length ?? candidates.find((file) => file.length !== undefined)?.length;
    return { key, candidates, best, durationSec };
  });
}

import type { ArtworkKind } from "@orca/hm-contract";

/** TMDB's image host: the only one a series' artwork is fetched from by address. */
export const TMDB_IMAGE_HOSTS = ["image.tmdb.org"] as const;

/** The largest image a series' artwork may be uploaded at, as large as one fetched may be. */
export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/**
 * The extension of an image by its first bytes, never by what it claims to be: JPEG, PNG or WebP
 * (what Jellyfin reads); null for anything else.
 */
export function sniffImage(bytes: Uint8Array): ".jpg" | ".png" | ".webp" | null {
  const starts = (offset: number, ...expected: number[]) =>
    expected.every((byte, i) => bytes[offset + i] === byte);
  if (starts(0, 0xff, 0xd8, 0xff)) return ".jpg";
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return ".png";
  // RIFF....WEBP
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return ".webp";
  return null;
}

/** A logo is laid over a picture: only formats that keep it transparent. */
export function fitsKind(kind: ArtworkKind, extension: string): boolean {
  return kind === "logo" ? extension === ".png" || extension === ".webp" : true;
}

/** The series field that says it has that artwork of its own. */
export const ARTWORK_FLAG = {
  poster: "hasPoster",
  backdrop: "hasBackdrop",
  logo: "hasLogo",
} as const satisfies Record<ArtworkKind, string>;

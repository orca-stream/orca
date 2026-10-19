/** Makes a title safe as a file or folder name on Linux, macOS and Windows shares. */
export function sanitizeName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/:\s*/g, " - ")
    .replace(/[<>"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s-\s*$/, "")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned === "" ? "Untitled" : cleaned;
}

/** `Show Name (Year)`, the folder Jellyfin expects for a series. */
export function seriesFolderName(title: string, year: number | null): string {
  const name = sanitizeName(title);
  return year === null ? name : `${name} (${year})`;
}

/** `Season 01`: zero-padded, never `S01`. Specials are season 0. */
export function seasonFolderName(season: number): string {
  return `Season ${String(season).padStart(2, "0")}`;
}

/** `Show Name S01E02.ext`. */
export function episodeFileName(
  title: string,
  season: number,
  episode: number,
  extension: string,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sanitizeName(title)} S${pad(season)}E${pad(episode)}${extension}`;
}

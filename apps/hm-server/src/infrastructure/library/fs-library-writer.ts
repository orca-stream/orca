import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { externalSubtitleName } from "@orca/media-probe";
import type { ArtworkKind } from "@orca/hm-contract";
import type { EpisodeFile, FetchedImage, LibraryWriter, Sidecar } from "../../application/ports.ts";
import type { Episode, Series } from "../../domain/series.ts";
import { episodeFileName, seasonFolderName } from "../../domain/naming.ts";
import { episodeNfo, tvshowNfo } from "./nfo.ts";

const STAGING = ".hm-staging";
const IMAGE_EXTENSIONS = [".jpg", ".png", ".webp", ".gif"];
/** The names Jellyfin reads artwork by in a series' folder, one per kind this server manages. */
const ARTWORK_KINDS: readonly ArtworkKind[] = ["poster", "backdrop", "logo"];
/**
 * The other names Jellyfin reads each kind by in a series' folder, and saves it under with its
 * "Legacy" convention (`folder.jpg`, `backdrop1.jpg`). Writing or removing a kind clears these too:
 * every one of them is another backdrop, and a stale `folder.jpg` would come back as the poster once
 * the own one is gone — the image chosen in the panel has to be the only one of its kind there.
 */
const ARTWORK_ALIASES: Record<ArtworkKind, RegExp> = {
  poster: /^(folder|cover|default|show)$/,
  backdrop: /^(backdrop-?\d+|(fanart|background|art)(-?\d+)?)$/,
  logo: /^clearlogo$/,
};
const ALIAS_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ".jpeg"]);
const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".m4v", ".avi", ".webm", ".mov", ".ts"]);

const isUnder = (path: string, folder: string) => path.startsWith(`${folder}${sep}`);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * What Jellyfin names after a video and must move with it: `Show 01.es.srt`, `Show 01.nfo`,
 * `Show 01-thumb.jpg`, the `Show 01.trickplay` folder. Gives the part after the video's base name.
 */
function companionSuffix(name: string, base: string): string | null {
  if (!name.startsWith(base)) return null;
  const rest = name.slice(base.length);
  return rest.startsWith(".") || rest.startsWith("-thumb.") ? rest : null;
}

/**
 * The Jellyfin name of each subtitle file. A language tag that is not a language is dropped (the
 * file stays, unlabelled); a file with an unusable format, or one that would take a name already
 * taken (`und` and no language read the same), is dropped.
 */
function nameSidecars(
  baseName: string,
  sidecars: Sidecar[],
): { named: { sidecar: Sidecar; name: string }[]; dropped: Sidecar[] } {
  const named: { sidecar: Sidecar; name: string }[] = [];
  const dropped: Sidecar[] = [];
  const taken = new Set<string>();
  const attempt = (sidecar: Sidecar, language: string | undefined): string | null => {
    try {
      return externalSubtitleName({
        baseName,
        ...(language ? { language } : {}),
        ...(sidecar.forced ? { forced: true } : {}),
        format: sidecar.format,
      });
    } catch {
      return null;
    }
  };
  for (const sidecar of sidecars) {
    const name = attempt(sidecar, sidecar.language) ?? attempt(sidecar, undefined);
    if (name === null || taken.has(name.toLowerCase())) {
      dropped.push(sidecar);
      continue;
    }
    taken.add(name.toLowerCase());
    named.push({ sidecar, name });
  }
  return { named, dropped };
}

/** Writes the library on disk the way Jellyfin reads it: `Show (Year)/Season 01/Show S01E01.ext`. */
export class FsLibraryWriter implements LibraryWriter {
  private readonly root: string;
  private readonly move: typeof rename;
  private readonly copy: typeof copyFile;

  /** `fs` is for tests that need to simulate a library on another file system. */
  constructor(mediaRoot: string, fs: { rename?: typeof rename; copyFile?: typeof copyFile } = {}) {
    this.root = mediaRoot;
    this.move = fs.rename ?? rename;
    this.copy = fs.copyFile ?? copyFile;
  }

  stagingPath(episode: Episode): string {
    const extension =
      episode.source.kind === "direct"
        ? extname(episode.source.fileName).toLowerCase() || ".mp4"
        : ".mkv";
    return join(this.root, STAGING, `${episode.id}${extension}`);
  }

  seriesPath(series: Series): string {
    return join(this.root, series.folderName);
  }

  async writeSeries(series: Series): Promise<{ createdFolder: boolean }> {
    const createdFolder = !(await stat(this.seriesPath(series)).catch(() => null));
    await this.atomicWrite(join(this.seriesPath(series), "tvshow.nfo"), tvshowNfo(series));
    return { createdFolder };
  }

  async writeArtwork(series: Series, kind: ArtworkKind, image: FetchedImage): Promise<void> {
    const name = `${kind}${image.extension}`;
    await this.atomicWrite(join(this.seriesPath(series), name), image.bytes);
    // One file per kind: a `poster.png` left beside a new `poster.jpg` would be read instead of it.
    for (const extension of IMAGE_EXTENSIONS) {
      if (extension !== image.extension) {
        await rm(join(this.seriesPath(series), `${kind}${extension}`), { force: true });
      }
    }
    await this.removeAliases(series, kind);
  }

  /** Jellyfin's own files of that kind in the series' folder (see `ARTWORK_ALIASES`). */
  private async removeAliases(series: Series, kind: ArtworkKind): Promise<void> {
    const folder = this.seriesPath(series);
    for (const file of await readdir(folder).catch(() => [])) {
      const extension = extname(file).toLowerCase();
      if (!ALIAS_EXTENSIONS.has(extension)) continue;
      if (ARTWORK_ALIASES[kind].test(basename(file, extname(file)).toLowerCase())) {
        await rm(join(folder, file), { force: true });
      }
    }
  }

  async artworkPath(series: Series, kind: ArtworkKind): Promise<string | null> {
    for (const extension of IMAGE_EXTENSIONS) {
      const path = join(this.seriesPath(series), `${kind}${extension}`);
      if ((await stat(path).catch(() => null))?.isFile()) return path;
    }
    return null;
  }

  async removeArtwork(series: Series, kind: ArtworkKind): Promise<void> {
    for (const extension of IMAGE_EXTENSIONS) {
      await rm(join(this.seriesPath(series), `${kind}${extension}`), { force: true });
    }
    await this.removeAliases(series, kind);
  }

  async removeSeries(series: Series): Promise<void> {
    const folder = this.seriesPath(series);
    await rm(join(folder, "tvshow.nfo"), { force: true });
    for (const kind of ARTWORK_KINDS) await this.removeArtwork(series, kind);
    // rmdir, not rm -r: a folder with episodes in it stays.
    if ((await readdir(folder).catch(() => [])).length === 0)
      await rmdir(folder).catch(() => undefined);
  }

  async commitEpisode(
    series: Series,
    episode: Episode,
    stagedPath: string,
    sidecars: Sidecar[] = [],
  ): Promise<{ relativePath: string; kept?: boolean }> {
    const extension = extname(stagedPath);
    const folder = join(this.seriesPath(series), seasonFolderName(episode.season));
    const destination = join(
      folder,
      episodeFileName(series.title, episode.season, episode.episode, extension),
    );
    if (await exists(destination)) {
      // Someone else's file under this name: it stays, with whatever is named after it.
      await rm(stagedPath, { force: true });
      await Promise.all(sidecars.map((sidecar) => rm(sidecar.path, { force: true })));
      return { relativePath: relative(this.root, destination).split(sep).join("/"), kept: true };
    }
    const base = destination.slice(0, destination.length - extension.length);
    // Every name is settled before anything moves: a bad subtitle must not leave a half-made episode.
    const { named, dropped } = nameSidecars(basename(base), sidecars);
    await mkdir(folder, { recursive: true });
    await this.place(stagedPath, destination);
    for (const { sidecar, name } of named) await this.place(sidecar.path, join(folder, name));
    await Promise.all(dropped.map((sidecar) => rm(sidecar.path, { force: true })));
    const nfo = episodeNfo(series, episode);
    // A series Jellyfin looks up online gets its episodes' metadata from there; a stale file is removed.
    if (nfo === null) await rm(`${base}.nfo`, { force: true });
    else await this.atomicWrite(`${base}.nfo`, nfo);
    return { relativePath: relative(this.root, destination).split(sep).join("/") };
  }

  async renameEpisodes(
    series: Series,
    files: readonly EpisodeFile[],
  ): Promise<{ season: number; episode: number; relativePath: string }[]> {
    const folder = this.seriesPath(series);
    const placed: { season: number; episode: number; relativePath: string }[] = [];
    const left = new Set<string>();
    for (const file of files) {
      // Only what is inside the series' own folder is this series' to move.
      if (!isUnder(file.path, folder)) continue;
      const extension = extname(file.path);
      const seasonFolder = join(folder, seasonFolderName(file.season));
      const target = join(
        seasonFolder,
        episodeFileName(series.title, file.season, file.episode, extension),
      );
      let path = file.path;
      // An earlier rename already moved it, and Jellyfin hasn't looked at the folder since.
      if (target !== file.path && (await exists(target)) && !(await exists(file.path))) {
        path = target;
      } else if (target !== file.path && !(await exists(target)) && (await exists(file.path))) {
        await mkdir(seasonFolder, { recursive: true });
        await this.move(file.path, target);
        path = target;
        const from = dirname(file.path);
        const oldBase = basename(file.path, extension);
        const newBase = basename(target, extension);
        for (const name of await readdir(from).catch(() => [])) {
          const suffix = companionSuffix(name, oldBase);
          if (suffix === null) continue;
          const to = join(seasonFolder, newBase + suffix);
          if (!(await exists(to))) await this.moveCompanion(join(from, name), to);
        }
        if (from !== seasonFolder) left.add(from);
      }
      placed.push({
        season: file.season,
        episode: file.episode,
        relativePath: relative(this.root, path).split(sep).join("/"),
      });
    }
    // A season folder under another name (`Season 1`, `S1`) goes once nothing is left in it; rmdir,
    // not rm -r, so one with anything else in it stays.
    for (const from of left) {
      if (isUnder(from, folder) && (await readdir(from).catch(() => [null])).length === 0) {
        await rmdir(from).catch(() => undefined);
      }
    }
    return placed;
  }

  async moveSeries(series: Series, folderName: string): Promise<"moved" | "absent" | "taken"> {
    const from = this.seriesPath(series);
    const to = join(this.root, folderName);
    if (!(await exists(from))) return "absent";
    // A name that differs only in case is the same folder on a case-insensitive share.
    if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) return "taken";
    await this.move(from, to);
    return "moved";
  }

  async locateEpisode(series: Series, episode: Episode): Promise<string | null> {
    const toRelative = (path: string) => relative(this.root, path).split(sep).join("/");
    if (episode.filePath !== null && (await exists(join(this.root, episode.filePath)))) {
      return episode.filePath;
    }
    const folder = join(this.seriesPath(series), seasonFolderName(episode.season));
    const pad = (n: number) => String(n).padStart(2, "0");
    const code = `S${pad(episode.season)}E${pad(episode.episode)}`;
    const videos = (await readdir(folder).catch(() => [])).filter((name) => {
      const base = basename(name, extname(name));
      return (
        VIDEO_EXTENSIONS.has(extname(name).toLowerCase()) &&
        (base === code || base.endsWith(` ${code}`))
      );
    });
    return videos.length === 1 ? toRelative(join(folder, videos[0]!)) : null;
  }

  async deleteEpisode(series: Series, episode: Episode): Promise<"deleted" | "absent" | "outside"> {
    const relativePath = await this.locateEpisode(series, episode);
    if (relativePath === null) return "absent";
    const video = join(this.root, relativePath);
    if (!isUnder(video, this.seriesPath(series))) return "outside";
    const folder = dirname(video);
    const base = basename(video, extname(video));
    await rm(video, { force: true });
    for (const name of await readdir(folder).catch(() => [])) {
      if (companionSuffix(name, base) === null) continue;
      try {
        await rm(join(folder, name), { recursive: true, force: true });
      } catch (error) {
        // A `.trickplay` folder Jellyfin made 755 is its own to clear; the video is what matters.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EACCES" && code !== "EPERM") throw error;
        console.warn(`left ${join(folder, name)} in place: ${code}`);
      }
    }
    return "deleted";
  }

  async deleteSeriesFolder(series: Series): Promise<"deleted" | "absent"> {
    const root = resolve(this.root);
    const folder = resolve(this.seriesPath(series));
    // Never the media root itself, nor anything outside it: only a folder right inside it.
    if (folder === root || dirname(folder) !== root) {
      throw new Error(`${folder} is not a series folder under ${root}`);
    }
    if (!(await exists(folder))) return "absent";
    await this.removeTree(folder);
    return "deleted";
  }

  /**
   * Deletes a folder and everything in it, leaving in place only what this server may not delete
   * (with the folders that hold it): a `.trickplay` folder Jellyfin made 755 is its own to clear.
   */
  private async removeTree(folder: string): Promise<void> {
    try {
      await rm(folder, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
    }
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        await this.removeTree(path);
        continue;
      }
      try {
        await rm(path, { force: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EACCES" && code !== "EPERM") throw error;
        console.warn(`left ${path} in place: ${code}`);
      }
    }
    await rmdir(folder).catch(() => console.warn(`left ${folder} in place: not empty`));
  }

  /**
   * A companion Jellyfin wrote itself can be beyond this server's reach: a `.trickplay` folder it
   * created 755 can't change parent, since that rewrites its `..`. Jellyfin makes those again for the
   * moved video, so one that won't move stays where it is instead of failing the whole rename.
   */
  private async moveCompanion(from: string, to: string): Promise<void> {
    try {
      await this.move(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM") throw error;
      console.warn(`left ${from} in place: ${code}`);
    }
  }

  /** Moves a staged file into the library, copying under a hidden name first across file systems. */
  private async place(from: string, to: string): Promise<void> {
    try {
      await this.move(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // Staging and library on different file systems: copy under a dot-prefixed name (Jellyfin
      // ignores it), then rename, so the library never shows a half-copied file.
      const partial = join(dirname(to), `.${basename(to)}.${randomBytes(4).toString("hex")}.tmp`);
      try {
        await this.copy(from, partial);
        await this.move(partial, to);
      } catch (copyError) {
        await rm(partial, { force: true });
        throw copyError;
      }
      await unlink(from);
    }
  }

  async discardStaged(episode: Episode): Promise<void> {
    const staging = join(this.root, STAGING);
    // Whatever container the download ended up with, and its subtitle files and parts.
    for (const name of await readdir(staging).catch(() => [])) {
      // A stream copied segment by segment stages a folder (`<id>.hls`).
      if (name.startsWith(`${episode.id}.`)) {
        await rm(join(staging, name), { force: true, recursive: true });
      }
    }
  }

  /** Written beside the target and renamed over it, so Jellyfin never reads half a file. */
  private async atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, content);
    await this.move(temporary, path);
  }
}

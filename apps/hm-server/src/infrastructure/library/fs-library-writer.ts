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
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { externalSubtitleName } from "@orca/media-probe";
import type { FetchedImage, LibraryWriter, Sidecar } from "../../application/ports.ts";
import type { Episode, Series } from "../../domain/series.ts";
import { episodeFileName, seasonFolderName } from "../../domain/naming.ts";
import { episodeNfo, tvshowNfo } from "./nfo.ts";

const STAGING = ".hm-staging";
const POSTER_EXTENSIONS = [".jpg", ".png", ".webp", ".gif"];

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

  async writePoster(series: Series, image: FetchedImage): Promise<void> {
    await this.atomicWrite(join(this.seriesPath(series), `poster${image.extension}`), image.bytes);
  }

  async posterPath(series: Series): Promise<string | null> {
    for (const extension of POSTER_EXTENSIONS) {
      const path = join(this.seriesPath(series), `poster${extension}`);
      if ((await stat(path).catch(() => null))?.isFile()) return path;
    }
    return null;
  }

  async removeSeries(series: Series): Promise<void> {
    const folder = this.seriesPath(series);
    await rm(join(folder, "tvshow.nfo"), { force: true });
    for (const extension of POSTER_EXTENSIONS)
      await rm(join(folder, `poster${extension}`), { force: true });
    // rmdir, not rm -r: a folder with episodes in it stays.
    if ((await readdir(folder).catch(() => [])).length === 0)
      await rmdir(folder).catch(() => undefined);
  }

  async commitEpisode(
    series: Series,
    episode: Episode,
    stagedPath: string,
    sidecars: Sidecar[] = [],
  ): Promise<{ relativePath: string }> {
    const extension = extname(stagedPath);
    const folder = join(this.seriesPath(series), seasonFolderName(episode.season));
    const destination = join(
      folder,
      episodeFileName(series.title, episode.season, episode.episode, extension),
    );
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
      if (name.startsWith(`${episode.id}.`)) await rm(join(staging, name), { force: true });
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

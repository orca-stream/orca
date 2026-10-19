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
import type { FetchedImage, LibraryWriter } from "../../application/ports.ts";
import type { Episode, Series } from "../../domain/series.ts";
import { episodeFileName, seasonFolderName } from "../../domain/naming.ts";
import { episodeNfo, tvshowNfo } from "./nfo.ts";

const STAGING = ".hm-staging";
const POSTER_EXTENSIONS = [".jpg", ".png", ".webp", ".gif"];

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
  ): Promise<{ relativePath: string }> {
    const extension = extname(stagedPath);
    const folder = join(this.seriesPath(series), seasonFolderName(episode.season));
    const destination = join(
      folder,
      episodeFileName(series.title, episode.season, episode.episode, extension),
    );
    await mkdir(folder, { recursive: true });
    try {
      await this.move(stagedPath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // Staging and library on different file systems: copy under a dot-prefixed name (Jellyfin
      // ignores it), then rename, so the library never shows a half-copied file.
      const partial = join(
        dirname(destination),
        `.${basename(destination)}.${randomBytes(4).toString("hex")}.tmp`,
      );
      try {
        await this.copy(stagedPath, partial);
        await this.move(partial, destination);
      } catch (copyError) {
        await rm(partial, { force: true });
        throw copyError;
      }
      await unlink(stagedPath);
    }
    await this.atomicWrite(
      destination.slice(0, destination.length - extension.length) + ".nfo",
      episodeNfo(series, episode),
    );
    return { relativePath: relative(this.root, destination).split(sep).join("/") };
  }

  async discardStaged(episode: Episode): Promise<void> {
    const staged = this.stagingPath(episode);
    await rm(staged, { force: true });
    await rm(`${staged}.part`, { force: true });
  }

  /** Written beside the target and renamed over it, so Jellyfin never reads half a file. */
  private async atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, content);
    await this.move(temporary, path);
  }
}

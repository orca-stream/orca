import { copyFile, mkdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import type { LibraryWriter } from "../../application/ports.ts";
import type { Episode, Series } from "../../domain/series.ts";
import { episodeFileName, seasonFolderName } from "./naming.ts";
import { episodeNfo, tvshowNfo } from "./nfo.ts";

const STAGING = ".hm-staging";

/** Writes the library on disk the way Jellyfin reads it: `Show (Year)/Season 01/Show S01E01.ext`. */
export class FsLibraryWriter implements LibraryWriter {
  private readonly root: string;

  constructor(mediaRoot: string) {
    this.root = mediaRoot;
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

  async writeSeries(series: Series): Promise<void> {
    await this.atomicWrite(join(this.seriesPath(series), "tvshow.nfo"), tvshowNfo(series));
  }

  async writePoster(series: Series, image: Uint8Array): Promise<void> {
    await this.atomicWrite(join(this.seriesPath(series), "poster.jpg"), image);
  }

  async posterPath(series: Series): Promise<string | null> {
    const path = join(this.seriesPath(series), "poster.jpg");
    return (await stat(path).catch(() => null))?.isFile() ? path : null;
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
      await rename(stagedPath, destination);
    } catch (error) {
      // Staging and library on different file systems: copy, then drop the original.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(stagedPath, destination);
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
    const temporary = `${path}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, path);
  }
}

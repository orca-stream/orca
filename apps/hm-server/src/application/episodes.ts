import type { Extraction } from "@orca/extractor-core";
import { mapEpisode } from "@orca/hm-contract";
import { join } from "node:path";
import { uuidv7 } from "../domain/ids.ts";
import { seriesFolderName } from "../domain/naming.ts";
import type { Episode, Series, SeriesSource, Source } from "../domain/series.ts";
import type { LibraryWriter, SeriesRepository } from "./ports.ts";

export type ExtractedEpisode = Extraction["episodes"][number];

export function sourceOf(episode: ExtractedEpisode): Source {
  const { media } = episode;
  if (media.kind === "page") return { kind: "page", url: media.url };
  if (media.kind === "mirrors") return { kind: "mirrors", url: media.url };
  return {
    kind: "direct",
    url: media.url,
    fileName: media.fileName,
    ...(media.sizeBytes !== undefined ? { sizeBytes: media.sizeBytes } : {}),
    ...(media.md5 ? { md5: media.md5 } : {}),
    ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
  };
}

/**
 * Where a source puts an episode the site found: its season, and its number moved by the offset and
 * by the episodes numbered by hand before it (a special goes to season 0).
 */
export function numberOf(
  source: Pick<SeriesSource, "season" | "episodeOffset" | "adjustments">,
  extracted: Pick<ExtractedEpisode, "season" | "episode">,
): { season: number; episode: number } {
  return mapEpisode(extracted, {
    season: source.season,
    offset: source.episodeOffset,
    adjustments: source.adjustments,
  });
}

/** A new, not yet downloaded episode row for something an extractor found on a source. */
export function newEpisode(
  source: Pick<SeriesSource, "id" | "seriesId" | "season" | "episodeOffset" | "adjustments">,
  extracted: ExtractedEpisode,
  now: number,
): Episode {
  const { season, episode } = numberOf(source, extracted);
  return {
    id: uuidv7(now),
    seriesId: source.seriesId,
    sourceId: source.id,
    season,
    episode,
    title: extracted.title,
    plot: extracted.plot ?? null,
    airDate: extracted.airDate ?? null,
    inferred: extracted.inferred,
    sourceRef: extracted.sourceRef,
    source: sourceOf(extracted),
    durationSec: extracted.media.durationSec ?? null,
    sizeBytes: extracted.media.sizeBytes ?? null,
    format: extracted.media.format ?? null,
    status: "missing",
    filePath: null,
    createdAt: now,
  };
}

/** Which of two episodes comes first in the series: by season, then by number. */
export function comparePlace(
  a: { season: number; episode: number },
  b: { season: number; episode: number },
): number {
  return a.season - b.season || a.episode - b.episode;
}

/**
 * A source that starts after everything another one lists means that one is finished — a new
 * season, or the next part of the same season the site lists under another address. Its source
 * would bring nothing new, so it is closed as the user would by hand. One that reaches as far as
 * the new one starts stays open. `existing` are the series' episodes before `added`.
 */
export async function closeFinishedSources(
  series: SeriesRepository,
  seriesId: string,
  sourceId: string,
  added: readonly Episode[],
  existing: readonly Episode[],
): Promise<void> {
  if (added.length === 0) return;
  const from = added.reduce((first, episode) =>
    comparePlace(episode, first) < 0 ? episode : first,
  );
  const lastOf = new Map<string, Episode>();
  for (const episode of existing) {
    if (!episode.sourceId) continue;
    const last = lastOf.get(episode.sourceId);
    if (!last || comparePlace(episode, last) > 0) lastOf.set(episode.sourceId, episode);
  }
  for (const other of await series.listSources([seriesId])) {
    if (other.id === sourceId || other.closed) continue;
    const last = lastOf.get(other.id);
    // With no episodes of its own, only its season tells: an earlier one is finished.
    const finished = last
      ? comparePlace(last, from) < 0
      : other.season !== null && other.season < from.season;
    if (finished) await series.updateSource(other.id, { closed: true });
  }
}

/**
 * Missing episodes whose video is already in the series' folder (from before, by hand, or listed
 * late by Jellyfin) are available, at that file, so they aren't downloaded again.
 */
export async function placeOnDisk(
  library: LibraryWriter,
  series: Series,
  episodes: readonly Episode[],
): Promise<Episode[]> {
  return Promise.all(
    episodes.map(async (episode): Promise<Episode> => {
      if (episode.status !== "missing") return episode;
      const filePath = await library.locateEpisode(series, episode);
      return filePath ? { ...episode, status: "available", filePath } : episode;
    }),
  );
}

/**
 * Makes the database agree with the files: an available episode whose file isn't where it says is
 * pointed at where it is now (a rename used to keep the name Jellyfin still listed after the file
 * had moved), and a missing one whose video is in its season folder becomes available. One that
 * can't be found is left as it is. Returns how many were fixed.
 */
export async function repairEpisodePaths(deps: {
  series: SeriesRepository;
  library: LibraryWriter;
}): Promise<number> {
  let fixed = 0;
  for (const series of await deps.series.list()) {
    for (const episode of await deps.series.listEpisodes(series.id)) {
      const stale = episode.status === "available" && episode.filePath !== null;
      if (!stale && episode.status !== "missing") continue;
      const path = await deps.library.locateEpisode(series, episode);
      if (path === null || path === episode.filePath) continue;
      await deps.series.setEpisodeStatus(episode.id, "available", path);
      fixed++;
    }
  }
  return fixed;
}

/**
 * Gives a series and its episode files the names its title and year call for now: the folder
 * `Title (Year)` and `Season 01/Title S01E01.ext`. A folder whose new name is taken keeps its name,
 * but its files are still renamed. Returns whether anything moved.
 */
export async function normalizeSeries(
  deps: { series: SeriesRepository; library: LibraryWriter },
  series: Series,
): Promise<boolean> {
  let current = series;
  let changed = false;
  const folderName = seriesFolderName(series.title, series.year);
  const episodes = await deps.series.listEpisodes(series.id);
  if (folderName !== series.folderName && !(await deps.series.findByFolder(folderName))) {
    const moved = await deps.library.moveSeries(series, folderName);
    if (moved !== "taken") {
      current = { ...series, folderName };
      await deps.series.update(series.id, { folderName });
      const prefix = `${series.folderName}/`;
      for (const episode of episodes) {
        if (episode.filePath === null || !episode.filePath.startsWith(prefix)) continue;
        episode.filePath = `${folderName}/${episode.filePath.slice(prefix.length)}`;
        await deps.series.setEpisodeStatus(episode.id, episode.status, episode.filePath);
      }
      changed = moved === "moved";
    }
  }
  const prefix = `${current.folderName}/`;
  const placed = episodes.filter(
    (episode) =>
      episode.status === "available" &&
      episode.filePath !== null &&
      episode.filePath.startsWith(prefix),
  );
  const folder = deps.library.seriesPath(current);
  const renamed = await deps.library.renameEpisodes(
    current,
    placed.map((episode) => ({
      season: episode.season,
      episode: episode.episode,
      path: join(folder, ...(episode.filePath as string).slice(prefix.length).split("/")),
    })),
  );
  const pathOf = new Map(
    renamed.map((file) => [`${file.season}:${file.episode}`, file.relativePath]),
  );
  for (const episode of placed) {
    const path = pathOf.get(`${episode.season}:${episode.episode}`);
    if (path === undefined || path === episode.filePath) continue;
    await deps.series.setEpisodeStatus(episode.id, "available", path);
    changed = true;
  }
  return changed;
}

/** {@link normalizeSeries} for every series. Returns the ids of those that changed. */
export async function normalizeLibrary(deps: {
  series: SeriesRepository;
  library: LibraryWriter;
}): Promise<string[]> {
  const changed: string[] = [];
  for (const series of await deps.series.list()) {
    try {
      if (await normalizeSeries(deps, series)) changed.push(series.id);
    } catch (error) {
      // One series that can't be renamed leaves the others to be.
      console.error(`renaming “${series.title}” failed:`, error);
    }
  }
  return changed;
}

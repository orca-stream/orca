import { eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../../domain/errors.ts";
import type { EpisodeStatus } from "@orca/hm-contract";
import type { SeriesRepository, SeriesWithCounts } from "../../application/ports.ts";
import type { Episode, Series, SeriesSource, Source } from "../../domain/series.ts";
import type { Db } from "./client.ts";
import { episodes, series, seriesSources } from "./schema.ts";

type SeriesRow = typeof series.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type SourceRow = typeof seriesSources.$inferSelect;

function toSeries(row: SeriesRow): Series {
  return row;
}

function toSource(row: SourceRow): SeriesSource {
  return { ...row, knownRefs: row.knownRefs ?? null };
}

/** The unique indexes are the last word when two submits slip past the lookups. */
function rethrowConflict(error: unknown): never {
  const message = String((error as Error).message);
  if (/UNIQUE constraint failed: series_sources\./.test(message))
    throw new AppError("conflict", "This address was already added");
  if (/UNIQUE constraint failed: series\./.test(message))
    throw new AppError("conflict", "This series was already added, or its folder is taken");
  if (/UNIQUE constraint failed: episodes\./.test(message))
    throw new AppError("conflict", "Two episodes would get the same season and number");
  throw error;
}

function toEpisode(row: EpisodeRow): Episode {
  return { ...row, source: row.source as Source, status: row.status as EpisodeStatus };
}

export class DrizzleSeriesRepository implements SeriesRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(value: Series, source: SeriesSource, list: Episode[]): Promise<void> {
    try {
      this.db.transaction((tx) => {
        tx.insert(series).values(value).run();
        tx.insert(seriesSources).values(source).run();
        for (const episode of list) tx.insert(episodes).values(episode).run();
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async addSource(source: SeriesSource, list: Episode[]): Promise<void> {
    try {
      this.db.transaction((tx) => {
        tx.insert(seriesSources).values(source).run();
        for (const episode of list) tx.insert(episodes).values(episode).run();
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async findSourceByExternal(
    extractorId: string,
    externalId: string,
  ): Promise<SeriesSource | null> {
    const row = this.db
      .select()
      .from(seriesSources)
      .where(
        sql`${seriesSources.extractorId} = ${extractorId} and ${seriesSources.externalId} = ${externalId}`,
      )
      .get();
    return row ? toSource(row) : null;
  }

  async listSources(seriesIds?: string[]): Promise<SeriesSource[]> {
    if (seriesIds?.length === 0) return [];
    const query = this.db.select().from(seriesSources);
    const rows = (seriesIds ? query.where(inArray(seriesSources.seriesId, seriesIds)) : query)
      .orderBy(seriesSources.createdAt, seriesSources.id)
      .all();
    return rows.map(toSource);
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<SeriesSource, "remoteMarker" | "knownRefs" | "closed">>,
  ): Promise<void> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length === 0) return;
    this.db.update(seriesSources).set(defined).where(eq(seriesSources.id, id)).run();
  }

  async get(id: string): Promise<Series | null> {
    const row = this.db.select().from(series).where(eq(series.id, id)).get();
    return row ? toSeries(row) : null;
  }

  async findByFolder(folderName: string): Promise<Series | null> {
    const row = this.db.select().from(series).where(eq(series.folderName, folderName)).get();
    return row ? toSeries(row) : null;
  }

  async findByProviderIds(ids: {
    tmdbId: string | null;
    imdbId: string | null;
  }): Promise<Series | null> {
    for (const [column, value] of [
      [series.tmdbId, ids.tmdbId],
      [series.imdbId, ids.imdbId],
    ] as const) {
      if (value === null) continue;
      const row = this.db.select().from(series).where(eq(column, value)).get();
      if (row) return toSeries(row);
    }
    return null;
  }

  async list(): Promise<SeriesWithCounts[]> {
    const rows = this.db.select().from(series).orderBy(series.title).all();
    const counts = this.db
      .select({
        seriesId: episodes.seriesId,
        total: sql<number>`count(*)`,
        available: sql<number>`sum(${episodes.status} = 'available')`,
      })
      .from(episodes)
      .groupBy(episodes.seriesId)
      .all();
    const byId = new Map(counts.map((c) => [c.seriesId, c]));
    return rows.map((row) => ({
      ...toSeries(row),
      episodeCount: byId.get(row.id)?.total ?? 0,
      availableCount: byId.get(row.id)?.available ?? 0,
    }));
  }

  async update(
    id: string,
    patch: Parameters<SeriesRepository["update"]>[1],
  ): Promise<Series | null> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length > 0) {
      this.db.update(series).set(defined).where(eq(series.id, id)).run();
    }
    return this.get(id);
  }

  async findDueSeries(now: number): Promise<Series[]> {
    return this.db
      .select()
      .from(series)
      .where(
        sql`${series.follow} = 1 and (${series.lastCheckedAt} is null or ${series.lastCheckedAt} + ${series.checkIntervalHours} * 3600000 <= ${now})`,
      )
      .orderBy(series.lastCheckedAt, series.id)
      .all()
      .map(toSeries);
  }

  async upsertEpisodes(
    seriesId: string,
    changes: { update: Episode[]; add: Episode[] },
  ): Promise<void> {
    this.db.transaction((tx) => {
      for (const episode of changes.update) {
        tx.update(episodes)
          .set({
            title: episode.title,
            plot: episode.plot,
            airDate: episode.airDate,
            inferred: episode.inferred,
            source: episode.source,
            durationSec: episode.durationSec,
            sizeBytes: episode.sizeBytes,
            format: episode.format,
          })
          .where(sql`${episodes.id} = ${episode.id} and ${episodes.seriesId} = ${seriesId}`)
          .run();
      }
      for (const episode of changes.add) tx.insert(episodes).values(episode).run();
    });
  }

  async listEpisodes(seriesId: string): Promise<Episode[]> {
    return this.db
      .select()
      .from(episodes)
      .where(eq(episodes.seriesId, seriesId))
      .orderBy(episodes.season, episodes.episode)
      .all()
      .map(toEpisode);
  }

  async getEpisode(id: string): Promise<Episode | null> {
    const row = this.db.select().from(episodes).where(eq(episodes.id, id)).get();
    return row ? toEpisode(row) : null;
  }

  async getEpisodes(ids: string[]): Promise<Episode[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(episodes).where(inArray(episodes.id, ids)).all().map(toEpisode);
  }

  async setEpisodeStatus(
    id: string,
    status: EpisodeStatus,
    filePath?: string | null,
  ): Promise<void> {
    this.db
      .update(episodes)
      .set(filePath === undefined ? { status } : { status, filePath })
      .where(eq(episodes.id, id))
      .run();
  }

  async seriesTitles(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .select({ id: series.id, title: series.title })
      .from(series)
      .where(inArray(series.id, ids))
      .all();
    return new Map(rows.map((row) => [row.id, row.title]));
  }
}

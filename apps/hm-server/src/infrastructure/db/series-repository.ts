import { eq, inArray, sql } from "drizzle-orm";
import type { EpisodeStatus } from "@orca/hm-contract";
import type { SeriesRepository, SeriesWithCounts } from "../../application/ports.ts";
import type { Episode, Series, Source } from "../../domain/series.ts";
import type { Db } from "./client.ts";
import { episodes, series } from "./schema.ts";

type SeriesRow = typeof series.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;

function toSeries(row: SeriesRow): Series {
  return { ...row };
}

function toEpisode(row: EpisodeRow): Episode {
  return { ...row, source: row.source as Source, status: row.status as EpisodeStatus };
}

export class DrizzleSeriesRepository implements SeriesRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(value: Series, list: Episode[]): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(series).values(value).run();
      for (const episode of list) tx.insert(episodes).values(episode).run();
    });
  }

  async get(id: string): Promise<Series | null> {
    const row = this.db.select().from(series).where(eq(series.id, id)).get();
    return row ? toSeries(row) : null;
  }

  async findByExternal(extractorId: string, externalId: string): Promise<Series | null> {
    const row = this.db
      .select()
      .from(series)
      .where(sql`${series.extractorId} = ${extractorId} and ${series.externalId} = ${externalId}`)
      .get();
    return row ? toSeries(row) : null;
  }

  async findByFolder(folderName: string): Promise<Series | null> {
    const row = this.db.select().from(series).where(eq(series.folderName, folderName)).get();
    return row ? toSeries(row) : null;
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
    patch: Partial<Pick<Series, "title" | "year" | "follow" | "checkIntervalHours" | "hasPoster">>,
  ): Promise<Series | null> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(defined).length > 0) {
      this.db.update(series).set(defined).where(eq(series.id, id)).run();
    }
    return this.get(id);
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

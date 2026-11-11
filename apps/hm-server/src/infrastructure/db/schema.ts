import { sql } from "drizzle-orm";
import type { ArtworkKind, EpisodeAdjustment, MediaKind } from "@orca/hm-contract";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const series = sqliteTable(
  "series",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<MediaKind>().notNull().default("show"),
    title: text("title").notNull(),
    year: integer("year"),
    plot: text("plot"),
    tmdbId: text("tmdb_id"),
    imdbId: text("imdb_id"),
    folderName: text("folder_name").notNull(),
    hasPoster: integer("has_poster", { mode: "boolean" }).notNull().default(false),
    hasBackdrop: integer("has_backdrop", { mode: "boolean" }).notNull().default(false),
    hasLogo: integer("has_logo", { mode: "boolean" }).notNull().default(false),
    artworkVersion: integer("artwork_version").notNull().default(0),
    artworkFrom: text("artwork_from", { mode: "json" })
      .$type<Partial<Record<ArtworkKind, string>>>()
      .notNull()
      .default(sql`'{}'`),
    follow: integer("follow", { mode: "boolean" }).notNull().default(false),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    checkIntervalHours: integer("check_interval_hours").notNull().default(12),
    lastCheckedAt: integer("last_checked_at"),
    maxHeight: integer("max_height"),
    audioLangs: text("audio_langs", { mode: "json" }).$type<string[]>(),
    subtitleLangs: text("subtitle_langs", { mode: "json" }).$type<string[]>(),
    preferredSources: text("preferred_sources", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer("created_at").notNull(),
  },
  // A show and a movie live in different folders: the same name may be both.
  (t) => [uniqueIndex("series_folder").on(t.kind, t.folderName)],
);

export const seriesSources = sqliteTable(
  "series_sources",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    extractorId: text("extractor_id").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    season: integer("season"),
    episodeOffset: integer("episode_offset").notNull().default(0),
    adjustments: text("adjustments", { mode: "json" })
      .$type<EpisodeAdjustment[]>()
      .notNull()
      .default(sql`'[]'`),
    remoteMarker: text("remote_marker"),
    knownRefs: text("known_refs", { mode: "json" }).$type<string[]>(),
    listedSeasons: text("listed_seasons", { mode: "json" }).$type<number[]>(),
    closed: integer("closed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("series_sources_external").on(t.extractorId, t.externalId),
    index("series_sources_series").on(t.seriesId),
  ],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => seriesSources.id, { onDelete: "set null" }),
    season: integer("season").notNull(),
    episode: integer("episode").notNull(),
    title: text("title").notNull(),
    plot: text("plot"),
    airDate: text("air_date"),
    inferred: integer("inferred", { mode: "boolean" }).notNull().default(false),
    sourceRef: text("source_ref").notNull(),
    source: text("source", { mode: "json" }).notNull(),
    durationSec: real("duration_sec"),
    sizeBytes: integer("size_bytes"),
    format: text("format"),
    status: text("status").notNull().default("missing"),
    filePath: text("file_path"),
    fileSourceId: text("file_source_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("episodes_number").on(t.seriesId, t.season, t.episode),
    uniqueIndex("episodes_source_ref").on(t.seriesId, t.sourceRef),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    seriesId: text("series_id").references(() => series.id, { onDelete: "set null" }),
    episodeId: text("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    resource: text("resource").notNull(),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: integer("run_after").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at"),
    progress: real("progress"),
    progressDetail: text("progress_detail", { mode: "json" }),
    lastError: text("last_error"),
    errorKind: text("error_kind"),
    dedupeKey: text("dedupe_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    index("jobs_ready").on(t.status, t.runAfter, t.priority),
    uniqueIndex("jobs_dedupe")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  /** Last time the user was confirmed to still be an administrator. */
  checkedAt: integer("checked_at").notNull(),
});

/** Small key/value facts about this install, e.g. the device id Jellyfin sees. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    seriesId: text("series_id").references(() => series.id, { onDelete: "set null" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    data: text("data", { mode: "json" }).notNull().$type<Record<string, string | number | null>>(),
    createdAt: integer("created_at").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [index("notifications_recent").on(t.createdAt)],
);

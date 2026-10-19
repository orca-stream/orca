import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const series = sqliteTable(
  "series",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    year: integer("year"),
    plot: text("plot"),
    extractorId: text("extractor_id").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    folderName: text("folder_name").notNull(),
    hasPoster: integer("has_poster", { mode: "boolean" }).notNull().default(false),
    follow: integer("follow", { mode: "boolean" }).notNull().default(false),
    checkIntervalHours: integer("check_interval_hours").notNull().default(12),
    lastCheckedAt: integer("last_checked_at"),
    remoteMarker: text("last_remote_marker"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("series_external").on(t.extractorId, t.externalId),
    uniqueIndex("series_folder").on(t.folderName),
  ],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
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

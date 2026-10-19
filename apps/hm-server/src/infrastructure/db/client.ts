import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface Database_ {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

/** Opens the SQLite file (or `:memory:`), applies the committed migrations and returns the handle. */
export function openDatabase(options: { file: string; migrationsFolder: string }): Database_ {
  const sqlite = new Database(options.file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: options.migrationsFolder });
  return { db, sqlite, close: () => sqlite.close() };
}

import { eq } from "drizzle-orm";
import type { SettingsRepository } from "../../application/ports.ts";
import type { Db } from "./client.ts";
import { settings } from "./schema.ts";

export class DrizzleSettingsRepository implements SettingsRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async get(key: string): Promise<string | null> {
    return this.db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }
}

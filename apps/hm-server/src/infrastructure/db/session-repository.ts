import { eq, lt } from "drizzle-orm";
import type { SessionRecord, SessionRepository } from "../../application/ports.ts";
import type { Db } from "./client.ts";
import { sessions } from "./schema.ts";

export class DrizzleSessionRepository implements SessionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(session: SessionRecord): Promise<void> {
    this.db.insert(sessions).values(session).run();
  }

  async find(id: string): Promise<SessionRecord | null> {
    return this.db.select().from(sessions).where(eq(sessions.id, id)).get() ?? null;
  }

  async touch(id: string, checkedAt: number): Promise<void> {
    this.db.update(sessions).set({ checkedAt }).where(eq(sessions.id, id)).run();
  }

  async delete(id: string): Promise<void> {
    this.db.delete(sessions).where(eq(sessions.id, id)).run();
  }

  async deleteExpired(now: number): Promise<void> {
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  }
}

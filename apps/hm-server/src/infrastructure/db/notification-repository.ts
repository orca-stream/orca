import { desc, sql } from "drizzle-orm";
import type { NotificationRepository } from "../../application/ports.ts";
import type { Notification, NotificationKind } from "../../domain/notification.ts";
import type { Db } from "./client.ts";
import { notifications } from "./schema.ts";

type Row = typeof notifications.$inferSelect;

const toNotification = (row: Row): Notification => ({ ...row, kind: row.kind as NotificationKind });

export class DrizzleNotificationRepository implements NotificationRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async insert(notification: Notification): Promise<void> {
    this.db.insert(notifications).values(notification).run();
  }

  async list(limit: number): Promise<Notification[]> {
    return this.db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
      .all()
      .map(toNotification);
  }

  async unreadCount(): Promise<number> {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(sql`${notifications.readAt} is null`)
      .get();
    return row?.count ?? 0;
  }

  async markRead(at: number, ids?: string[]): Promise<number> {
    const idFilter =
      ids === undefined
        ? sql`1 = 1`
        : sql`${notifications.id} in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`;
    return this.db
      .update(notifications)
      .set({ readAt: at })
      .where(sql`${notifications.readAt} is null and ${idFilter}`)
      .run().changes;
  }

  async deleteOlderThan(cutoff: number): Promise<void> {
    this.db
      .delete(notifications)
      .where(sql`${notifications.createdAt} < ${cutoff}`)
      .run();
  }

  async latest(kind: NotificationKind, seriesId: string): Promise<Notification | null> {
    const row = this.db
      .select()
      .from(notifications)
      .where(sql`${notifications.kind} = ${kind} and ${notifications.seriesId} = ${seriesId}`)
      .orderBy(desc(notifications.createdAt))
      .limit(1)
      .get();
    return row ? toNotification(row) : null;
  }
}

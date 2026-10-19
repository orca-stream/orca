import * as z from "zod";

export const NotificationKind = z.enum([
  "new_episodes",
  "episodes_skipped",
  "episodes_learned",
  "series_downloaded",
  "job_failed",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationDto = z.object({
  id: z.string(),
  kind: NotificationKind,
  /** English fallback text, as another channel (ntfy) would send it. The panel translates from `kind` and `data`. */
  title: z.string(),
  body: z.string(),
  seriesId: z.string().nullable(),
  jobId: z.string().nullable(),
  /**
   * What the text was made of, so the panel can say it in its own language: `seriesTitle`, `count`,
   * `available`, `total`, `episodeCode`, `error`.
   */
  data: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  createdAt: z.number(),
  readAt: z.number().nullable(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationList = z.object({
  items: z.array(NotificationDto),
  unreadCount: z.number().int(),
});
export type NotificationList = z.infer<typeof NotificationList>;

/** How many ids one request may name; more than the bell ever lists. */
export const MAX_MARK_READ_IDS = 500;

/** No ids: every unread notification. */
export const MarkReadBody = z.object({
  ids: z.array(z.string().max(200)).min(1).max(MAX_MARK_READ_IDS).optional(),
});
export type MarkReadBody = z.infer<typeof MarkReadBody>;

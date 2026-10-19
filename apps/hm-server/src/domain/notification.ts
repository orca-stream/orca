import type { NotificationKind } from "@orca/hm-contract";

export type { NotificationKind };

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** English text for channels that have no panel to translate it (ntfy, later). */
  title: string;
  body: string;
  seriesId: string | null;
  jobId: string | null;
  /** What the text was made of; the panel writes its own sentence from it. */
  data: Record<string, string | number | null>;
  createdAt: number;
  readAt: number | null;
}

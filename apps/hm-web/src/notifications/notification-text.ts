import type { NotificationDto } from "@orca/hm-contract";
import type { Messages } from "../i18n/messages";

type Texts = Messages["notifications"];

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/**
 * A notification's title and sentence in the panel's language, built from what the server sent
 * (`kind` and `data`). If a field is missing it shows the server's English text instead.
 */
export function notificationText(
  notification: NotificationDto,
  messages: Messages,
): { title: string; body: string } {
  const t: Texts = messages.notifications;
  const kindLabels: Record<string, string> = messages.dashboard.kinds;
  const fallback = { title: notification.title, body: notification.body };
  const { data } = notification;
  const series = text(data.seriesTitle);

  switch (notification.kind) {
    case "new_episodes": {
      const count = num(data.count);
      const codes = text(data.codes);
      if (series === null || count === null || codes === null) return fallback;
      return { title: t.newEpisodesTitle, body: t.newEpisodes(series, count, codes) };
    }
    case "episodes_skipped": {
      const count = num(data.count);
      if (series === null || count === null) return fallback;
      return { title: t.episodesSkippedTitle, body: t.episodesSkipped(series, count) };
    }
    case "series_downloaded": {
      const available = num(data.available);
      const total = num(data.total);
      if (series === null || available === null || total === null) return fallback;
      return {
        title: t.seriesDownloadedTitle,
        body: t.seriesDownloaded(series, available, total),
      };
    }
    case "job_failed": {
      const error = text(data.error);
      if (error === null) return fallback;
      const jobKind = text(data.jobKind);
      const label = jobKind ? (kindLabels[jobKind] ?? null) : null;
      const what = [series, text(data.episodeCode)].filter(Boolean).join(" ") || label || "";
      return { title: t.jobFailedTitle, body: what ? `${what}: ${error}` : error };
    }
  }
}

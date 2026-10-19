import { uuidv7 } from "../domain/ids.ts";
import type { Job } from "../domain/job.ts";
import type { Notification } from "../domain/notification.ts";
import { episodeCode } from "../domain/series.ts";
import type { Clock, EventBus, NotificationRepository, Notifier } from "./ports.ts";
import { toNotificationDto } from "./presenter.ts";

/** The channel that is always on: a row for the bell, and an event so open panels update at once. */
export class PanelNotifier implements Notifier {
  private readonly repository: NotificationRepository;
  private readonly events: EventBus;

  constructor(repository: NotificationRepository, events: EventBus) {
    this.repository = repository;
    this.events = events;
  }

  async notify(notification: Notification): Promise<void> {
    await this.repository.insert(notification);
    this.events.publish({
      type: "notification.created",
      notification: toNotificationDto(notification),
    });
  }
}

/** How long a notification is kept; the bell only lists the latest ones anyway. */
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type Draft = Pick<Notification, "kind" | "title" | "body" | "seriesId" | "jobId" | "data">;

export interface NotificationServiceOptions {
  /** The panel's first: its row is the record. The rest are best effort. */
  notifiers: Notifier[];
  clock: Clock;
  repository: NotificationRepository;
  onError?: (error: unknown) => void;
}

/**
 * Turns what happened (new episodes, a finished batch, a job that gave up) into notifications and
 * hands them to every channel. A channel that fails is logged and never blocks the work.
 */
export class NotificationService {
  private readonly options: NotificationServiceOptions;
  // Serialises "is the batch over?" per series, so two episodes finishing together notify once.
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(options: NotificationServiceOptions) {
    this.options = options;
  }

  /** One per check, however many episodes it found. */
  async newEpisodes(
    series: { id: string | null; title: string },
    episodes: { season: number; episode: number }[],
  ): Promise<void> {
    const codes = episodes.map((e) => episodeCode(e.season, e.episode)).join(", ");
    const count = episodes.length;
    await this.send({
      kind: "new_episodes",
      title: "New episodes",
      body: `${series.title}: ${count} new ${count === 1 ? "episode" : "episodes"} (${codes})`,
      seriesId: series.id,
      jobId: null,
      data: { seriesTitle: series.title, count, codes },
    });
  }

  /** New episodes a check found but could not add: another episode already has their number. */
  async episodesSkipped(series: { id: string; title: string }, count: number): Promise<void> {
    await this.send({
      kind: "episodes_skipped",
      title: "Episodes not added",
      body: `${series.title}: ${count} new ${count === 1 ? "episode was" : "episodes were"} not added because their number is already taken`,
      seriesId: series.id,
      jobId: null,
      data: { seriesTitle: series.title, count },
    });
  }

  /**
   * The last queued download of a series just finished. `finishedAt` is when that job finished: a
   * notification made since then already covers it (two episodes ended together).
   */
  seriesDownloaded(
    series: { id: string; title: string },
    counts: { available: number; total: number },
    finishedAt: number,
  ): Promise<void> {
    const previous = this.tails.get(series.id) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const latest = await this.options.repository.latest("series_downloaded", series.id);
        if (latest && latest.createdAt >= finishedAt) return;
        await this.send({
          kind: "series_downloaded",
          title: "Downloads finished",
          body: `${series.title}: ${counts.available} of ${counts.total} episodes are available`,
          seriesId: series.id,
          jobId: null,
          data: { seriesTitle: series.title, ...counts },
        });
      });
    this.tails.set(series.id, run);
    return run.finally(() => {
      if (this.tails.get(series.id) === run) this.tails.delete(series.id);
    });
  }

  /** Only for a job that gave up: a permanent error, or the retries ran out. */
  async jobFailed(
    job: Job,
    about: { seriesTitle: string | null; episodeCode: string | null },
  ): Promise<void> {
    const what = [about.seriesTitle, about.episodeCode].filter(Boolean).join(" ") || job.kind;
    const error = job.lastError ?? "Unknown error";
    await this.send({
      kind: "job_failed",
      title: "A job failed",
      body: `${what}: ${error}`,
      seriesId: job.seriesId,
      jobId: job.id,
      data: {
        seriesTitle: about.seriesTitle,
        episodeCode: about.episodeCode,
        jobKind: job.kind,
        error,
      },
    });
  }

  /** Deletes the notifications older than the retention. */
  async prune(): Promise<void> {
    await this.options.repository.deleteOlderThan(
      this.options.clock.now() - NOTIFICATION_RETENTION_MS,
    );
  }

  private async send(draft: Draft): Promise<void> {
    const notification: Notification = {
      ...draft,
      id: uuidv7(this.options.clock.now()),
      createdAt: this.options.clock.now(),
      readAt: null,
    };
    const [panel, ...others] = this.options.notifiers;
    // The record comes first; a panel that cannot store it is a real error for the caller.
    if (panel) await panel.notify(notification);
    await Promise.all(
      others.map((notifier) =>
        notifier.notify(notification).catch((error: unknown) => {
          (this.options.onError ?? ((e) => console.error("notifier failed:", e)))(error);
        }),
      ),
    );
  }
}

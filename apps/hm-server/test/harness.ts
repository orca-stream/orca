import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiteExtractor } from "@orca/extractor-core";
import { createUseCases } from "../src/application/use-cases.ts";
import type { Deps } from "../src/application/deps.ts";
import { createJobEvents } from "../src/application/job-events.ts";
import { createJobHandler } from "../src/application/job-handler.ts";
import { JobQueue } from "../src/application/queue.ts";
import { NotificationService, PanelNotifier } from "../src/application/notifications.ts";
import { InMemoryEventBus } from "../src/infrastructure/event-bus.ts";
import { StaticExtractorRegistry } from "../src/infrastructure/extractor-registry.ts";
import { InMemoryPreviewStore } from "../src/infrastructure/preview-store.ts";
import { FsLibraryWriter } from "../src/infrastructure/library/fs-library-writer.ts";
import { FixedRandom } from "./fakes/clock.ts";
import {
  FakeAuthenticator,
  FakeDownloader,
  FakeImageFetcher,
  FakeEpisodeGuide,
  FakeMediaServer,
  RecordingNotifier,
  FakeStreamDetector,
} from "./fakes/ports.ts";
import { createRecordedExtractor } from "./fakes/recorded-site.ts";
import { testDatabase, testGuard } from "./helpers.ts";
import type { HmEvent } from "@orca/hm-contract";

export const BEVHILL = "bevhill-s01e01-36";
export const BEVHILL_URL = `https://archive.org/details/${BEVHILL}`;

/**
 * The whole server minus HTTP and the network: real SQLite, real queue, a recorded site extractor, real library on a temp folder; fake downloader, Jellyfin and image fetcher.
 */
export async function createHarness(
  options: {
    limits?: Partial<Record<"browser" | "ffmpeg" | "download" | "none", number>>;
    /** Extra sites next to the recorded one. */
    extractors?: SiteExtractor[];
    /** One episode at a time, players in order (SEQUENTIAL_DOWNLOADS). */
    sequentialDownloads?: boolean;
    /** Hosts whose players are never tried (SKIP_PLAYERS). */
    skipPlayers?: string[];
  } = {},
) {
  const db = testDatabase();
  const root = await mkdtemp(join(tmpdir(), "hm-harness-"));
  const events: HmEvent[] = [];
  const bus = new InMemoryEventBus();
  bus.subscribe((event) => events.push(event));

  const downloader = new FakeDownloader();
  const mediaServer = new FakeMediaServer();
  const episodeGuide = new FakeEpisodeGuide();
  const authenticator = new FakeAuthenticator();
  const images = new FakeImageFetcher();
  const detector = new FakeStreamDetector();
  const library = new FsLibraryWriter(root);
  const extraNotifier = new RecordingNotifier();

  const deps: Deps = {
    clock: db.clock,
    random: new FixedRandom(1),
    series: db.series,
    jobs: db.jobs,
    sessions: db.sessions,
    extractors: new StaticExtractorRegistry([
      createRecordedExtractor(),
      ...(options.extractors ?? []),
    ]),
    previews: new InMemoryPreviewStore(db.clock),
    library,
    images,
    authenticator,
    mediaServer,
    episodeGuide,
    downloaders: [downloader],
    detector,
    guard: testGuard(),
    streamDefaults: {},
    sequentialDownloads: options.sequentialDownloads ?? false,
    skipPlayers: options.skipPlayers ?? [],
    events: bus,
    notifications: new NotificationService({
      notifiers: [new PanelNotifier(db.notifications, bus), extraNotifier],
      clock: db.clock,
      repository: db.notifications,
      onError: () => {},
    }),
    notificationRepository: db.notifications,
    refreshDebounceMs: 60_000,
    sessionTtlMs: 7 * 24 * 3600 * 1000,
    adminRecheckMs: 3600 * 1000,
    queue: { notify: () => queue.notify() },
    canceller: { cancel: (id) => queue.cancel(id), interrupt: (id) => queue.interrupt(id) },
  };

  const { queueEvents } = createJobEvents(deps);
  const queue = new JobQueue({
    jobs: db.jobs,
    clock: db.clock,
    random: deps.random,
    handler: createJobHandler(deps),
    events: queueEvents,
    limits: { browser: 1, ffmpeg: 1, download: 2, none: 4, ...options.limits },
    oneEpisodeAtATime: options.sequentialDownloads ?? false,
    heartbeatMs: 0,
    owner: "harness",
  });
  const useCases = createUseCases(deps);

  return {
    ...db,
    deps,
    useCases,
    queue,
    bus,
    events,
    root,
    downloader,
    mediaServer,
    episodeGuide,
    authenticator,
    images,
    detector,
    library,
    extraNotifier,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** Previews the bevhill fixture and adds every episode of it. */
export async function addBevhill(
  h: Harness,
  overrides: { downloadNow?: boolean; title?: string; year?: number | null } = {},
) {
  const preview = await h.useCases.previewSeries(BEVHILL_URL);
  const series = await h.useCases.addSeries({
    previewId: preview.previewId,
    title: overrides.title ?? "The Beverly Hillbillies",
    year: overrides.year === undefined ? 1962 : overrides.year,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    follow: false,
    downloadNow: overrides.downloadNow ?? false,
  });
  return { preview, series };
}

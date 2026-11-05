import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import type { SiteExtractor } from "@orca/extractor-core";
import { createHtmlExtractor } from "@orca/extractor-html";
import { createSeasonApiExtractor } from "@orca/extractor-season-api";
import { createShowApiExtractor } from "@orca/extractor-show-api";
import type { Jellyfin } from "@orca/jellyfin";
import { FfprobeInspector } from "@orca/media-probe";
import { GuardedProxy, PlaywrightStreamDetector } from "@orca/stream-detector";
import type { Deps } from "../application/deps.ts";
import { createEnqueueRefresh } from "../application/downloads.ts";
import { normalizeLibrary, repairEpisodePaths } from "../application/episodes.ts";
import { createJobEvents } from "../application/job-events.ts";
import { createJobHandler } from "../application/job-handler.ts";
import { NotificationService, PanelNotifier } from "../application/notifications.ts";
import { JobQueue } from "../application/queue.ts";
import { Scheduler, SCHEDULER_TICK_MS } from "../application/scheduler.ts";
import { createUseCases } from "../application/use-cases.ts";
import { assertChromium } from "./chromium-check.ts";
import { type BootConfig, type Config, userAgent } from "./config.ts";
import type { Database_ } from "./db/client.ts";
import { DrizzleJobRepository } from "./db/job-repository.ts";
import { DrizzleNotificationRepository } from "./db/notification-repository.ts";
import { DrizzleSeriesRepository } from "./db/series-repository.ts";
import { DrizzleSessionRepository } from "./db/session-repository.ts";
import {
  FfmpegDownloader,
  LOCAL_INPUT_OPTIONS,
  LOCAL_PROTOCOLS,
} from "./download/ffmpeg-downloader.ts";
import { HlsCopier } from "./download/hls-copier.ts";
import { HttpDownloader } from "./download/http-downloader.ts";
import type { InMemoryEventBus } from "./event-bus.ts";
import { StaticExtractorRegistry } from "./extractor-registry.ts";
import type { Extractors } from "./extractors-file.ts";
import { GenericPageExtractor } from "./generic-page-extractor.ts";
import { connectionsFor, HostLimiter, hostLimitsFor } from "./host-limiter.ts";
import { FetchHttpClient } from "./http-client.ts";
import { FetchImageFetcher } from "./image-fetcher.ts";
import { JellyfinAuthenticator } from "./jellyfin/authenticator.ts";
import { type LocalAdmin, LocalAdminAuthenticator } from "./local-admin.ts";
import { JellyfinMediaServer } from "./jellyfin/media-server.ts";
import { FsLibraryWriter } from "./library/fs-library-writer.ts";
import { AddressGuard, isBlockedAddress } from "./net/address-guard.ts";
import { PlaywrightDetectorAdapter } from "./playwright-detector-adapter.ts";
import { InMemoryPreviewStore } from "./preview-store.ts";
import { systemClock, systemRandom } from "./system.ts";
import { TmdbEpisodeGuide } from "./tmdb/tmdb-episode-guide.ts";
import { createApp, type SettingsRoutes } from "./web/app.ts";

/** ffprobe on a stream copied to disk: seconds at most; more means something is wrong. */
const LOCAL_PROBE_TIMEOUT_MS = 60_000;
/**
 * How long a direct download may take to open a connection, TLS included. Some players' servers take
 * 15–30 s to finish a handshake, past fetch's own 10 s.
 */
const DOWNLOAD_CONNECT_TIMEOUT_MS = 60_000;
/**
 * OpenSSL's own cipher list, the one curl and ffmpeg offer, instead of Node's: some CDNs behind
 * Cloudflare answer 403 to Node's TLS handshake alone, whatever the headers.
 */
const DOWNLOAD_TLS_CIPHERS = "DEFAULT";
/** The panel waits on TMDB while a person picks a season. */
const TMDB_TIMEOUT_MS = 10_000;

/** What outlives a change of settings: the database, the identity and the panel's event stream. */
export interface Shared {
  boot: BootConfig;
  version: string;
  database: Database_;
  jellyfin: Jellyfin;
  events: InMemoryEventBus;
  settings: SettingsRoutes;
  /** The server's own administrator, read at each sign-in so a new password needs no restart. */
  localAdmin: () => LocalAdmin | null;
}

/** Everything the settings decide, running: replaced as a whole when they change. */
export interface Runtime {
  fetch(request: Request, env: unknown): Response | Promise<Response>;
  /** Stops the queue, the scheduler and the browser; the database stays open. */
  stop(): Promise<void>;
}

/**
 * Builds and starts what the settings describe. Fails, having started nothing that keeps running,
 * when the browser they need is not there.
 */
export async function startRuntime(
  shared: Shared,
  config: Config,
  sites: Extractors,
): Promise<Runtime> {
  const { boot, database, jellyfin, events } = shared;
  // Fail before anything starts, not on the first page job, when the browser the detector needs is not there.
  if (config.detector) await assertChromium(config.detector);
  const agent = userAgent(shared.version, config.contactEmail);
  mkdirSync(resolve(config.mediaRoot), { recursive: true });
  const mediaRoot = resolve(config.mediaRoot);

  // Every address a page or a stream gives us goes through this before anything connects to it.
  const guard = new AddressGuard();
  const extractors: SiteExtractor[] = [];
  // Reads `extractors` when a host is first seen, so it may be filled in after the limiter exists.
  const limiter = new HostLimiter({
    limitsFor: hostLimitsFor(extractors, config.hostLimits),
    clock: systemClock,
  });
  const http = new FetchHttpClient({ userAgent: agent, limiter });
  const downloadDispatcher = new Agent({
    connect: { timeout: DOWNLOAD_CONNECT_TIMEOUT_MS, ciphers: DOWNLOAD_TLS_CIPHERS },
  });
  const downloadFetch = ((input, init) =>
    undiciFetch(
      input as never,
      { ...(init as object), dispatcher: downloadDispatcher } as never,
    )) as typeof fetch;
  // The sites' players need the browser: without it they are left out rather than failing every job.
  if (config.detector) {
    for (const site of sites.pages) extractors.push(createHtmlExtractor({ site, http }));
    for (const site of sites.apis) extractors.push(createShowApiExtractor({ site, http }));
    for (const site of sites.seasonApis) extractors.push(createSeasonApiExtractor({ site, http }));
  }
  // Everything the browser and ffmpeg fetch goes through this proxy, which checks each address it is
  // asked for (redirects, segments and keys included) and connects to the IP it checked.
  const proxy = config.detector ? new GuardedProxy({ isBlockedAddress }) : null;
  await proxy?.start();

  // The browser exists only when something needs it (the generic extractor, or the players of the
  // extractors' sites); the generic extractor only when the settings ask for it.
  const detector =
    config.detector && proxy
      ? new PlaywrightDetectorAdapter(
          new PlaywrightStreamDetector({
            maxConcurrent: config.detector.maxConcurrent,
            timeoutMs: config.detector.timeoutMs,
            settleMs: config.detector.settleMs,
            isAllowed: (url) => guard.isAllowed(url),
            proxyUrl: proxy.url,
            ...(config.detector.userAgent ? { userAgent: config.detector.userAgent } : {}),
            launchOptions: {
              ...(config.detector.chromiumPath
                ? { executablePath: config.detector.chromiumPath }
                : {}),
              ...(config.detector.noSandbox ? { args: ["--no-sandbox"] } : {}),
            },
          }),
        )
      : null;
  if (detector && config.genericExtractor) extractors.push(new GenericPageExtractor({ guard }));
  const library = new FsLibraryWriter(mediaRoot);
  const series = new DrizzleSeriesRepository(database.db);
  const notificationRepository = new DrizzleNotificationRepository(database.db);

  // The queue needs the use cases' handler and they need the queue to wake it: the two ports below
  // close over `queue`, which exists by the time anything calls them.
  const deps: Deps = {
    clock: systemClock,
    random: systemRandom,
    series,
    jobs: new DrizzleJobRepository(database, systemClock),
    sessions: new DrizzleSessionRepository(database.db),
    extractors: new StaticExtractorRegistry(extractors),
    previews: new InMemoryPreviewStore(systemClock),
    library,
    images: new FetchImageFetcher({ userAgent: agent }),
    authenticator:
      config.signIn === "jellyfin" && config.jellyfin
        ? new JellyfinAuthenticator({
            jellyfin,
            serverUrl: config.jellyfin.url,
            apiKey: config.jellyfin.apiKey,
          })
        : new LocalAdminAuthenticator(shared.localAdmin),
    mediaServer: config.jellyfin
      ? new JellyfinMediaServer({
          jellyfin,
          serverUrl: config.jellyfin.url,
          apiKey: config.jellyfin.apiKey,
          mediaRoot,
          jellyfinMediaRoot: config.jellyfin.mediaRoot,
        })
      : null,
    episodeGuide: config.tmdbApiKey
      ? new TmdbEpisodeGuide({
          apiKey: config.tmdbApiKey,
          userAgent: agent,
          timeoutMs: TMDB_TIMEOUT_MS,
        })
      : null,
    downloaders: [
      new HttpDownloader({
        userAgent: agent,
        limiter,
        guard,
        connectionsFor: connectionsFor(extractors, config.downloadConnections),
        fetch: downloadFetch,
      }),
      new FfmpegDownloader({
        userAgent: agent,
        guard,
        ...(proxy ? { httpProxy: proxy.url } : {}),
        inspector: new FfprobeInspector({
          timeoutMs: config.probeTimeoutMs,
          ...(proxy ? { httpProxy: proxy.url } : {}),
        }),
        externalSubtitles: config.externalSubtitles,
        copier: new HlsCopier({
          userAgent: agent,
          guard,
          connectionsFor: connectionsFor(extractors, config.downloadConnections),
          fetch: downloadFetch,
        }),
        localInspector: new FfprobeInspector({
          timeoutMs: LOCAL_PROBE_TIMEOUT_MS,
          protocolWhitelist: LOCAL_PROTOCOLS,
          inputOptions: LOCAL_INPUT_OPTIONS,
        }),
      }),
    ],
    detector,
    guard,
    streamDefaults: config.streamDefaults,
    sequentialDownloads: config.sequentialDownloads,
    skipPlayers: config.skipPlayers,
    events,
    // The panel's channel is the only one; ntfy and the like would be added to this list.
    notifications: new NotificationService({
      notifiers: [new PanelNotifier(notificationRepository, events)],
      clock: systemClock,
      repository: notificationRepository,
    }),
    notificationRepository,
    refreshDebounceMs: 60_000,
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    adminRecheckMs: 60 * 60 * 1000,
    queue: { notify: () => queue.notify() },
    canceller: { cancel: (id) => queue.cancel(id), interrupt: (id) => queue.interrupt(id) },
  };

  // --- queue and use cases
  const { queueEvents } = createJobEvents(deps);
  const queue = new JobQueue({
    jobs: deps.jobs,
    clock: systemClock,
    random: systemRandom,
    handler: createJobHandler(deps),
    events: queueEvents,
    limits: config.concurrency,
    oneEpisodeAtATime: config.sequentialDownloads,
  });
  const useCases = createUseCases(deps);

  // --- http
  const app = createApp({
    useCases,
    events,
    settings: shared.settings,
    secureCookies: boot.secureCookies,
    sessionTtlMs: deps.sessionTtlMs,
    ...(boot.webRoot ? { webRoot: resolve(boot.webRoot) } : {}),
  });

  // Housekeeping before any job runs; a failure here stops nothing.
  await repairEpisodePaths(deps)
    .then(
      (fixed) => fixed > 0 && console.log(`episode paths: ${fixed} pointed at their files again`),
    )
    .catch((error: unknown) => console.error("repairing episode paths failed:", error));
  await deps.jobs
    .dropSettledFailures()
    .then(
      (dropped) => dropped > 0 && console.log(`failures: ${dropped} already downloaded, cleared`),
    )
    .catch((error: unknown) => console.error("clearing settled failures failed:", error));
  await normalizeLibrary(deps)
    .then(async (renamed) => {
      if (renamed.length === 0) return;
      console.log(`library names: ${renamed.length} series renamed after their title and year`);
      // Jellyfin finds the old folder gone and a new one: it reads them from scratch.
      const enqueueRefresh = createEnqueueRefresh(deps);
      for (const id of renamed) await enqueueRefresh(id, { replaceMetadata: true });
    })
    .catch((error: unknown) => console.error("renaming the library failed:", error));
  await queue.start();
  const scheduler = new Scheduler(deps);
  scheduler.start({ everyMs: SCHEDULER_TICK_MS });
  console.log(
    `media: ${mediaRoot}; extractors: ${extractors.map((extractor) => extractor.id).join(", ")}`,
  );

  return {
    fetch: (request, env) => app.fetch(request, env),
    async stop() {
      await queue.stop();
      // A tick still running would write to a database that is about to close or be reused.
      await scheduler.stop();
      await detector?.dispose();
      await proxy?.close();
      await downloadDispatcher.destroy();
    },
  };
}

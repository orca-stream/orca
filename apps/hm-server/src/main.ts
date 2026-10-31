import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Agent, fetch as undiciFetch } from "undici";
import type { SiteExtractor } from "@orca/extractor-core";
import { createHtmlExtractor } from "@orca/extractor-html";
import { createInternetArchiveExtractor } from "@orca/extractor-internet-archive";
import { createShowApiExtractor } from "@orca/extractor-show-api";
import { createJellyfin } from "@orca/jellyfin";
import { FfprobeInspector } from "@orca/media-probe";
import { GuardedProxy, PlaywrightStreamDetector } from "@orca/stream-detector";
import type { Deps } from "./application/deps.ts";
import { createJobEvents } from "./application/job-events.ts";
import { createJobHandler } from "./application/job-handler.ts";
import { Scheduler, SCHEDULER_TICK_MS } from "./application/scheduler.ts";
import { NotificationService, PanelNotifier } from "./application/notifications.ts";
import { JobQueue } from "./application/queue.ts";
import { createUseCases } from "./application/use-cases.ts";
import { resolveDeviceId } from "./application/device-id.ts";
import { assertChromium } from "./infrastructure/chromium-check.ts";
import { deprecatedEnvWarnings, loadConfig, userAgent } from "./infrastructure/config.ts";
import { loadProfile } from "./infrastructure/profile.ts";
import { openDatabase } from "./infrastructure/db/client.ts";
import { DrizzleJobRepository } from "./infrastructure/db/job-repository.ts";
import { DrizzleNotificationRepository } from "./infrastructure/db/notification-repository.ts";
import { DrizzleSeriesRepository } from "./infrastructure/db/series-repository.ts";
import { DrizzleSessionRepository } from "./infrastructure/db/session-repository.ts";
import { DrizzleSettingsRepository } from "./infrastructure/db/settings-repository.ts";
import {
  FfmpegDownloader,
  LOCAL_INPUT_OPTIONS,
  LOCAL_PROTOCOLS,
} from "./infrastructure/download/ffmpeg-downloader.ts";
import { HlsCopier } from "./infrastructure/download/hls-copier.ts";
import { HttpDownloader } from "./infrastructure/download/http-downloader.ts";
import { AddressGuard, isBlockedAddress } from "./infrastructure/net/address-guard.ts";
import { GenericPageExtractor } from "./infrastructure/generic-page-extractor.ts";
import { PlaywrightDetectorAdapter } from "./infrastructure/playwright-detector-adapter.ts";
import { InMemoryEventBus } from "./infrastructure/event-bus.ts";
import { StaticExtractorRegistry } from "./infrastructure/extractor-registry.ts";
import { parseExtractorsFile } from "./infrastructure/extractors-file.ts";
import { connectionsFor, HostLimiter, hostLimitsFor } from "./infrastructure/host-limiter.ts";
import { FetchHttpClient } from "./infrastructure/http-client.ts";
import { FetchImageFetcher } from "./infrastructure/image-fetcher.ts";
import { JellyfinAuthenticator } from "./infrastructure/jellyfin/authenticator.ts";
import { JellyfinMediaServer } from "./infrastructure/jellyfin/media-server.ts";
import { TmdbEpisodeGuide } from "./infrastructure/tmdb/tmdb-episode-guide.ts";
import { FsLibraryWriter } from "./infrastructure/library/fs-library-writer.ts";
import { InMemoryPreviewStore } from "./infrastructure/preview-store.ts";
import { systemClock, systemRandom } from "./infrastructure/system.ts";
import { createApp } from "./infrastructure/web/app.ts";

// Registered before anything else runs so a rejection during startup is logged too.
process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

// `src/main.ts` and the bundled `dist/main.mjs` both sit one folder below the app root.
const appRoot = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
  version: string;
};

const profile = loadProfile(process.env, appRoot);
if (profile) console.log(`profile: ${profile}`);
const config = loadConfig(process.env);
for (const warning of deprecatedEnvWarnings(process.env)) console.warn(warning);
// Fail at boot, not on the first page job, when the browser the detector needs is not there.
if (config.detector) await assertChromium(config.detector);
const agent = userAgent(version, config.contactEmail);

mkdirSync(dirname(resolve(config.dbFile)), { recursive: true });
mkdirSync(resolve(config.mediaRoot), { recursive: true });
const mediaRoot = resolve(config.mediaRoot);

/** ffprobe on a stream copied to disk: seconds at most; more means something is wrong. */
const LOCAL_PROBE_TIMEOUT_MS = 60_000;
/**
 * How long a direct download may take to open a connection, TLS included. Some players' servers take
 * 15–30 s to finish a handshake (player-c), past fetch's own 10 s.
 */
const DOWNLOAD_CONNECT_TIMEOUT_MS = 60_000;
/** The panel waits on TMDB while a person picks a season. */
const TMDB_TIMEOUT_MS = 10_000;

// --- adapters
const database = openDatabase({
  file: resolve(config.dbFile),
  migrationsFolder: resolve(appRoot, "drizzle"),
});
const deviceId = await resolveDeviceId({
  settings: new DrizzleSettingsRepository(database.db),
  override: config.deviceId,
});
const jellyfin = createJellyfin({
  clientInfo: { name: "Orca'H&M", version },
  deviceInfo: { id: deviceId, name: hostname() },
});
// Every address a page or a stream gives us goes through this before anything connects to it.
const guard = new AddressGuard();
const extractors: SiteExtractor[] = [];
// Reads `extractors` when a host is first seen, so it may be filled in after the limiter exists.
const limiter = new HostLimiter({
  limitsFor: hostLimitsFor(extractors, config.hostLimits),
  clock: systemClock,
});
const http = new FetchHttpClient({ userAgent: agent, limiter });
const downloadDispatcher = new Agent({ connect: { timeout: DOWNLOAD_CONNECT_TIMEOUT_MS } });
const downloadFetch = ((input, init) =>
  undiciFetch(
    input as never,
    { ...(init as object), dispatcher: downloadDispatcher } as never,
  )) as typeof fetch;
extractors.push(createInternetArchiveExtractor({ http }));
// Read once at boot: a typo in a selector or a pattern stops the server here, not on the first job.
if (config.extractorsFile) {
  const { pages, apis } = parseExtractorsFile(readFileSync(resolve(config.extractorsFile), "utf8"));
  for (const site of pages) extractors.push(createHtmlExtractor({ site, http }));
  for (const site of apis) extractors.push(createShowApiExtractor({ site, http }));
  console.log(
    `extractors file: ${pages.length + apis.length} site(s) from ${resolve(config.extractorsFile)}`,
  );
}
// Everything the browser and ffmpeg fetch goes through this proxy, which checks each address it is
// asked for (redirects, segments and keys included) and connects to the IP it checked.
const proxy = config.detector ? new GuardedProxy({ isBlockedAddress }) : null;
await proxy?.start();

// The browser exists only when something needs it (the generic extractor, or the players of the
// sites in the extractors file); the generic extractor only when HM_GENERIC_DETECTOR asks for it.
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
const events = new InMemoryEventBus();
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
  authenticator: new JellyfinAuthenticator({
    jellyfin,
    serverUrl: config.jellyfinUrl,
    apiKey: config.jellyfinApiKey,
  }),
  mediaServer: new JellyfinMediaServer({
    jellyfin,
    serverUrl: config.jellyfinUrl,
    apiKey: config.jellyfinApiKey,
    mediaRoot,
    jellyfinMediaRoot: config.jellyfinMediaRoot,
  }),
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
  secureCookies: config.secureCookies,
  sessionTtlMs: deps.sessionTtlMs,
  ...(config.webRoot ? { webRoot: resolve(config.webRoot) } : {}),
});

await queue.start();
const scheduler = new Scheduler(deps);
scheduler.start({ everyMs: SCHEDULER_TICK_MS });
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Orca'H&M ${version} listening on http://${info.address}:${info.port} (media: ${mediaRoot})`,
  );
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
  await queue.stop();
  // A tick still running would write to a database that is about to close.
  await scheduler.stop();
  await detector?.dispose();
  await proxy?.close();
  await downloadDispatcher.destroy();
  database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

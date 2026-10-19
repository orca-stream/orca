import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createInternetArchiveExtractor } from "@orca/extractor-internet-archive";
import { createJellyfin } from "@orca/jellyfin";
import type { Deps } from "./application/deps.ts";
import { createJobEvents } from "./application/job-events.ts";
import { createJobHandler } from "./application/job-handler.ts";
import { JobQueue } from "./application/queue.ts";
import { createUseCases } from "./application/use-cases.ts";
import { resolveDeviceId } from "./application/device-id.ts";
import { loadConfig } from "./infrastructure/config.ts";
import { openDatabase } from "./infrastructure/db/client.ts";
import { DrizzleJobRepository } from "./infrastructure/db/job-repository.ts";
import { DrizzleSeriesRepository } from "./infrastructure/db/series-repository.ts";
import { DrizzleSessionRepository } from "./infrastructure/db/session-repository.ts";
import { DrizzleSettingsRepository } from "./infrastructure/db/settings-repository.ts";
import { FfmpegDownloader } from "./infrastructure/download/ffmpeg-downloader.ts";
import { HttpDownloader } from "./infrastructure/download/http-downloader.ts";
import { InMemoryEventBus } from "./infrastructure/event-bus.ts";
import { StaticExtractorRegistry } from "./infrastructure/extractor-registry.ts";
import { FetchHttpClient } from "./infrastructure/http-client.ts";
import { FetchImageFetcher } from "./infrastructure/image-fetcher.ts";
import { JellyfinAuthenticator } from "./infrastructure/jellyfin/authenticator.ts";
import { JellyfinMediaServer } from "./infrastructure/jellyfin/media-server.ts";
import { FsLibraryWriter } from "./infrastructure/library/fs-library-writer.ts";
import { InMemoryPreviewStore } from "./infrastructure/preview-store.ts";
import { systemClock, systemRandom } from "./infrastructure/system.ts";
import { createApp } from "./infrastructure/web/app.ts";

// `src/main.ts` and the bundled `dist/main.mjs` both sit one folder below the app root.
const appRoot = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
  version: string;
};

const config = loadConfig(process.env);
const userAgent = `OrcaHM/${version} (+contact: 352633863+selkiecode@users.noreply.github.com)`;

mkdirSync(dirname(resolve(config.dbFile)), { recursive: true });
mkdirSync(resolve(config.mediaRoot), { recursive: true });
const mediaRoot = resolve(config.mediaRoot);

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
const events = new InMemoryEventBus();
const library = new FsLibraryWriter(mediaRoot);
const series = new DrizzleSeriesRepository(database.db);

// The queue needs the use cases' handler and they need the queue to wake it: the two ports below
// close over `queue`, which exists by the time anything calls them.
const deps: Deps = {
  clock: systemClock,
  random: systemRandom,
  series,
  jobs: new DrizzleJobRepository(database, systemClock),
  sessions: new DrizzleSessionRepository(database.db),
  extractors: new StaticExtractorRegistry([
    createInternetArchiveExtractor({ http: new FetchHttpClient({ userAgent }) }),
  ]),
  previews: new InMemoryPreviewStore(systemClock),
  library,
  images: new FetchImageFetcher({ userAgent }),
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
  downloaders: [
    new HttpDownloader({ userAgent, hostLimit: config.iaHostConcurrency }),
    new FfmpegDownloader({ userAgent }),
  ],
  // The Playwright detector arrives with the later phase; page sources fail clearly until then.
  detector: null,
  events,
  refreshDebounceMs: 60_000,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  adminRecheckMs: 60 * 60 * 1000,
  queue: { notify: () => queue.notify() },
  canceller: { cancel: (id) => queue.cancel(id) },
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
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Orca'H&M ${version} listening on http://${info.address}:${info.port} (media: ${mediaRoot})`,
  );
});

process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
  await queue.stop();
  database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

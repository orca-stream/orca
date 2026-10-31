import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createJellyfin } from "@orca/jellyfin";
import { resolveDeviceId } from "./application/device-id.ts";
import { deprecatedEnvWarnings, loadBootConfig, settingsFromEnv } from "./infrastructure/config.ts";
import { openDatabase } from "./infrastructure/db/client.ts";
import { DrizzleSettingsRepository } from "./infrastructure/db/settings-repository.ts";
import { InMemoryEventBus } from "./infrastructure/event-bus.ts";
import { JellyfinKeyMaker } from "./infrastructure/jellyfin/key-maker.ts";
import { loadProfile } from "./infrastructure/profile.ts";
import { startRuntime } from "./infrastructure/runtime.ts";
import { NO_EXTRACTORS, ServerSetup } from "./infrastructure/setup.ts";
import { createRootApp } from "./infrastructure/web/root.ts";

// Registered before anything else runs so a rejection during startup is logged too.
process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));

// `src/main.ts` and the bundled `dist/main.mjs` both sit one folder below the app root.
const appRoot = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
  version: string;
};

const profile = loadProfile(process.env, appRoot);
if (profile) console.log(`profile: ${profile}`);
const boot = loadBootConfig(process.env);

mkdirSync(dirname(resolve(boot.dbFile)), { recursive: true });
const database = openDatabase({
  file: resolve(boot.dbFile),
  migrationsFolder: resolve(appRoot, "drizzle"),
});
const settingsRepository = new DrizzleSettingsRepository(database.db);
const deviceId = await resolveDeviceId({ settings: settingsRepository, override: boot.deviceId });
const jellyfin = createJellyfin({
  clientInfo: { name: "Orca'H&M", version },
  deviceInfo: { id: deviceId, name: hostname() },
});
// One stream of events for the panel, whatever runtime the settings start.
const events = new InMemoryEventBus();

const setup: ServerSetup = new ServerSetup({
  settings: settingsRepository,
  start: (config, sites) =>
    startRuntime({ boot, version, database, jellyfin, events, settings: setup }, config, sites),
  connect: (url, username, password) =>
    new JellyfinKeyMaker({ jellyfin, appName: `Orca'H&M (${hostname()})` }).connect(
      url,
      username,
      password,
    ),
});

// A setup made in the environment, before the settings moved to the database, is carried over once.
let carried = false;
if (!(await setup.hasSaved())) {
  const legacy = settingsFromEnv(process.env);
  if (legacy) {
    const extractors = legacy.extractorsFile
      ? readFileSync(resolve(legacy.extractorsFile), "utf8")
      : NO_EXTRACTORS;
    await setup.adopt(legacy.settings, extractors);
    carried = true;
    console.log(
      "settings: carried over from the environment into the database; from now on they are changed from the panel",
    );
  }
}
for (const warning of deprecatedEnvWarnings(process.env, carried)) console.warn(warning);
if (!carried) await setup.boot();

const app = createRootApp({
  setup,
  ...(boot.webRoot ? { webRoot: resolve(boot.webRoot) } : {}),
});
const server = serve({ fetch: app.fetch, port: boot.port, hostname: boot.host }, (info) => {
  console.log(`Orca'H&M ${version} listening on http://${info.address}:${info.port}`);
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
  await setup.stop();
  database.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

import type { Settings } from "@orca/hm-contract";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { SettingsRepository } from "../src/application/ports.ts";
import { AppError } from "../src/domain/errors.ts";
import { ConfigError, type Config } from "../src/infrastructure/config.ts";
import type { Extractors } from "../src/infrastructure/extractors-file.ts";
import type { Runtime } from "../src/infrastructure/runtime.ts";
import { ServerSetup } from "../src/infrastructure/setup.ts";
import { createRootApp } from "../src/infrastructure/web/root.ts";

const settings: Settings = {
  jellyfin: {
    url: "http://jellyfin.test:8096",
    apiKey: "key-1",
    mediaRoot: "/tv",
    jellyfinMediaRoot: "/tv",
  },
  tmdbApiKey: "tmdb-1",
  downloads: {
    concurrency: 2,
    ffmpegConcurrency: 1,
    browserConcurrency: 1,
    sequential: true,
    skipPlayers: [],
    connections: 4,
    probeTimeoutMs: 180_000,
  },
  tracks: { externalSubtitles: false },
};
const browser = {
  genericDetector: false,
  maxConcurrent: 1,
  timeoutMs: 45_000,
  settleMs: 3000,
  noSandbox: false,
};
const SITE = JSON.stringify({
  mine: {
    reads: "page",
    hosts: ["origin.test"],
    example: "https://origin.test/anime/x",
    listing: { episodes: { selector: "a" } },
    mirrors: { selector: "button", attribute: "data-url" },
  },
});

class MemorySettings implements SettingsRepository {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
}

/** Runtimes started and stopped, in order; `refuse` makes the next start fail as a bad config. */
class Starts {
  readonly log: string[] = [];
  readonly configs: Config[] = [];
  readonly sites: Extractors[] = [];
  refuse: string | null = null;

  start = async (config: Config, sites: Extractors): Promise<Runtime> => {
    if (this.refuse) {
      const reason = this.refuse;
      this.refuse = null;
      throw new ConfigError(reason);
    }
    const n = this.configs.push(config);
    this.sites.push(sites);
    this.log.push(`start ${n}`);
    return {
      fetch: () => new Response(`runtime ${n}`),
      stop: async () => {
        this.log.push(`stop ${n}`);
      },
    };
  };
}

let repo: MemorySettings;
let starts: Starts;
let logged: string[];
let setup: ServerSetup;

function newSetup() {
  return new ServerSetup({
    settings: repo,
    start: starts.start,
    connect: async (url) => ({ url, serverName: "Home", apiKey: "made", libraries: [] }),
    log: (message) => logged.push(message),
  });
}

/** The code the console showed. */
const shownCode = () => /code: (\S+)/.exec(logged.at(-1) ?? "")?.[1] ?? "";

beforeEach(() => {
  repo = new MemorySettings();
  starts = new Starts();
  logged = [];
  setup = newSetup();
});

describe("a server with no settings", () => {
  beforeEach(() => setup.boot());

  it("starts nothing and prints a code for the panel", () => {
    expect(setup.configured).toBe(false);
    expect(starts.log).toEqual([]);
    expect(shownCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("asks for the code only away from this machine", () => {
    expect(setup.status(true)).toEqual({ configured: false, needsCode: false });
    expect(setup.status(false)).toEqual({ configured: false, needsCode: true });
  });

  it("refuses a wrong code, and takes the right one in any case and without the dash", async () => {
    await expect(setup.setup({ code: "NOPE-NOPE", settings }, false)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(setup.setup({ settings }, false)).rejects.toMatchObject({ code: "forbidden" });
    const code = shownCode().toLowerCase().replace("-", "");
    await setup.setup({ code, settings }, false);
    expect(setup.configured).toBe(true);
    expect(starts.log).toEqual(["start 1"]);
  });

  it("changes the code after too many wrong ones", async () => {
    const first = shownCode();
    for (let i = 0; i < 10; i++) {
      await setup.setup({ code: "XXXX-XXXX", settings }, false).catch(() => undefined);
    }
    expect(shownCode()).not.toBe(first);
    await expect(setup.setup({ code: first, settings }, false)).rejects.toBeInstanceOf(AppError);
  });

  it("is set up once, then keeps what it was given across a restart", async () => {
    await setup.setup({ settings: { ...settings, browser }, extractors: SITE }, true);
    await expect(setup.setup({ settings }, true)).rejects.toMatchObject({ code: "conflict" });
    expect(setup.status(false)).toEqual({ configured: true, needsCode: false });

    const again = newSetup();
    await again.boot();
    expect(again.configured).toBe(true);
    expect(await again.extractors()).toBe(SITE);
    expect((await again.view()).jellyfin.url).toBe("http://jellyfin.test:8096");
  });

  it("refuses sites without the browser their players need", async () => {
    await expect(setup.setup({ settings, extractors: SITE }, true)).rejects.toMatchObject({
      code: "bad_request",
      message: expect.stringMatching(/browser/),
    });
    expect(setup.configured).toBe(false);
    expect(repo.values.has("settings")).toBe(false);
  });
});

describe("a server with settings", () => {
  beforeEach(async () => {
    await setup.boot();
    await setup.setup({ settings: { ...settings, browser } }, true);
  });

  it("never shows its keys", async () => {
    const view = await setup.view();
    expect(view.jellyfin).not.toHaveProperty("apiKey");
    expect(view).not.toHaveProperty("tmdbApiKey");
    expect(view.hasTmdbApiKey).toBe(true);
  });

  it("restarts with a change, keeping a key left out and dropping one set to null", async () => {
    const { hasTmdbApiKey: _, ...view } = await setup.view();
    await setup.update({
      ...view,
      tmdbApiKey: null,
      downloads: { ...view.downloads, connections: 8 },
    });
    expect(starts.log).toEqual(["start 1", "stop 1", "start 2"]);
    expect(starts.configs[1]).toMatchObject({
      jellyfinApiKey: "key-1",
      tmdbApiKey: undefined,
      downloadConnections: 8,
    });
    const saved = JSON.parse(repo.values.get("settings")!) as Settings;
    expect(saved.jellyfin.apiKey).toBe("key-1");
    expect(saved.tmdbApiKey).toBeUndefined();
  });

  it("takes a new Jellyfin server's key", async () => {
    const { hasTmdbApiKey: _, ...view } = await setup.view();
    await setup.update({
      ...view,
      jellyfin: { ...view.jellyfin, url: "http://b.test", apiKey: "k2" },
    });
    expect(starts.configs[1]).toMatchObject({ jellyfinUrl: "http://b.test", jellyfinApiKey: "k2" });
  });

  it("goes back to what ran when a change cannot start, and saves nothing", async () => {
    const before = repo.values.get("settings");
    const { hasTmdbApiKey: _, ...view } = await setup.view();
    starts.refuse = "No Chromium at /nope";
    await expect(
      setup.update({ ...view, browser: { ...view.browser!, chromiumPath: "/nope" } }),
    ).rejects.toMatchObject({ code: "bad_request", message: "No Chromium at /nope" });
    expect(starts.log).toEqual(["start 1", "stop 1", "start 2"]);
    expect(setup.configured).toBe(true);
    expect(repo.values.get("settings")).toBe(before);
  });

  it("checks an extractors file before it replaces the old one", async () => {
    await expect(setup.saveExtractors("{")).rejects.toMatchObject({ code: "bad_request" });
    expect(starts.log).toEqual(["start 1"]);
    await setup.saveExtractors(SITE);
    expect(starts.sites.at(-1)?.pages.map((site) => site.id)).toEqual(["mine"]);
    expect(starts.configs.at(-1)?.detector).not.toBeNull();
    await setup.saveExtractors("  ");
    expect(await setup.extractors()).toBe("{}\n");
  });
});

describe("the front door", () => {
  const local = { incoming: { socket: { remoteAddress: "127.0.0.1", remotePort: 1 } } };
  const lan = { incoming: { socket: { remoteAddress: "192.168.1.20", remotePort: 1 } } };
  const app = () => createRootApp({ setup });
  const postJson = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  beforeEach(() => setup.boot());

  it("says the API is not set up yet, and asks for a code away from this machine", async () => {
    const res = await app().request("/api/series", {}, local);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    const status = async (path: string, env: unknown, headers: Record<string, string> = {}) =>
      (await app().request(path, { headers }, env)).json();
    expect(await status("/api/setup", local, { host: "localhost:5173" })).toEqual({
      configured: false,
      needsCode: false,
    });
    // The panel's development server proxies from here, but the browser that asked is on the LAN.
    expect(await status("/api/setup", local, { host: "192.168.1.5:5173" })).toMatchObject({
      needsCode: true,
    });
    expect(await status("/api/setup", lan, { host: "localhost:8787" })).toMatchObject({
      needsCode: true,
    });
  });

  it("sets the server up, then hands every request to what the settings started", async () => {
    const away = await app().request("/api/setup", postJson({ settings }), lan);
    expect(away.status).toBe(403);
    const res = await app().request(
      "/api/setup",
      postJson({ settings }, { origin: "http://localhost:5173" }),
      local,
    );
    expect(res.status).toBe(204);
    expect(await (await app().request("/api/series", {}, local)).text()).toBe("runtime 1");
    const again = await app().request(
      "/api/setup",
      postJson({ settings }, { origin: "http://localhost:5173" }),
      local,
    );
    expect(again.status).toBe(409);
  });

  it("refuses settings that are not valid, by where they are wrong", async () => {
    const res = await app().request(
      "/api/setup",
      postJson({
        settings: { ...settings, downloads: { ...settings.downloads, connections: 99 } },
      }),
      local,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      issues: [{ path: "settings.downloads.connections" }],
    });
  });
});

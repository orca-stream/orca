import type { Settings } from "@orca/hm-contract";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { SettingsRepository } from "../src/application/ports.ts";
import { ConfigError, type Config } from "../src/infrastructure/config.ts";
import type { Extractors } from "../src/infrastructure/extractors-file.ts";
import type { Runtime } from "../src/infrastructure/runtime.ts";
import { ServerSetup, upgradeSettings } from "../src/infrastructure/setup.ts";
import { createRootApp } from "../src/infrastructure/web/root.ts";

const settings: Settings = {
  signIn: "jellyfin",
  mediaRoot: "/tv",
  jellyfin: {
    url: "http://jellyfin.test:8096",
    apiKey: "key-1",
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

beforeEach(() => {
  repo = new MemorySettings();
  starts = new Starts();
  logged = [];
  setup = newSetup();
});

describe("a server with no settings", () => {
  beforeEach(() => setup.boot());

  it("starts nothing and says it waits for the panel", () => {
    expect(setup.configured).toBe(false);
    expect(starts.log).toEqual([]);
    expect(logged.at(-1)).toMatch(/open the panel/);
    expect(setup.status()).toEqual({ configured: false });
  });

  it("is set up once, then keeps what it was given across a restart", async () => {
    await setup.setup({ settings: { ...settings, browser }, extractors: SITE });
    await expect(setup.setup({ settings })).rejects.toMatchObject({ code: "conflict" });
    expect(setup.status()).toEqual({ configured: true, signIn: "jellyfin", jellyfin: true });

    const again = newSetup();
    await again.boot();
    expect(again.configured).toBe(true);
    expect(await again.extractors()).toBe(SITE);
    expect((await again.view()).jellyfin?.url).toBe("http://jellyfin.test:8096");
  });

  it("keeps its own administrator, hashed, when that is who signs in", async () => {
    const local = { ...settings, signIn: "local" as const };
    await expect(setup.setup({ settings: local })).rejects.toMatchObject({
      code: "bad_request",
      message: expect.stringMatching(/administrator/),
    });
    expect(setup.configured).toBe(false);

    await setup.setup({ settings: local, admin: { username: "admin", password: "long enough" } });
    expect(setup.status()).toEqual({ configured: true, signIn: "local", jellyfin: true });
    const stored = repo.values.get("admin")!;
    expect(stored).not.toContain("long enough");
    expect(JSON.parse(stored)).toMatchObject({ username: "admin" });
    expect(await setup.view()).toMatchObject({ localAdmin: { username: "admin" } });

    const again = newSetup();
    await again.boot();
    expect(again.localAdmin?.username).toBe("admin");
  });

  it("refuses sites without the browser their players need", async () => {
    await expect(setup.setup({ settings, extractors: SITE })).rejects.toMatchObject({
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
    await setup.setup({ settings: { ...settings, browser } });
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
      jellyfin: { apiKey: "key-1" },
      tmdbApiKey: undefined,
      downloadConnections: 8,
    });
    const saved = JSON.parse(repo.values.get("settings")!) as Settings;
    expect(saved.jellyfin?.apiKey).toBe("key-1");
    expect(saved.tmdbApiKey).toBeUndefined();
  });

  it("takes a new Jellyfin server's key", async () => {
    const { hasTmdbApiKey: _, ...view } = await setup.view();
    await setup.update({
      ...view,
      jellyfin: { jellyfinMediaRoot: "/tv", url: "http://b.test", apiKey: "k2" },
    });
    expect(starts.configs[1]).toMatchObject({ jellyfin: { url: "http://b.test", apiKey: "k2" } });
  });

  it("leaves Jellyfin, only once someone else can sign in", async () => {
    const { hasTmdbApiKey: _, jellyfin: __, ...view } = await setup.view();
    await expect(setup.update(view)).rejects.toMatchObject({
      code: "bad_request",
      message: expect.stringMatching(/Jellyfin/),
    });
    await setup.saveLocalAdmin({ username: "admin", password: "long enough" });
    await setup.update({ ...view, signIn: "local" });
    expect(starts.configs.at(-1)).toMatchObject({ jellyfin: null, mediaRoot: "/tv" });
    expect(setup.status()).toEqual({ configured: true, signIn: "local", jellyfin: false });
    expect(await setup.view()).not.toHaveProperty("jellyfin");
    // Back again, a server it has no key for is refused until it is connected.
    await expect(
      setup.update({
        ...view,
        signIn: "local",
        jellyfin: { url: "http://c.test", jellyfinMediaRoot: "/tv" },
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
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

  it("switches to its own administrator only once it has one", async () => {
    const { hasTmdbApiKey: _, localAdmin, ...view } = await setup.view();
    expect(localAdmin).toBeNull();
    await expect(setup.update({ ...view, signIn: "local" })).rejects.toMatchObject({
      code: "bad_request",
    });
    await setup.saveLocalAdmin({ username: "admin", password: "long enough" });
    await setup.update({ ...view, signIn: "local" });
    expect(starts.configs.at(-1)).toMatchObject({ signIn: "local" });
    expect(await setup.view()).toMatchObject({
      signIn: "local",
      localAdmin: { username: "admin" },
    });
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
  const lan = { incoming: { socket: { remoteAddress: "192.168.0.20", remotePort: 1 } } };
  const app = () => createRootApp({ setup });
  const postJson = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  beforeEach(() => setup.boot());

  it("says the API is not set up yet, to whoever asks", async () => {
    const res = await app().request("/api/series", {}, lan);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    expect(await (await app().request("/api/setup", {}, lan)).json()).toEqual({
      configured: false,
    });
  });

  it("sets the server up from any device, then hands every request to what the settings started", async () => {
    const res = await app().request("/api/setup", postJson({ settings }), lan);
    expect(res.status).toBe(204);
    expect(await (await app().request("/api/series", {}, lan)).text()).toBe("runtime 1");
    const again = await app().request("/api/setup", postJson({ settings }), lan);
    expect(again.status).toBe(409);
  });

  it("lists the server's folders only until it is set up", async () => {
    const before = await app().request(
      `/api/setup/folders?path=${encodeURIComponent("/")}`,
      {},
      lan,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ path: "/", parent: null });
    const bad = await app().request(
      "/api/setup/folders",
      postJson({ parent: "/", name: "../x" }),
      lan,
    );
    expect(bad.status).toBe(400);
    await app().request("/api/setup", postJson({ settings }), lan);
    const made = await app().request(
      "/api/setup/folders",
      postJson({ parent: "/", name: "x" }),
      lan,
    );
    expect(made.status).toBe(409);
    expect((await app().request("/api/setup/folders", {}, lan)).status).toBe(409);
  });

  it("refuses settings that are not valid, by where they are wrong", async () => {
    const res = await app().request(
      "/api/setup",
      postJson({
        settings: { ...settings, downloads: { ...settings.downloads, connections: 99 } },
      }),
      lan,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      issues: [{ path: "settings.downloads.connections" }],
    });
  });
});

describe("settings saved before Jellyfin was optional", () => {
  it("move the series folder out of jellyfin", async () => {
    const { mediaRoot, jellyfin, ...rest } = settings;
    repo.values.set(
      "settings",
      JSON.stringify({ ...rest, jellyfin: { ...jellyfin, mediaRoot: "/old/tv" } }),
    );
    await setup.boot();
    expect(starts.configs[0]).toMatchObject({
      mediaRoot: "/old/tv",
      jellyfin: { mediaRoot: "/tv" },
    });
    expect(upgradeSettings({ mediaRoot, jellyfin })).toEqual({ mediaRoot, jellyfin });
    expect(mediaRoot).toBe("/tv");
  });
});

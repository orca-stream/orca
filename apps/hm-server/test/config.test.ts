import { describe, expect, it } from "vite-plus/test";
import {
  ConfigError,
  configFrom,
  deprecatedEnvWarnings,
  loadBootConfig,
  settingsFromEnv,
  userAgent,
} from "../src/infrastructure/config.ts";
import { ExtractorsFileError, parseExtractorsFile } from "../src/infrastructure/extractors-file.ts";

const minimal = {
  JELLYFIN_URL: "http://localhost:8096",
  JELLYFIN_API_KEY: "key",
  DB_FILE: "./data/hm.sqlite",
  MEDIA_ROOT: "./media/tv",
  JELLYFIN_MEDIA_ROOT: "./media/tv",
  HOST: "localhost",
  PORT: "8787",
};

/** What a server set up in the environment of old ends up with: where it boots plus what it runs. */
function load(env: Record<string, string | undefined>) {
  const boot = loadBootConfig(env);
  const legacy = settingsFromEnv(env);
  if (!legacy) throw new Error("no setup in this environment");
  return {
    ...boot,
    ...configFrom(legacy.settings, legacy.extractorsFile !== undefined),
    extractorsFile: legacy.extractorsFile,
  };
}

describe("the environment of old", () => {
  it("reads the required values and fills in only tuning knobs", () => {
    const config = load(minimal);
    expect(config).toMatchObject({
      dbFile: "./data/hm.sqlite",
      mediaRoot: "./media/tv",
      jellyfinUrl: "http://localhost:8096",
      jellyfinApiKey: "key",
      jellyfinMediaRoot: "./media/tv",
      port: 8787,
      host: "localhost",
      secureCookies: false,
      sequentialDownloads: false,
      concurrency: { download: 2, ffmpeg: 1, browser: 1, none: 4 },
    });
    // Per-host limits come from the extractors unless the environment overrides them.
    expect(config.hostLimits).toEqual({});
    // One stream per file unless the environment asks for more.
    expect(config.downloadConnections).toBe(1);
    expect(config.webRoot).toBeUndefined();
    // No baked-in device id: it is generated once and stored, unless the environment overrides it.
    expect(config.deviceId).toBeUndefined();
    expect(config.contactEmail).toBeUndefined();
    expect(config.tmdbApiKey).toBeUndefined();
  });

  it("downloads one episode at a time only when asked", () => {
    expect(load({ ...minimal, SEQUENTIAL_DOWNLOADS: "true" }).sequentialDownloads).toBe(true);
    expect(() => load({ ...minimal, SEQUENTIAL_DOWNLOADS: "yes" })).toThrow(ConfigError);
  });

  it("reads the skipped player hosts as a lower-case list, and refuses addresses", () => {
    expect(load(minimal).skipPlayers).toEqual([]);
    expect(load({ ...minimal, SKIP_PLAYERS: " Player.example, other.example ," }).skipPlayers).toEqual([
      "player.example",
      "other.example",
    ]);
    expect(() => load({ ...minimal, SKIP_PLAYERS: "https://player.example/" })).toThrow(ConfigError);
  });

  it("takes a TMDB key when there is one", () => {
    expect(load({ ...minimal, TMDB_API_KEY: " abc " }).tmdbApiKey).toBe("abc");
  });

  it("is no setup at all without JELLYFIN_URL", () => {
    expect(settingsFromEnv({ ...minimal, JELLYFIN_URL: undefined })).toBeNull();
  });

  it.each(["HOST", "PORT", "DB_FILE", "MEDIA_ROOT", "JELLYFIN_MEDIA_ROOT", "JELLYFIN_API_KEY"])(
    "refuses to start without %s, and says so",
    (name) => {
      const env: Record<string, string | undefined> = { ...minimal };
      delete env[name];
      expect(() => load(env)).toThrow(new RegExp(name));
    },
  );

  it("reads everything from the environment", () => {
    const config = load({
      ...minimal,
      DB_FILE: "/data/hm.sqlite",
      MEDIA_ROOT: "/media/tv",
      JELLYFIN_MEDIA_ROOT: "/data/tv",
      PORT: "9000",
      HOST: "0.0.0.0",
      WEB_ROOT: "/app/web",
      SECURE_COOKIES: "true",
      DEVICE_ID: "nas-1",
      CONTACT_EMAIL: "ops@example.com",
      DOWNLOAD_CONCURRENCY: "3",
    });
    expect(config).toMatchObject({
      dbFile: "/data/hm.sqlite",
      mediaRoot: "/media/tv",
      jellyfinMediaRoot: "/data/tv",
      port: 9000,
      host: "0.0.0.0",
      webRoot: "/app/web",
      secureCookies: true,
      deviceId: "nas-1",
      contactEmail: "ops@example.com",
    });
    expect(config.concurrency.download).toBe(3);
  });

  it("overrides the extractors' per-host limits only when asked to", () => {
    expect(
      load({ ...minimal, DOWNLOADS_PER_HOST: "3", METADATA_PER_SEC: "0.5" }).hostLimits,
    ).toEqual({ downloadsPerHost: 3, metadataPerSec: 0.5 });
    expect(() => load({ ...minimal, METADATA_PER_SEC: "0" })).toThrow(/METADATA_PER_SEC/);
    expect(() => load({ ...minimal, DOWNLOADS_PER_HOST: "0" })).toThrow(/DOWNLOADS_PER_HOST/);
  });

  it("reads how many connections a direct file is fetched over, within 1 to 16", () => {
    expect(load({ ...minimal, DOWNLOAD_CONNECTIONS: "4" }).downloadConnections).toBe(4);
    expect(() => load({ ...minimal, DOWNLOAD_CONNECTIONS: "0" })).toThrow(/DOWNLOAD_CONNECTIONS/);
    expect(() => load({ ...minimal, DOWNLOAD_CONNECTIONS: "17" })).toThrow(/DOWNLOAD_CONNECTIONS/);
  });

  it("explains every problem at once", () => {
    const messageOf = (run: () => unknown) => {
      try {
        run();
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        return (e as ConfigError).message;
      }
      throw new Error("expected it to throw");
    };
    const boot = messageOf(() => loadBootConfig({ PORT: "nope" }));
    expect(boot).toContain("PORT");
    expect(boot).toContain("DB_FILE");
    const legacy = messageOf(() => settingsFromEnv({ JELLYFIN_URL: "not a url" }));
    expect(legacy).toContain("JELLYFIN_URL");
    expect(legacy).toContain("JELLYFIN_API_KEY");
  });

  it("strips the trailing slash from the Jellyfin url", () => {
    expect(load({ ...minimal, JELLYFIN_URL: "http://jellyfin:8096/" }).jellyfinUrl).toBe(
      "http://jellyfin:8096",
    );
  });
});

describe("userAgent", () => {
  it("names the app and, when configured, who to write to", () => {
    expect(userAgent("1.2.3", "ops@example.com")).toBe("OrcaHM/1.2.3 (+contact: ops@example.com)");
    expect(userAgent("1.2.3", undefined)).toBe("OrcaHM/1.2.3");
  });

  it("rejects a contact that is not an email", () => {
    expect(() => load({ ...minimal, CONTACT_EMAIL: "nope" })).toThrow(/CONTACT_EMAIL/);
  });
});

describe("the generic detector", () => {
  const on = {
    ...minimal,
    HM_GENERIC_DETECTOR: "1",
    HM_DETECTOR_MAX_CONCURRENT: "2",
    HM_DETECTOR_TIMEOUT_MS: "45000",
    HM_DETECTOR_SETTLE_MS: "3000",
  };

  it("is off unless HM_GENERIC_DETECTOR enables it, and then asks for nothing else", () => {
    expect(load(minimal).detector).toBeNull();
    expect(load({ ...minimal, HM_GENERIC_DETECTOR: "0" }).detector).toBeNull();
    expect(load({ ...minimal, HM_GENERIC_DETECTOR: "false" }).detector).toBeNull();
  });

  it("reads its tuning from the environment when it is on", () => {
    expect(load(on).detector).toEqual({
      maxConcurrent: 2,
      timeoutMs: 45_000,
      settleMs: 3000,
      userAgent: undefined,
      chromiumPath: undefined,
      noSandbox: false,
    });
    expect(
      load({
        ...on,
        HM_DETECTOR_USER_AGENT: "Mozilla/5.0 Test",
        HM_CHROMIUM_PATH: "/usr/bin/chromium",
        HM_CHROMIUM_NO_SANDBOX: "true",
      }).detector,
    ).toMatchObject({
      userAgent: "Mozilla/5.0 Test",
      chromiumPath: "/usr/bin/chromium",
      noSandbox: true,
    });
  });

  it.each(["HM_DETECTOR_MAX_CONCURRENT", "HM_DETECTOR_TIMEOUT_MS", "HM_DETECTOR_SETTLE_MS"])(
    "refuses to start with the detector on and no %s, because it has no default",
    (name) => {
      const env: Record<string, string | undefined> = { ...on };
      delete env[name];
      expect(() => load(env)).toThrow(new RegExp(name));
    },
  );

  it("rejects nonsense values", () => {
    expect(() => load({ ...on, HM_DETECTOR_MAX_CONCURRENT: "0" })).toThrow(/MAX_CONCURRENT/);
    expect(() => load({ ...on, HM_DETECTOR_TIMEOUT_MS: "-1" })).toThrow(/TIMEOUT_MS/);
    expect(() => load({ ...on, HM_DETECTOR_SETTLE_MS: "x" })).toThrow(/SETTLE_MS/);
  });

  it("ignores the tuning when the detector is off", () => {
    expect(load({ ...minimal, HM_DETECTOR_TIMEOUT_MS: "oops" }).detector).toBeNull();
  });
});

describe("the settings", () => {
  it("carry an environment's setup over, extractors file included", () => {
    const legacy = settingsFromEnv({
      ...minimal,
      TMDB_API_KEY: "t",
      SKIP_PLAYERS: "player.example",
      HM_EXTRACTORS_FILE: "./extractors.json",
      HM_DETECTOR_MAX_CONCURRENT: "1",
      HM_DETECTOR_TIMEOUT_MS: "45000",
      HM_DETECTOR_SETTLE_MS: "3000",
    });
    expect(legacy).toMatchObject({
      extractorsFile: "./extractors.json",
      settings: {
        jellyfin: { url: "http://localhost:8096", apiKey: "key", mediaRoot: "./media/tv" },
        tmdbApiKey: "t",
        downloads: { skipPlayers: ["player.example"], connections: 1 },
        browser: { genericDetector: false, maxConcurrent: 1 },
      },
    });
    expect(settingsFromEnv(minimal)?.settings.browser).toBeUndefined();
  });

  it("start the browser only when something needs it", () => {
    const { settings } = settingsFromEnv({
      ...minimal,
      HM_EXTRACTORS_FILE: "./extractors.json",
      HM_DETECTOR_MAX_CONCURRENT: "1",
      HM_DETECTOR_TIMEOUT_MS: "45000",
      HM_DETECTOR_SETTLE_MS: "3000",
    })!;
    expect(configFrom(settings, true).detector).toMatchObject({ maxConcurrent: 1 });
    expect(configFrom(settings, false).detector).toBeNull();
    const generic = { ...settings, browser: { ...settings.browser!, genericDetector: true } };
    expect(configFrom(generic, false)).toMatchObject({ genericExtractor: true });
  });

  it("warn about every variable the panel now rules, except on the boot that carried them", () => {
    expect(deprecatedEnvWarnings(minimal)).toEqual([
      expect.stringMatching(/JELLYFIN_URL.*JELLYFIN_API_KEY/),
    ]);
    expect(deprecatedEnvWarnings(minimal, true)).toEqual([]);
    expect(deprecatedEnvWarnings({ HOST: "x", PORT: "1", DB_FILE: "d" })).toEqual([]);
  });
});

describe("the extractors file", () => {
  const tuning = {
    HM_DETECTOR_MAX_CONCURRENT: "2",
    HM_DETECTOR_TIMEOUT_MS: "45000",
    HM_DETECTOR_SETTLE_MS: "3000",
  };

  it("turns the browser on for the sites' players, without the generic extractor", () => {
    const config = load({ ...minimal, ...tuning, HM_EXTRACTORS_FILE: "./extractors.json" });
    expect(config).toMatchObject({ extractorsFile: "./extractors.json", genericExtractor: false });
    expect(config.detector).toMatchObject({ maxConcurrent: 2 });
    expect(load(minimal)).toMatchObject({
      extractorsFile: undefined,
      genericExtractor: false,
    });
  });

  it("asks for the browser's tuning, which has no default", () => {
    expect(() => load({ ...minimal, HM_EXTRACTORS_FILE: "./extractors.json" })).toThrow(
      /HM_DETECTOR_TIMEOUT_MS/,
    );
  });

  it("warns about the two files it replaced", () => {
    expect(
      deprecatedEnvWarnings({ HM_SITES_FILE: "./sites.json", HM_SHOW_API_FILE: "./show-api.json" }),
    ).toEqual([
      expect.stringContaining("HM_SITES_FILE is ignored"),
      expect.stringContaining("HM_SHOW_API_FILE is ignored"),
    ]);
  });

  it("ships an example that is a valid extractors file", async () => {
    const { readFile } = await import("node:fs/promises");
    const example = await readFile(new URL("../extractors.example.json", import.meta.url), "utf8");
    const { pages, apis } = parseExtractorsFile(example);
    expect(pages.map((site) => [site.id, site.name])).toEqual([["site-a", "Site A"]]);
    expect(apis.map((site) => [site.id, site.name])).toEqual([["site-b", "site-b"]]);
  });
});

describe("parseExtractorsFile", () => {
  const page = {
    reads: "page",
    hosts: ["origin.test"],
    example: "https://origin.test/anime/x",
    listing: { episodes: { selector: "a" } },
    mirrors: { selector: "button", attribute: "data-url" },
  };
  const api = {
    reads: "api",
    hosts: ["other.test"],
    example: "https://other.test/series/x",
    showPath: "^/series/([^/]+)$",
    api: "https://other.test/api/",
  };

  it("names each site by its key, and reads it the way the entry says", () => {
    const { pages, apis } = parseExtractorsFile(
      JSON.stringify({ mine: page, theirs: { ...api, name: "Their site" } }),
    );
    expect(pages).toMatchObject([
      { id: "mine", name: "mine", listing: { episodes: { attribute: "href" } } },
    ]);
    expect(apis).toMatchObject([
      { id: "theirs", name: "Their site", api: "https://other.test/api" },
    ]);
    expect(pages[0]).not.toHaveProperty("reads");
  });

  it("lists every problem by where it is", () => {
    const bad = JSON.stringify({
      "Bad Key": page,
      mine: { ...page, hosts: ["https://x.test"] },
      theirs: { ...api, showPath: "^/series/[^/]+$" },
      other: { ...page, reads: "rss" },
    });
    expect(() => parseExtractorsFile(bad)).toThrow(ExtractorsFileError);
    const message = (() => {
      try {
        parseExtractorsFile(bad);
      } catch (error) {
        return (error as Error).message;
      }
    })();
    for (const path of ["Bad Key", "mine.hosts.0", "theirs.showPath", "other.reads"]) {
      expect(message).toContain(path);
    }
  });

  it("refuses what is not JSON", () => {
    expect(() => parseExtractorsFile("{")).toThrow(/not valid JSON/);
  });
});

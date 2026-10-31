import { describe, expect, it } from "vite-plus/test";
import {
  ConfigError,
  deprecatedEnvWarnings,
  loadConfig,
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

describe("loadConfig", () => {
  it("reads the required values and fills in only tuning knobs", () => {
    const config = loadConfig(minimal);
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
    expect(loadConfig({ ...minimal, SEQUENTIAL_DOWNLOADS: "true" }).sequentialDownloads).toBe(true);
    expect(() => loadConfig({ ...minimal, SEQUENTIAL_DOWNLOADS: "yes" })).toThrow(ConfigError);
  });

  it("reads the skipped player hosts as a lower-case list, and refuses addresses", () => {
    expect(loadConfig(minimal).skipPlayers).toEqual([]);
    expect(
      loadConfig({ ...minimal, SKIP_PLAYERS: " Player.example, other.example ," }).skipPlayers,
    ).toEqual(["player.example", "other.example"]);
    expect(() => loadConfig({ ...minimal, SKIP_PLAYERS: "https://player.example/" })).toThrow(ConfigError);
  });

  it("takes a TMDB key when there is one", () => {
    expect(loadConfig({ ...minimal, TMDB_API_KEY: " abc " }).tmdbApiKey).toBe("abc");
  });

  it.each([
    "HOST",
    "PORT",
    "DB_FILE",
    "MEDIA_ROOT",
    "JELLYFIN_MEDIA_ROOT",
    "JELLYFIN_URL",
    "JELLYFIN_API_KEY",
  ])("refuses to start without %s, and says so", (name) => {
    const env: Record<string, string | undefined> = { ...minimal };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(new RegExp(name));
  });

  it("reads everything from the environment", () => {
    const config = loadConfig({
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
      loadConfig({ ...minimal, DOWNLOADS_PER_HOST: "3", METADATA_PER_SEC: "0.5" }).hostLimits,
    ).toEqual({ downloadsPerHost: 3, metadataPerSec: 0.5 });
    expect(() => loadConfig({ ...minimal, METADATA_PER_SEC: "0" })).toThrow(/METADATA_PER_SEC/);
    expect(() => loadConfig({ ...minimal, DOWNLOADS_PER_HOST: "0" })).toThrow(/DOWNLOADS_PER_HOST/);
  });

  it("reads how many connections a direct file is fetched over, within 1 to 16", () => {
    expect(loadConfig({ ...minimal, DOWNLOAD_CONNECTIONS: "4" }).downloadConnections).toBe(4);
    expect(() => loadConfig({ ...minimal, DOWNLOAD_CONNECTIONS: "0" })).toThrow(
      /DOWNLOAD_CONNECTIONS/,
    );
    expect(() => loadConfig({ ...minimal, DOWNLOAD_CONNECTIONS: "17" })).toThrow(
      /DOWNLOAD_CONNECTIONS/,
    );
  });

  it("explains every problem at once", () => {
    const error = (() => {
      try {
        loadConfig({ PORT: "nope", JELLYFIN_URL: "not a url" });
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected loadConfig to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain("JELLYFIN_URL");
    expect(error.message).toContain("JELLYFIN_API_KEY");
    expect(error.message).toContain("PORT");
  });

  it("strips the trailing slash from the Jellyfin url", () => {
    expect(loadConfig({ ...minimal, JELLYFIN_URL: "http://jellyfin:8096/" }).jellyfinUrl).toBe(
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
    expect(() =>
      loadConfig({
        JELLYFIN_URL: "http://localhost:8096",
        JELLYFIN_API_KEY: "k",
        CONTACT_EMAIL: "nope",
      }),
    ).toThrow(/CONTACT_EMAIL/);
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
    expect(loadConfig(minimal).detector).toBeNull();
    expect(loadConfig({ ...minimal, HM_GENERIC_DETECTOR: "0" }).detector).toBeNull();
    expect(loadConfig({ ...minimal, HM_GENERIC_DETECTOR: "false" }).detector).toBeNull();
  });

  it("reads its tuning from the environment when it is on", () => {
    expect(loadConfig(on).detector).toEqual({
      maxConcurrent: 2,
      timeoutMs: 45_000,
      settleMs: 3000,
      userAgent: undefined,
      chromiumPath: undefined,
      noSandbox: false,
    });
    expect(
      loadConfig({
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
      expect(() => loadConfig(env)).toThrow(new RegExp(name));
    },
  );

  it("rejects nonsense values", () => {
    expect(() => loadConfig({ ...on, HM_DETECTOR_MAX_CONCURRENT: "0" })).toThrow(/MAX_CONCURRENT/);
    expect(() => loadConfig({ ...on, HM_DETECTOR_TIMEOUT_MS: "-1" })).toThrow(/TIMEOUT_MS/);
    expect(() => loadConfig({ ...on, HM_DETECTOR_SETTLE_MS: "x" })).toThrow(/SETTLE_MS/);
  });

  it("ignores the tuning when the detector is off", () => {
    expect(loadConfig({ ...minimal, HM_DETECTOR_TIMEOUT_MS: "oops" }).detector).toBeNull();
  });
});

describe("the extractors file", () => {
  const tuning = {
    HM_DETECTOR_MAX_CONCURRENT: "2",
    HM_DETECTOR_TIMEOUT_MS: "45000",
    HM_DETECTOR_SETTLE_MS: "3000",
  };

  it("turns the browser on for the sites' players, without the generic extractor", () => {
    const config = loadConfig({ ...minimal, ...tuning, HM_EXTRACTORS_FILE: "./extractors.json" });
    expect(config).toMatchObject({ extractorsFile: "./extractors.json", genericExtractor: false });
    expect(config.detector).toMatchObject({ maxConcurrent: 2 });
    expect(loadConfig(minimal)).toMatchObject({
      extractorsFile: undefined,
      genericExtractor: false,
    });
  });

  it("asks for the browser's tuning, which has no default", () => {
    expect(() => loadConfig({ ...minimal, HM_EXTRACTORS_FILE: "./extractors.json" })).toThrow(
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

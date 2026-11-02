import { describe, expect, it } from "vite-plus/test";
import { Settings } from "@orca/hm-contract";
import {
  ConfigError,
  configFrom,
  loadBootConfig,
  userAgent,
} from "../src/infrastructure/config.ts";
import { ExtractorsFileError, parseExtractorsFile } from "../src/infrastructure/extractors-file.ts";

const boot = { DB_FILE: "./data/hm.sqlite", HOST: "localhost", PORT: "8787" };

/** The least a server is set up with from the panel. */
const minimal = Settings.parse({
  jellyfin: {
    url: "http://localhost:8096",
    apiKey: "key",
    mediaRoot: "./media/tv",
    jellyfinMediaRoot: "./media/tv",
  },
  downloads: {
    concurrency: 2,
    ffmpegConcurrency: 1,
    browserConcurrency: 1,
    sequential: false,
    skipPlayers: [],
    connections: 1,
    probeTimeoutMs: 180_000,
  },
  tracks: { externalSubtitles: false },
});

const browser = {
  genericDetector: false,
  maxConcurrent: 2,
  timeoutMs: 45_000,
  settleMs: 3000,
  noSandbox: false,
};

describe("the environment", () => {
  it("only says where the server listens and keeps its database", () => {
    expect(loadBootConfig(boot)).toEqual({
      dbFile: "./data/hm.sqlite",
      port: 8787,
      host: "localhost",
      webRoot: undefined,
      // No baked-in device id: it is generated once and stored, unless the environment overrides it.
      deviceId: undefined,
      secureCookies: false,
    });
  });

  it("reads the deployment-only values", () => {
    expect(
      loadBootConfig({
        ...boot,
        WEB_ROOT: "/app/web",
        SECURE_COOKIES: "true",
        DEVICE_ID: "nas-1",
      }),
    ).toMatchObject({ webRoot: "/app/web", secureCookies: true, deviceId: "nas-1" });
  });

  it.each(["HOST", "PORT", "DB_FILE"])("refuses to start without %s, and says so", (name) => {
    const env: Record<string, string | undefined> = { ...boot };
    delete env[name];
    expect(() => loadBootConfig(env)).toThrow(new RegExp(name));
  });

  it("explains every problem at once", () => {
    let message = "";
    try {
      loadBootConfig({ PORT: "nope" });
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      message = (e as ConfigError).message;
    }
    expect(message).toContain("PORT");
    expect(message).toContain("DB_FILE");
  });
});

describe("configFrom", () => {
  it("runs what the settings say, and fills in only what they leave out", () => {
    expect(configFrom(minimal, false)).toMatchObject({
      mediaRoot: "./media/tv",
      jellyfinUrl: "http://localhost:8096",
      jellyfinApiKey: "key",
      jellyfinMediaRoot: "./media/tv",
      sequentialDownloads: false,
      skipPlayers: [],
      concurrency: { download: 2, ffmpeg: 1, browser: 1, none: 4 },
      // Per-host limits come from the extractors unless the settings override them.
      hostLimits: {},
      downloadConnections: 1,
      probeTimeoutMs: 180_000,
      streamDefaults: {},
      externalSubtitles: false,
      tmdbApiKey: undefined,
      contactEmail: undefined,
    });
  });

  it("overrides the extractors' per-host limits only when asked to", () => {
    const settings = {
      ...minimal,
      downloads: { ...minimal.downloads, downloadsPerHost: 3, metadataPerSec: 0.5 },
    };
    expect(configFrom(settings, false).hostLimits).toEqual({
      downloadsPerHost: 3,
      metadataPerSec: 0.5,
    });
  });

  it("has no browser without browser settings, whatever the extractors describe", () => {
    expect(configFrom(minimal, true).detector).toBeNull();
    expect(configFrom(minimal, true).genericExtractor).toBe(false);
  });

  it("starts the browser only when something needs it", () => {
    const settings = { ...minimal, browser };
    expect(configFrom(settings, true).detector).toEqual({
      maxConcurrent: 2,
      timeoutMs: 45_000,
      settleMs: 3000,
      userAgent: undefined,
      chromiumPath: undefined,
      noSandbox: false,
    });
    expect(configFrom(settings, true).genericExtractor).toBe(false);
    expect(configFrom(settings, false).detector).toBeNull();
    const generic = { ...minimal, browser: { ...browser, genericDetector: true } };
    expect(configFrom(generic, false)).toMatchObject({ genericExtractor: true });
  });
});

describe("userAgent", () => {
  it("names the app and, when configured, who to write to", () => {
    expect(userAgent("1.2.3", "ops@example.com")).toBe("OrcaHM/1.2.3 (+contact: ops@example.com)");
    expect(userAgent("1.2.3", undefined)).toBe("OrcaHM/1.2.3");
  });
});

describe("the extractors file", () => {
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

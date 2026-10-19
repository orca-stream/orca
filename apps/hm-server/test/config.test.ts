import { describe, expect, it } from "vite-plus/test";
import { ConfigError, loadConfig } from "../src/infrastructure/config.ts";

const minimal = { JELLYFIN_URL: "http://jellyfin:8096", JELLYFIN_API_KEY: "key" };

describe("loadConfig", () => {
  it("fills in the defaults", () => {
    const config = loadConfig(minimal);
    expect(config).toMatchObject({
      dbFile: "./data/hm.sqlite",
      mediaRoot: "./media/tv",
      jellyfinUrl: "http://jellyfin:8096",
      jellyfinApiKey: "key",
      jellyfinMediaRoot: "./media/tv",
      port: 8787,
      host: "127.0.0.1",
      secureCookies: false,
      concurrency: { download: 2, ffmpeg: 1, browser: 1, none: 4 },
      iaHostConcurrency: 1,
    });
    expect(config.webRoot).toBeUndefined();
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
    });
    expect(config.concurrency.download).toBe(3);
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

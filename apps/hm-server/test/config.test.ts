import { describe, expect, it } from "vite-plus/test";
import { ConfigError, loadConfig, userAgent } from "../src/infrastructure/config.ts";

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
      concurrency: { download: 2, ffmpeg: 1, browser: 1, none: 4 },
      iaHostConcurrency: 1,
    });
    expect(config.webRoot).toBeUndefined();
    // No baked-in device id: it is generated once and stored, unless the environment overrides it.
    expect(config.deviceId).toBeUndefined();
    expect(config.contactEmail).toBeUndefined();
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

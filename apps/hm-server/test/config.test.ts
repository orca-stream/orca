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
    });
    // Per-host limits come from the extractors unless the environment overrides them.
    expect(config.hostLimits).toEqual({});
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

  it("overrides the extractors' per-host limits only when asked to", () => {
    expect(
      loadConfig({ ...minimal, DOWNLOADS_PER_HOST: "3", METADATA_PER_SEC: "0.5" }).hostLimits,
    ).toEqual({ downloadsPerHost: 3, metadataPerSec: 0.5 });
    expect(() => loadConfig({ ...minimal, METADATA_PER_SEC: "0" })).toThrow(/METADATA_PER_SEC/);
    expect(() => loadConfig({ ...minimal, DOWNLOADS_PER_HOST: "0" })).toThrow(/DOWNLOADS_PER_HOST/);
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

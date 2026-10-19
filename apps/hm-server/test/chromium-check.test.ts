import { describe, expect, it } from "vite-plus/test";
import { ConfigError, deprecatedEnvWarnings } from "../src/infrastructure/config.ts";
import { assertChromium } from "../src/infrastructure/chromium-check.ts";

const detector = (chromiumPath?: string) => ({
  maxConcurrent: 1,
  timeoutMs: 1,
  settleMs: 0,
  userAgent: undefined,
  chromiumPath,
  noSandbox: false,
});

describe("assertChromium", () => {
  it("accepts the configured executable when it can be run", async () => {
    const checked: string[] = [];
    await assertChromium(detector("/usr/bin/chromium"), {
      canExecute: async (path) => void checked.push(path) === undefined,
      bundledPath: async () => "/never/asked",
    });
    expect(checked).toEqual(["/usr/bin/chromium"]);
  });

  it("fails at boot, saying where it looked and what to do, when the configured one is missing", async () => {
    const error = await assertChromium(detector("/opt/nope/chromium"), {
      canExecute: async () => false,
      bundledPath: async () => "/never/asked",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain("/opt/nope/chromium");
    expect(message).toContain("HM_CHROMIUM_PATH");
    expect(message).toContain("WITH_CHROMIUM=1");
  });

  it("looks for the browser Playwright installs when no path is configured", async () => {
    await assertChromium(detector(), {
      canExecute: async (path) => path === "/home/x/.cache/ms-playwright/chromium/chrome",
      bundledPath: async () => "/home/x/.cache/ms-playwright/chromium/chrome",
    });
    const error = await assertChromium(detector(), {
      canExecute: async () => false,
      bundledPath: async () => "/home/x/.cache/ms-playwright/chromium/chrome",
    }).catch((e: unknown) => e);
    expect((error as Error).message).toContain("/home/x/.cache/ms-playwright/chromium/chrome");
    expect((error as Error).message).toContain("playwright install chromium");
  });
});

describe("deprecatedEnvWarnings", () => {
  it("names a variable that no longer does anything, and what replaced it", () => {
    const warnings = deprecatedEnvWarnings({ IA_HOST_CONCURRENCY: "2" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("IA_HOST_CONCURRENCY");
    expect(warnings[0]).toContain("DOWNLOADS_PER_HOST");
  });

  it("says nothing when none is set", () => {
    expect(deprecatedEnvWarnings({})).toEqual([]);
    expect(deprecatedEnvWarnings({ IA_HOST_CONCURRENCY: undefined })).toEqual([]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { ConfigError } from "../src/infrastructure/config.ts";
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
      canExecute: async (path) => {
        checked.push(path);
        return true;
      },
      launchBundled: async () => expect.unreachable(),
    });
    expect(checked).toEqual(["/usr/bin/chromium"]);
  });

  it("fails at boot, saying where it looked and what to do, when the configured one is missing", async () => {
    const error = await assertChromium(detector("/opt/nope/chromium"), {
      canExecute: async () => false,
      launchBundled: async () => expect.unreachable(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain("/opt/nope/chromium");
    expect(message).toContain("HM_CHROMIUM_PATH");
    expect(message).toContain("WITH_CHROMIUM=1");
  });

  it("starts the browser Playwright installs when no path is configured", async () => {
    const launched: boolean[] = [];
    await assertChromium(
      { ...detector(), noSandbox: true },
      {
        canExecute: async () => expect.unreachable(),
        launchBundled: async (noSandbox) => {
          launched.push(noSandbox);
        },
      },
    );
    expect(launched).toEqual([true]);
  });

  it("fails at boot with Playwright's reason when its browser does not start", async () => {
    const missing = "/home/x/.cache/ms-playwright/chromium_headless_shell-1/chrome-headless-shell";
    const error = await assertChromium(detector(), {
      canExecute: async () => expect.unreachable(),
      launchBundled: async () => {
        throw new Error(`browserType.launch: Executable doesn't exist at ${missing}\n╔═══ banner`);
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain(missing);
    expect(message).not.toContain("banner");
    expect(message).toContain("playwright install chromium-headless-shell");
  });
});

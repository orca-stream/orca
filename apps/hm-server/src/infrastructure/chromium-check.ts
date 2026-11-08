import { access, constants } from "node:fs/promises";
import { launchWithSandboxFallback } from "@orca/stream-detector";
import { ConfigError, type DetectorConfig } from "./config.ts";

export interface ChromiumCheckDeps {
  /** True when the file exists and can be run. */
  canExecute: (path: string) => Promise<boolean>;
  /**
   * Starts and closes the browser Playwright installs, as the detector would start it; rejects with
   * Playwright's own reason when it cannot.
   */
  launchBundled: (noSandbox: boolean) => Promise<void>;
}

const real: ChromiumCheckDeps = {
  canExecute: (path) =>
    access(path, constants.X_OK).then(
      () => true,
      () => false,
    ),
  // Headless, Playwright runs its "headless shell", not the full Chromium that
  // `chromium.executablePath()` names: only starting it tells whether the right one is installed.
  launchBundled: async (noSandbox) => {
    const { chromium } = await import("playwright");
    const browser = await launchWithSandboxFallback((options) => chromium.launch(options), {
      headless: true,
      ...(noSandbox ? { args: ["--no-sandbox"] } : {}),
    });
    await browser.close();
  },
};

/**
 * With the generic detector on, a missing browser should stop the server at boot with a clear
 * message, not fail every page job later with Playwright's own.
 */
export async function assertChromium(
  detector: DetectorConfig,
  deps: ChromiumCheckDeps = real,
): Promise<void> {
  if (detector.chromiumPath !== undefined) {
    if (await deps.canExecute(detector.chromiumPath)) return;
    throw new ConfigError(
      `HM_GENERIC_DETECTOR is on but there is no runnable Chromium at HM_CHROMIUM_PATH (${detector.chromiumPath}). ` +
        `Install it (in Docker, build with --build-arg WITH_CHROMIUM=1) or fix the path.`,
    );
  }
  try {
    await deps.launchBundled(detector.noSandbox);
  } catch (error) {
    // Playwright's first line says which file it looked for; the rest is a banner.
    const reason = String(error instanceof Error ? error.message : error).split("\n")[0];
    throw new ConfigError(
      `HM_GENERIC_DETECTOR is on but Playwright's Chromium does not start (${reason}). ` +
        `Run \`pnpm exec playwright install chromium-headless-shell\`, or set HM_CHROMIUM_PATH to a Chromium you installed.`,
      { cause: error },
    );
  }
}

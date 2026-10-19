import { access, constants } from "node:fs/promises";
import { ConfigError, type DetectorConfig } from "./config.ts";

export interface ChromiumCheckDeps {
  /** True when the file exists and can be run. */
  canExecute: (path: string) => Promise<boolean>;
  /** Where Playwright's own Chromium would be. */
  bundledPath: () => Promise<string>;
}

const real: ChromiumCheckDeps = {
  canExecute: (path) =>
    access(path, constants.X_OK).then(
      () => true,
      () => false,
    ),
  bundledPath: async () => (await import("playwright")).chromium.executablePath(),
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
  const bundled = await deps.bundledPath();
  if (await deps.canExecute(bundled)) return;
  throw new ConfigError(
    `HM_GENERIC_DETECTOR is on but Playwright's Chromium is not installed (looked at ${bundled}). ` +
      `Run \`pnpm exec playwright install chromium\`, or set HM_CHROMIUM_PATH to a Chromium you installed.`,
  );
}

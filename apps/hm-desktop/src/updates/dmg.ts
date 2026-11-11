// macOS updates without Apple's signature: Squirrel.Mac, which electron-updater installs through,
// refuses an unsigned app. So the app only looks: the release carries the .dmg and the
// `latest-mac.yml` electron-builder writes beside it, and the installed app reads where they are from
// the `app-update.yml` the release's build puts in its resources (as on Windows). Installing opens
// the .dmg in the browser; the person drags the new app over the old one, and the data stays.
import type { AvailableUpdate, UpdateSource } from "./updater.ts";
import { isNewer } from "./repository.ts";

/** How long a look may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 30_000;

/** The `url` of electron-builder's `app-update.yml` for a generic provider; undefined without one. */
export function updateUrlFrom(appUpdateYml: string): string | undefined {
  const url = /^url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(appUpdateYml)?.[1];
  return url?.replace(/\/+$/, "");
}

export interface MacRelease {
  version: string;
  /** The .dmg's name, relative to the update URL. */
  dmg: string;
}

/** The version and the .dmg named in `latest-mac.yml`; undefined when either is missing. */
export function macReleaseFrom(latestMacYml: string): MacRelease | undefined {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(latestMacYml)?.[1];
  const dmg = /^\s*(?:-\s*)?url:\s*['"]?([^'"\s]+\.dmg)['"]?\s*$/m.exec(latestMacYml)?.[1];
  return version && dmg ? { version, dmg } : undefined;
}

export interface DmgUpdatesOptions {
  /** Where the release's files are (app-update.yml's `url`). */
  url: string;
  currentVersion: string;
  /** Opens an address in the browser (Electron's `shell.openExternal`). */
  openExternal: (url: string) => Promise<void>;
  fetch?: typeof fetch;
}

interface DmgUpdate extends AvailableUpdate {
  readonly dmg: string;
}

export class DmgUpdates implements UpdateSource {
  private readonly options: DmgUpdatesOptions;

  constructor(options: DmgUpdatesOptions) {
    this.options = options;
  }

  async find(): Promise<DmgUpdate | undefined> {
    const address = `${this.options.url}/latest-mac.yml`;
    const response = await (this.options.fetch ?? fetch)(address, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status === 404) throw new Error("The latest release has no update for macOS.");
    if (!response.ok) throw new Error(`${address} answered ${response.status}.`);
    const release = macReleaseFrom(await response.text());
    if (!release) throw new Error("The latest release's latest-mac.yml names no .dmg.");
    return isNewer(release.version, this.options.currentVersion) ? release : undefined;
  }

  /** Opens the new .dmg's download in the browser; installing it is the person's to do. */
  async install(update: AvailableUpdate): Promise<"handed-over"> {
    const { dmg } = update as DmgUpdate;
    await this.options.openExternal(`${this.options.url}/${encodeURIComponent(dmg)}`);
    return "handed-over";
  }
}

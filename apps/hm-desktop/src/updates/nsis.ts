// Windows updates through electron-updater. The release carries the NSIS installer and its
// `latest.yml` (version, file, checksum); the installed app reads where to find them from the
// `app-update.yml` electron-builder writes into its resources. A local build has none, and so never
// updates itself. The installer is not signed, so there is no publisher to verify; the checksum in
// `latest.yml` is still checked after the download.
import type { AppUpdater, ProgressInfo } from "electron-updater";
import type { AvailableUpdate, UpdateProgress, UpdateSource } from "./updater.ts";

/** What this source uses of electron-updater's `NsisUpdater`, so that tests can stand in for it. */
export type NsisClient = Pick<
  AppUpdater,
  "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates" | "downloadUpdate" | "on" | "off"
>;

export class NsisUpdates implements UpdateSource {
  private readonly client: NsisClient;

  constructor(client: NsisClient) {
    this.client = client;
    // Nothing downloads or installs unless asked from the app.
    client.autoDownload = false;
    client.autoInstallOnAppQuit = false;
  }

  async find(): Promise<AvailableUpdate | undefined> {
    try {
      const result = await this.client.checkForUpdates();
      return result?.isUpdateAvailable ? { version: result.updateInfo.version } : undefined;
    } catch (error) {
      throw shortError(error);
    }
  }

  /**
   * Downloads the installer, with its progress. Running it is the app's to do once this resolves
   * (`quitAndInstall`), after the server has stopped: the installer replaces the app's files.
   */
  async install(
    _update: AvailableUpdate,
    onProgress: (progress: UpdateProgress) => void,
  ): Promise<void> {
    onProgress({ step: "downloading", percent: 0 });
    const listener = (progress: ProgressInfo) =>
      onProgress({ step: "downloading", percent: Math.floor(progress.percent) });
    this.client.on("download-progress", listener);
    try {
      await this.client.downloadUpdate();
    } catch (error) {
      throw shortError(error);
    } finally {
      this.client.off("download-progress", listener);
    }
    onProgress({ step: "installing" });
  }
}

/** electron-updater's code when the release has no `latest.yml` (a 404). */
const NO_UPDATE_INFO = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
/** The most of a reason the panel shows. */
const REASON_MAX = 200;

/**
 * electron-updater's errors carry the response's headers and a stack in their message: what the
 * panel shows is the first line, and a plain sentence for a release without a Windows update.
 */
export function shortError(error: unknown): Error {
  if ((error as { code?: unknown } | null)?.code === NO_UPDATE_INFO) {
    return new Error("The latest release has no update for Windows.");
  }
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n")[0]?.trim() ?? "";
  return new Error(first.length > REASON_MAX ? `${first.slice(0, REASON_MAX - 1)}…` : first);
}

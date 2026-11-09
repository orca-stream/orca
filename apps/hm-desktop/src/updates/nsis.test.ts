import { EventEmitter } from "node:events";
import { describe, expect, it } from "vite-plus/test";
import type { ProgressInfo, UpdateCheckResult } from "electron-updater";
import { NsisUpdates, shortError, type NsisClient } from "./nsis.ts";
import type { UpdateProgress } from "./updater.ts";

function progress(percent: number): ProgressInfo {
  return { percent, total: 100, transferred: percent, bytesPerSecond: 1, delta: 1 };
}

/** An updater that offers `version` (none when undefined) and downloads it through `steps`. */
function fakeClient(options: { version?: string; steps?: number[]; fail?: Error }) {
  const events = new EventEmitter();
  const client = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () =>
      ({
        isUpdateAvailable: options.version !== undefined,
        updateInfo: { version: options.version ?? "0.4.0", files: [], path: "", sha512: "" },
        versionInfo: { version: options.version ?? "0.4.0", files: [], path: "", sha512: "" },
      }) as unknown as UpdateCheckResult,
    downloadUpdate: async () => {
      for (const step of options.steps ?? []) events.emit("download-progress", progress(step));
      if (options.fail) throw options.fail;
      return ["installer.exe"];
    },
    on: (event: string, listener: (progress: ProgressInfo) => void) => {
      events.on(event, listener);
      return client;
    },
    off: (event: string, listener: (progress: ProgressInfo) => void) => {
      events.off(event, listener);
      return client;
    },
  };
  return { client: client as unknown as NsisClient, events };
}

describe("NsisUpdates", () => {
  it("never downloads nor installs on its own", () => {
    const { client } = fakeClient({});
    new NsisUpdates(client);
    expect(client.autoDownload).toBe(false);
    expect(client.autoInstallOnAppQuit).toBe(false);
  });

  it("offers the newer version, and nothing when there is none", async () => {
    expect(await new NsisUpdates(fakeClient({ version: "0.5.0" }).client).find()).toEqual({
      version: "0.5.0",
    });
    expect(await new NsisUpdates(fakeClient({}).client).find()).toBeUndefined();
  });

  it("offers nothing when the updater is not active", async () => {
    const { client } = fakeClient({});
    client.checkForUpdates = async () => null;
    expect(await new NsisUpdates(client).find()).toBeUndefined();
  });

  it("reports the download in whole percents, then that it installs", async () => {
    const { client, events } = fakeClient({ version: "0.5.0", steps: [12.7, 55.2, 100] });
    const seen: UpdateProgress[] = [];
    await new NsisUpdates(client).install({ version: "0.5.0" }, (step) => seen.push(step));
    expect(seen).toEqual([
      { step: "downloading", percent: 0 },
      { step: "downloading", percent: 12 },
      { step: "downloading", percent: 55 },
      { step: "downloading", percent: 100 },
      { step: "installing" },
    ]);
    expect(events.listenerCount("download-progress")).toBe(0);
  });

  it("rejects with the download's failure and stops listening", async () => {
    const { client, events } = fakeClient({ version: "0.5.0", fail: new Error("sha512 mismatch") });
    await expect(new NsisUpdates(client).install({ version: "0.5.0" }, () => {})).rejects.toThrow(
      "sha512 mismatch",
    );
    expect(events.listenerCount("download-progress")).toBe(0);
  });
});

describe("shortError", () => {
  it("says plainly that the release has no Windows update", async () => {
    const { client } = fakeClient({});
    client.checkForUpdates = async () => {
      throw Object.assign(
        new Error('Cannot find channel "latest.yml" update info: HttpError: 404\nHeaders: {…}'),
        { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" },
      );
    };
    await expect(new NsisUpdates(client).find()).rejects.toThrow(
      /^The latest release has no update for Windows\.$/,
    );
  });

  it("keeps the first line of anything else, cut short", () => {
    expect(shortError(new Error("net::ERR_NAME_NOT_RESOLVED\n  at stack")).message).toBe(
      "net::ERR_NAME_NOT_RESOLVED",
    );
    expect(shortError(new Error("x".repeat(500))).message).toHaveLength(200);
  });
});

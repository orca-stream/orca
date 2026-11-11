import { describe, expect, it, vi } from "vite-plus/test";
import { DmgUpdates, macReleaseFrom, updateUrlFrom } from "./dmg.ts";

const URL_BASE = "https://releases.example/latest/download";
/** As electron-builder 26 writes it for a .dmg (sha512 and size shortened). */
const LATEST_MAC = `version: 0.8.0
files:
  - url: orca-hm_0.8.0_arm64.dmg
    sha512: abc==
    size: 123
path: orca-hm_0.8.0_arm64.dmg
sha512: abc==
releaseDate: '2026-11-11T21:00:00.000Z'
`;

const serve = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("updateUrlFrom", () => {
  it("reads the generic provider's url, without a trailing slash", () => {
    expect(
      updateUrlFrom(`provider: generic\nurl: ${URL_BASE}/\nupdaterCacheDirName: orca-hm\n`),
    ).toBe(URL_BASE);
    expect(updateUrlFrom("provider: github\n")).toBeUndefined();
  });
});

describe("macReleaseFrom", () => {
  it("reads the version and the .dmg", () => {
    expect(macReleaseFrom(LATEST_MAC)).toEqual({
      version: "0.8.0",
      dmg: "orca-hm_0.8.0_arm64.dmg",
    });
    expect(macReleaseFrom("version: 0.8.0\n")).toBeUndefined();
  });
});

describe("DmgUpdates", () => {
  const openExternal = vi.fn(async () => {});

  it("offers a newer version from the release's latest-mac.yml, and nothing otherwise", async () => {
    const fetch = serve(LATEST_MAC);
    const updates = new DmgUpdates({ url: URL_BASE, currentVersion: "0.7.0", openExternal, fetch });
    expect((await updates.find())?.version).toBe("0.8.0");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`${URL_BASE}/latest-mac.yml`);
    const current = new DmgUpdates({
      url: URL_BASE,
      currentVersion: "0.8.0",
      openExternal,
      fetch: serve(LATEST_MAC),
    });
    expect(await current.find()).toBeUndefined();
  });

  it("says plainly when the release has no macOS update", async () => {
    const updates = new DmgUpdates({
      url: URL_BASE,
      currentVersion: "0.7.0",
      openExternal,
      fetch: serve("Not Found", 404),
    });
    await expect(updates.find()).rejects.toThrow("The latest release has no update for macOS.");
  });

  it("opens the .dmg's download in the browser and leaves the rest to the person", async () => {
    const updates = new DmgUpdates({
      url: URL_BASE,
      currentVersion: "0.7.0",
      openExternal,
      fetch: serve(LATEST_MAC),
    });
    const found = await updates.find();
    expect(await updates.install(found!)).toBe("handed-over");
    expect(openExternal).toHaveBeenCalledWith(`${URL_BASE}/orca-hm_0.8.0_arm64.dmg`);
  });
});

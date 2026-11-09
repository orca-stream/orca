import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { localeFor, readPreferences, writePreferences } from "./preferences.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orca-hm-prefs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("preferences", () => {
  it("follows the system and draws with the GPU until told otherwise, and remembers it", async () => {
    const file = join(dir, "sub", "preferences.json");
    expect(readPreferences(file)).toEqual({ language: "auto", hardwareAcceleration: true });
    await writePreferences(file, { language: "es", hardwareAcceleration: false });
    expect(readPreferences(file)).toEqual({ language: "es", hardwareAcceleration: false });
  });

  it("ignores a file it cannot read or values it does not know", async () => {
    const file = join(dir, "preferences.json");
    await writeFile(file, "{not json");
    expect(readPreferences(file)).toEqual({ language: "auto", hardwareAcceleration: true });
    await writeFile(file, JSON.stringify({ language: "fr", hardwareAcceleration: "no" }));
    expect(readPreferences(file)).toEqual({ language: "auto", hardwareAcceleration: true });
  });

  it("keeps the language saved before the GPU's switch existed", async () => {
    const file = join(dir, "preferences.json");
    await writeFile(file, JSON.stringify({ language: "en" }));
    expect(readPreferences(file)).toEqual({ language: "en", hardwareAcceleration: true });
  });

  it("uses the system's locale only under auto", () => {
    expect(localeFor("auto", "en-US")).toBe("en-US");
    expect(localeFor("es", "en-US")).toBe("es");
  });
});

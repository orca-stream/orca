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
  it("follows the system until a language is chosen, and remembers the choice", async () => {
    const file = join(dir, "sub", "preferences.json");
    expect(await readPreferences(file)).toEqual({ language: "auto" });
    await writePreferences(file, { language: "es" });
    expect(await readPreferences(file)).toEqual({ language: "es" });
  });

  it("ignores a file it cannot read or a language it does not know", async () => {
    const file = join(dir, "preferences.json");
    await writeFile(file, "{not json");
    expect(await readPreferences(file)).toEqual({ language: "auto" });
    await writeFile(file, JSON.stringify({ language: "fr" }));
    expect(await readPreferences(file)).toEqual({ language: "auto" });
  });

  it("uses the system's locale only under auto", () => {
    expect(localeFor("auto", "en-US")).toBe("en-US");
    expect(localeFor("es", "en-US")).toBe("es");
  });
});

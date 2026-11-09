import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readWindowState, restoredBounds, writeWindowState } from "./window-state.ts";

const MINIMUM = { width: 360, height: 480 };
const LEFT = { x: 0, y: 32, width: 1920, height: 1048 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1440 };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orca-hm-window-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("window state file", () => {
  it("remembers where the window was and whether it was maximized", () => {
    const file = join(dir, "sub", "window-state.json");
    expect(readWindowState(file)).toBeUndefined();
    const state = { bounds: { x: 100, y: 120, width: 1000, height: 700 }, maximized: true };
    writeWindowState(file, state);
    expect(readWindowState(file)).toEqual(state);
  });

  it("ignores a file it cannot read or bounds that are not numbers", async () => {
    const file = join(dir, "window-state.json");
    await writeFile(file, "{not json");
    expect(readWindowState(file)).toBeUndefined();
    await writeFile(file, JSON.stringify({ bounds: { x: "1", y: 0, width: 10, height: 10 } }));
    expect(readWindowState(file)).toBeUndefined();
  });
});

describe("restoredBounds", () => {
  it("keeps a position that is on a screen", () => {
    const saved = { x: 2100, y: 200, width: 1280, height: 800 };
    expect(restoredBounds(saved, [LEFT, RIGHT], MINIMUM)).toEqual(saved);
  });

  it("pulls a window hanging off a screen's edge back inside it, shrinking it to fit", () => {
    expect(restoredBounds({ x: 1500, y: 0, width: 2400, height: 1200 }, [LEFT], MINIMUM)).toEqual({
      x: 0,
      y: 32,
      width: 1920,
      height: 1048,
    });
  });

  it("lets the system place a window whose screen is gone, keeping its size", () => {
    expect(restoredBounds({ x: 2100, y: 200, width: 1280, height: 800 }, [LEFT], MINIMUM)).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("never opens below the window's minimum size", () => {
    expect(restoredBounds({ x: 10, y: 40, width: 100, height: 100 }, [LEFT], MINIMUM)).toEqual({
      x: 10,
      y: 40,
      width: 360,
      height: 480,
    });
  });
});

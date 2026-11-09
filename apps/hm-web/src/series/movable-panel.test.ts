import { describe, expect, it } from "vite-plus/test";
import { dragBy, stretchBy } from "./movable-panel";

const VIEW = { width: 1280, height: 800 };
const LIMITS = { min: { width: 352, height: 320 }, max: { width: 896, height: 832 } };

describe("a panel moved by hand", () => {
  const rect = { left: 300, top: 100, right: 900, bottom: 700 };

  it("follows the pointer from where it was", () => {
    expect(dragBy(rect, { x: 10, y: 0 }, { x: -50, y: 40 }, VIEW)).toEqual({ x: -40, y: 40 });
  });

  it("stays inside the window, 8px from its edges", () => {
    expect(dragBy(rect, { x: 0, y: 0 }, { x: -1000, y: -1000 }, VIEW)).toEqual({ x: -292, y: -92 });
    expect(dragBy(rect, { x: 0, y: 0 }, { x: 1000, y: 1000 }, VIEW)).toEqual({ x: 372, y: 92 });
  });
});

describe("a panel stretched by hand", () => {
  const rect = { left: 300, top: 100, width: 600, height: 500 };

  it("grows from its bottom-right corner, its top-left corner still", () => {
    expect(stretchBy(rect, { x: 100, y: 50 }, LIMITS, VIEW)).toEqual({ width: 700, height: 550 });
    expect(stretchBy(rect, { x: -100, y: -50 }, LIMITS, VIEW)).toEqual({ width: 500, height: 450 });
  });

  it("never passes its widest, its smallest, or the window", () => {
    expect(stretchBy(rect, { x: 900, y: 900 }, LIMITS, VIEW)).toEqual({ width: 896, height: 692 });
    expect(stretchBy(rect, { x: -900, y: -900 }, LIMITS, VIEW)).toEqual({
      width: 352,
      height: 320,
    });
    // 600px of room from its left edge at 672 to 8px off the window's edge.
    expect(stretchBy({ ...rect, left: 672 }, { x: 900, y: 0 }, LIMITS, VIEW)).toMatchObject({
      width: 600,
    });
  });
});

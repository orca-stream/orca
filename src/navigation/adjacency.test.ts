import { describe, expect, it } from "vite-plus/test";
import { isAdjacentSlice } from "./adjacency";

/** A horizontal edge from `left` to `right`, as the corners of a downward move. */
const edge = (left: number, right: number) => ({ a: { x: left, y: 0 }, b: { x: right, y: 0 } });

describe("isAdjacentSlice", () => {
  it("counts a narrow button centred under a wide row as straight ahead", () => {
    expect(isAdjacentSlice(edge(100, 850), edge(453, 497), true)).toBe(true);
  });

  it("counts a wide row under a narrow button as straight ahead", () => {
    expect(isAdjacentSlice(edge(453, 497), edge(100, 850), true)).toBe(true);
  });

  it("leaves a node that barely touches the other's span as diagonal", () => {
    expect(isAdjacentSlice(edge(0, 200), edge(190, 390), true)).toBe(false);
  });

  it("leaves a node beside the other as diagonal", () => {
    expect(isAdjacentSlice(edge(0, 200), edge(300, 500), true)).toBe(false);
  });

  it("measures along the vertical axis for a sideways move", () => {
    const side = (top: number, bottom: number) => ({ a: { x: 0, y: top }, b: { x: 0, y: bottom } });
    expect(isAdjacentSlice(side(0, 600), side(280, 320), false)).toBe(true);
    expect(isAdjacentSlice(side(0, 100), side(300, 400), false)).toBe(false);
  });
});

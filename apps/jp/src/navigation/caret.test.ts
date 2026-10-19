import { describe, expect, it } from "vite-plus/test";
import { caretCanMove } from "./caret";

const field = (value: string, start: number, end = start) => ({
  value,
  selectionStart: start,
  selectionEnd: end,
});

describe("caretCanMove", () => {
  it("lets the arrows leave an empty field either way", () => {
    expect(caretCanMove("ArrowLeft", field("", 0))).toBe(false);
    expect(caretCanMove("ArrowRight", field("", 0))).toBe(false);
  });

  it("keeps the arrows in the field while the caret can still move", () => {
    expect(caretCanMove("ArrowLeft", field("orca", 2))).toBe(true);
    expect(caretCanMove("ArrowRight", field("orca", 2))).toBe(true);
  });

  it("leaves at the end the caret is already at", () => {
    expect(caretCanMove("ArrowRight", field("orca", 4))).toBe(false);
    expect(caretCanMove("ArrowLeft", field("orca", 0))).toBe(false);
    expect(caretCanMove("ArrowLeft", field("orca", 4))).toBe(true);
  });

  it("never lets Enter out", () => {
    expect(caretCanMove("Enter", field("", 0))).toBe(true);
  });
});

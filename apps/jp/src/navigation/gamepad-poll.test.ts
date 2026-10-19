import { describe, expect, it } from "vite-plus/test";
import { PadReader, type PadState } from "./gamepad-poll";

function pad(pressed: number[] = [], axes: number[] = [0, 0]): PadState {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed.includes(i));
  return { buttons, axes };
}

describe("PadReader", () => {
  it("presses and releases A as Enter, once", () => {
    const reader = new PadReader();
    expect(reader.read(pad([0]), 0)).toEqual([{ type: "keydown", key: "Enter", repeat: false }]);
    expect(reader.read(pad([0]), 1000)).toEqual([]);
    expect(reader.read(pad(), 1100)).toEqual([{ type: "keyup", key: "Enter", repeat: false }]);
  });

  it("maps B to Back and the d-pad to arrows", () => {
    const reader = new PadReader();
    const keys = reader.read(pad([1, 13]), 0).map((k) => k.key);
    expect(keys).toEqual(["GoBack", "ArrowDown"]);
  });

  it("repeats a held arrow after a pause, like a held key", () => {
    const reader = new PadReader();
    reader.read(pad([15]), 0);
    expect(reader.read(pad([15]), 300)).toEqual([]);
    expect(reader.read(pad([15]), 400)).toEqual([
      { type: "keydown", key: "ArrowRight", repeat: true },
    ]);
    expect(reader.read(pad([15]), 450)).toEqual([]);
    expect(reader.read(pad([15]), 520)).toHaveLength(1);
  });

  it("reads the left stick as arrows past half way, along its stronger axis", () => {
    const reader = new PadReader();
    expect(reader.read(pad([], [0.3, 0.2]), 0)).toEqual([]);
    expect(reader.read(pad([], [-0.9, 0.4]), 10).map((k) => k.key)).toEqual(["ArrowLeft"]);
    expect(reader.read(pad([], [0, 0]), 20)).toEqual([
      { type: "keyup", key: "ArrowLeft", repeat: false },
    ]);
  });
});

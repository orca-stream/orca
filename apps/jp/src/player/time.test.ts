import { describe, expect, it } from "vite-plus/test";
import { formatTime } from "./time";

describe("formatTime", () => {
  it("shows hours only past an hour", () => {
    expect(formatTime(3723.9)).toBe("1:02:03");
    expect(formatTime(2525)).toBe("42:05");
    expect(formatTime(7)).toBe("0:07");
  });

  it("never goes negative", () => {
    expect(formatTime(-3)).toBe("0:00");
  });
});

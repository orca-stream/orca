import { describe, expect, it } from "vite-plus/test";
import { fallbackColor } from "./fallback-color";

describe("fallbackColor", () => {
  it("is stable per user and spreads users across the palette", () => {
    expect(fallbackColor("user-1")).toBe(fallbackColor("user-1"));
    const ids = Array.from({ length: 20 }, (_, index) => `user-${index}`);
    expect(new Set(ids.map(fallbackColor)).size).toBeGreaterThan(2);
  });
});

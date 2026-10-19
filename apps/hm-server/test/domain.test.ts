import { describe, expect, it } from "vite-plus/test";
import { backoffMs } from "../src/domain/backoff.ts";
import { uuidv7 } from "../src/domain/ids.ts";

describe("uuidv7", () => {
  it("is a v7 uuid", () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts by time", () => {
    const ids = [0, 1_000, 2_000]
      .map((offset) => Date.now() + 10 ** 10 + offset)
      .map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const now = Date.now() + 10 ** 13;
    expect(Number.parseInt(uuidv7(now).replace(/-/g, "").slice(0, 12), 16)).toBe(now);
  });

  it("keeps ids created in the same millisecond in creation order", () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(Date.now() + 10 ** 14));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });
});

describe("backoffMs", () => {
  it("doubles from 30 s, between half and all of the delay", () => {
    expect(backoffMs(1, 1)).toBe(30_000);
    expect(backoffMs(1, 0)).toBe(15_000);
    expect(backoffMs(2, 1)).toBe(60_000);
    expect(backoffMs(4, 0.5)).toBe(Math.round(240_000 * 0.75));
  });

  it("stops growing at 6 hours", () => {
    expect(backoffMs(30, 1)).toBe(6 * 60 * 60 * 1000);
  });

  it("obeys Retry-After over the curve", () => {
    expect(backoffMs(1, 1, 120_000)).toBe(120_000);
  });
});

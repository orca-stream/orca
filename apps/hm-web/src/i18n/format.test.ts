import { describe, expect, it } from "vite-plus/test";
import { etaSeconds, formatBytes, formatDuration, formatRelative, formatSpeed } from "./format";

describe("formatBytes", () => {
  it("scales by 1024 and follows the locale's decimal mark", () => {
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1536, "es")).toBe("1,5 KB");
  });

  it("keeps bytes whole and drops decimals from three digits up", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(300 * 1024 * 1024, "en")).toBe("300 MB");
    expect(formatBytes(5 * 1024 ** 3, "en")).toBe("5 GB");
  });

  it("shows a dash for values that are not a size", () => {
    expect(formatBytes(Number.NaN, "en")).toBe("—");
    expect(formatBytes(-1, "en")).toBe("—");
  });
});

describe("formatSpeed", () => {
  it("is the size per second", () => {
    expect(formatSpeed(2.5 * 1024 * 1024, "en")).toBe("2.5 MB/s");
  });
});

describe("etaSeconds", () => {
  it("divides what is left by the speed", () => {
    expect(etaSeconds({ loaded: 100, total: 1100, bytesPerSecond: 10 })).toBe(100);
  });

  it("is null when the speed is zero or the total is unknown", () => {
    expect(etaSeconds({ loaded: 100, total: 1100, bytesPerSecond: 0 })).toBeNull();
    expect(etaSeconds({ loaded: 100, total: null, bytesPerSecond: 10 })).toBeNull();
  });

  it("is zero once everything is there", () => {
    expect(etaSeconds({ loaded: 1200, total: 1100, bytesPerSecond: 10 })).toBe(0);
  });
});

describe("formatDuration", () => {
  it("picks the units that matter", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("speaks of the past in the locale", () => {
    expect(formatRelative(new Date("2026-10-18T11:57:00Z"), now, "en")).toBe("3 minutes ago");
    expect(formatRelative(new Date("2026-10-18T11:57:00Z"), now, "es")).toBe("hace 3 minutos");
  });

  it("speaks of the future too (a retry that is scheduled)", () => {
    expect(formatRelative(new Date("2026-10-18T12:03:00Z"), now, "en")).toBe("in 3 minutes");
  });

  it("moves up to hours and days", () => {
    expect(formatRelative(new Date("2026-10-18T09:00:00Z"), now, "en")).toBe("3 hours ago");
    expect(formatRelative(new Date("2026-10-16T12:00:00Z"), now, "en")).toBe("2 days ago");
  });

  it("says now for the last few seconds", () => {
    expect(formatRelative(new Date("2026-10-18T11:59:58Z"), now, "en")).toBe("now");
  });
});

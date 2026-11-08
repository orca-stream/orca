import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { ProgressReader } from "./chromium.ts";

const MIB = 1024 * 1024;

describe("ProgressReader", () => {
  it("follows Playwright's real output across the two files it fetches", () => {
    // Captured from `playwright install chromium-headless-shell` with its output piped, as the app runs it.
    const output = readFileSync(
      new URL("fixtures/playwright-install.txt", import.meta.url),
      "utf8",
    );
    const reader = new ProgressReader();
    const seen = output
      .split("\n")
      .map((line) => reader.read(line))
      .filter((progress) => progress !== undefined);

    expect(seen).toHaveLength(22);
    expect(seen[1]).toEqual({ received: 12 * MIB, total: 120 * MIB });
    // The headless shell done, Playwright's small ffmpeg starts: nothing goes backwards.
    expect(seen[11]).toEqual({ received: 120 * MIB, total: 122.2 * MIB });
    expect(seen.at(-1)).toEqual({ received: 122.2 * MIB, total: 122.2 * MIB });
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.received).toBeGreaterThanOrEqual(seen[i - 1]!.received);
    }
  });

  it("ignores lines that say nothing about progress", () => {
    const reader = new ProgressReader();
    expect(
      reader.read("BEWARE: your OS is not officially supported by Playwright"),
    ).toBeUndefined();
    expect(reader.read("")).toBeUndefined();
  });
});

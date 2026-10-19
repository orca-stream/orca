import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_HM_API_KEY_SECRET } from "../src/domain/config.ts";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** Keys in .env.example: `KEY=` lines, with the value left empty. */
function envKeys(text: string): { key: string; value: string }[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((m) => ({
    key: m[1]!,
    value: m[2]!,
  }));
}

describe(".env.example", () => {
  const example = envKeys(read(".env.example"));

  it("lists every secret key the example config names, commented sections included", () => {
    // `fooSecret: KEY` anywhere in the yaml, plus the defaults the schema fills in.
    const named = [...read("bifrost.example.yaml").matchAll(/\w+Secret:\s*([A-Z][A-Z0-9_]*)/g)].map(
      (m) => m[1]!,
    );
    const wanted = new Set([...named, DEFAULT_HM_API_KEY_SECRET, "JELLYFIN_API_KEY"]);
    expect(wanted.size).toBeGreaterThanOrEqual(6);
    expect(example.map((e) => e.key).toSorted()).toEqual([...wanted].toSorted());
  });

  it("carries no values", () => {
    expect(example.filter((e) => e.value !== "")).toEqual([]);
  });
});

import { describe, expect, it } from "vite-plus/test";

const sources = import.meta.glob<string>(["/src/**/*.ts", "/src/**/*.tsx", "!/src/**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("the panel's use of @orca/hm-contract", () => {
  it("takes only types from the main entry, so the Zod schemas stay out of the bundle", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders = Object.entries(sources)
      // `import { x } from` / `export { x } from` are runtime; `import type` / `export type` are erased.
      .filter(([, text]) =>
        /^(import|export)\s+(?!type\b)[^;]*?from\s+["']@orca\/hm-contract["']/m.test(text),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

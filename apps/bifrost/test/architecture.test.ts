import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const src = new URL("../src/", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

const imports = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map(
    (m) => m[1]!,
  );

describe("architecture", () => {
  const all = files(src).map((f) => ({ file: relative(src, f), imports: imports(f) }));

  it("keeps the domain pure: it imports only itself and zod/yaml", () => {
    for (const f of all.filter((x) => x.file.startsWith("domain/"))) {
      for (const i of f.imports) {
        expect(i.startsWith("./") || i === "zod" || i === "yaml", `${f.file} imports ${i}`).toBe(
          true,
        );
      }
    }
  });

  it("keeps use cases behind the ports: application never imports infrastructure, the SDK or axios", () => {
    for (const f of all.filter((x) => x.file.startsWith("application/"))) {
      for (const i of f.imports) {
        expect(i).not.toMatch(/infrastructure|@jellyfin|axios/);
      }
    }
  });

  it("confines @jellyfin/sdk to SdkJellyfinAdmin, with .js on every deep import", () => {
    for (const f of all) {
      const sdk = f.imports.filter((i) => i.startsWith("@jellyfin/sdk"));
      if (f.file !== "infrastructure/sdk-jellyfin-admin.ts") expect(sdk, f.file).toEqual([]);
      for (const i of sdk.filter((x) => x.includes("/lib/")))
        expect(i.endsWith(".js"), i).toBe(true);
    }
  });

  it("uses explicit .ts extensions for relative imports, as Node's type stripping requires", () => {
    for (const f of all) {
      for (const i of f.imports.filter((x) => x.startsWith(".")))
        expect(i.endsWith(".ts"), `${f.file}: ${i}`).toBe(true);
    }
  });
});

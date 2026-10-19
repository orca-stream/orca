import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { EnvFileSecretStore } from "../src/infrastructure/env-file-secret-store.ts";

const dir = () => mkdtempSync(join(tmpdir(), "bifrost-env-"));

describe("EnvFileSecretStore", () => {
  it("reads KEY=value lines, comments and quoted values", async () => {
    const file = join(dir(), ".env");
    writeFileSync(file, "# comment\nA=1\nB=\"two words\"\nexport C=3\n\nD='q'\n");
    const store = new EnvFileSecretStore(file, {});
    expect(await store.get("A")).toBe("1");
    expect(await store.get("B")).toBe("two words");
    expect(await store.get("C")).toBe("3");
    expect(await store.get("D")).toBe("q");
    expect(await store.get("MISSING")).toBeUndefined();
  });

  it("falls back to the process environment, the file wins", async () => {
    const file = join(dir(), ".env");
    writeFileSync(file, "A=file\n");
    const store = new EnvFileSecretStore(file, { A: "env", B: "env-b" });
    expect(await store.get("A")).toBe("file");
    expect(await store.get("B")).toBe("env-b");
  });

  it("creates the file private, appends new keys and replaces existing ones in place", async () => {
    const file = join(dir(), ".env");
    const store = new EnvFileSecretStore(file, {});
    await store.set("TOKEN", "abc");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    writeFileSync(file, "# keep me\nTOKEN=old\nOTHER=1\n");
    await store.set("TOKEN", "new value");
    await store.set("ADDED", "x");
    expect(readFileSync(file, "utf8")).toBe('# keep me\nTOKEN="new value"\nOTHER=1\nADDED=x\n');
    expect(await store.get("TOKEN")).toBe("new value");
  });

  it("drops trailing comments from unquoted values but keeps # inside quotes", async () => {
    const file = join(dir(), ".env");
    writeFileSync(file, 'A=1 # the number\nB="x # y" # note\nC=a#b\n');
    const store = new EnvFileSecretStore(file, {});
    expect(await store.get("A")).toBe("1");
    expect(await store.get("B")).toBe("x # y");
    expect(await store.get("C")).toBe("a#b");
  });
});

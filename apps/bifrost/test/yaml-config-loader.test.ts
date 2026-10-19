import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ConfigError } from "../src/domain/errors.ts";
import { dumpYaml, loadConfig } from "../src/infrastructure/yaml-config.ts";

const example = new URL("../bifrost.example.yaml", import.meta.url).pathname;
const tmp = (content: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "bifrost-cfg-")), "bifrost.yaml");
  writeFileSync(file, content);
  return file;
};

describe("loadConfig", () => {
  it("loads and validates the example", async () => {
    expect((await loadConfig(example)).host.name).toBe("homelab");
  });

  it("says where to start when the file is missing", async () => {
    await expect(loadConfig("/nonexistent/bifrost.yaml")).rejects.toThrow(/bifrost\.example\.yaml/);
  });

  it("reports YAML syntax errors with a line", async () => {
    await expect(loadConfig(tmp("host: [unclosed\n"))).rejects.toThrow(ConfigError);
    await expect(loadConfig(tmp("host: [unclosed\n"))).rejects.toThrow(/line/i);
  });

  it("reports schema errors", async () => {
    await expect(loadConfig(tmp("version: 1\n"))).rejects.toThrow(/host/);
  });
});

describe("dumpYaml", () => {
  it("round-trips a document", async () => {
    const original = await loadConfig(example);
    const file = tmp(dumpYaml({ ...original }));
    expect(await loadConfig(file)).toEqual(original);
  });
});

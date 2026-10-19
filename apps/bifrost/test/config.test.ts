import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";
import { ConfigError, parseConfig } from "../src/domain/config.ts";

const example = parse(readFileSync(new URL("../bifrost.example.yaml", import.meta.url), "utf8"));

describe("parseConfig", () => {
  it("accepts the example config and fills in defaults", () => {
    const cfg = parseConfig(example);
    expect(cfg.host.address).toBe("192.168.1.10");
    expect(cfg.host.dataDir).toBe("/srv/jellyfin");
    expect(cfg.jellyfin.libraries.map((l) => l.name)).toEqual(["Películas", "Series"]);
    expect(cfg.jellyfin.libraries[1]?.options).toEqual({});
    expect(cfg.jellyfin.plugins[0]?.enabled).toBe(true);
    expect(cfg.jellyfin.prune).toEqual({ plugins: false, libraries: false, repositories: false });
    expect(cfg.jellyfin.apiKeySecret).toBe("JELLYFIN_API_KEY");
  });

  it("rejects unknown keys with a readable path", () => {
    const bad = structuredClone(example);
    bad.host.adress = "x";
    expect(() => parseConfig(bad)).toThrow(ConfigError);
    expect(() => parseConfig(bad)).toThrow(/host/);
  });

  it("rejects a bad address and a wrong version", () => {
    const bad = structuredClone(example);
    bad.host.address = "not-an-ip";
    bad.version = 2;
    try {
      parseConfig(bad);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("host.address");
      expect(msg).toContain("version");
    }
  });

  it("refuses to bind published ports to 0.0.0.0", () => {
    const bad = structuredClone(example);
    bad.host.address = "0.0.0.0";
    expect(() => parseConfig(bad)).toThrow(/0\.0\.0\.0/);
  });

  it("rejects a plugin that points to an undeclared repository", () => {
    const bad = structuredClone(example);
    bad.jellyfin.plugins[0].repository = "Nope";
    expect(() => parseConfig(bad)).toThrow(/Nope/);
  });

  it("rejects a library with no paths and an unknown type", () => {
    const bad = structuredClone(example);
    bad.jellyfin.libraries[0].paths = [];
    bad.jellyfin.libraries[1].type = "games";
    expect(() => parseConfig(bad)).toThrow(/libraries/);
  });

  it("keeps shell-hostile characters out of values that end up in scripts", () => {
    const bad = structuredClone(example);
    bad.host.lanCidr = "192.168.1.0/24; reboot";
    bad.host.dataDir = "/srv/jellyfin && rm -rf /";
    bad.backup = { repository: "it's", passwordSecret: "X", keep: { daily: 1, weekly: 1 } };
    try {
      parseConfig(bad);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("host.lanCidr");
      expect(msg).toContain("host.dataDir");
      expect(msg).toContain("backup.repository");
    }
  });
});

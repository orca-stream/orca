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
    expect(cfg.jellyfin.prune).toEqual({
      plugins: false,
      libraries: false,
      paths: false,
      repositories: false,
    });
    expect(cfg.jellyfin.apiKeySecret).toBe("JELLYFIN_API_KEY");
  });

  it("defaults the published ports and the render device, and lets the config change them", () => {
    const defaults = parseConfig(structuredClone(example));
    expect(defaults.jellyfin.port).toBe(8096);
    expect(defaults.jellyfin.discoveryPort).toBe(7359);
    expect(defaults.host.renderDevice).toBe("/dev/dri/renderD128");

    const custom = structuredClone(example);
    custom.jellyfin.port = 9096;
    custom.jellyfin.url = `http://${custom.host.address}:9096`;
    custom.jellyfin.discoveryPort = 7360;
    custom.host.renderDevice = "/dev/dri/renderD129";
    const cfg = parseConfig(custom);
    expect([cfg.jellyfin.port, cfg.jellyfin.discoveryPort, cfg.host.renderDevice]).toEqual([
      9096,
      7360,
      "/dev/dri/renderD129",
    ]);
  });

  it("rejects ports out of range and a render device that is not a /dev path", () => {
    for (const patch of [
      (c: any) => (c.jellyfin.port = 0),
      (c: any) => (c.jellyfin.port = 70000),
      (c: any) => (c.jellyfin.discoveryPort = 1.5),
      (c: any) => (c.host.renderDevice = "renderD128"),
      (c: any) => (c.host.renderDevice = "/dev/dri/x; rm -rf /"),
      (c: any) => (c.host.renderDevice = "/etc/passwd"),
    ]) {
      const bad = structuredClone(example);
      patch(bad);
      expect(() => parseConfig(bad)).toThrow(ConfigError);
    }
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

  it("rejects a jellyfin.url whose port is not the published jellyfin.port on the host's own address", () => {
    const bad = structuredClone(example);
    bad.jellyfin.url = `http://${bad.host.address}:9999`;
    bad.jellyfin.port = 8096;
    expect(() => parseConfig(bad)).toThrow(/jellyfin\.port/);
    // A url without a port means 80, which is not 8096 either.
    bad.jellyfin.url = `http://${bad.host.address}`;
    expect(() => parseConfig(bad)).toThrow(/jellyfin\.port/);
    // Matching port, or another host (a proxy in front), is fine.
    bad.jellyfin.url = `http://${bad.host.address}:8096`;
    expect(() => parseConfig(bad)).not.toThrow();
    bad.jellyfin.url = "https://jellyfin.example.com";
    expect(() => parseConfig(bad)).not.toThrow();
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

  it("validates lanCidr as a real network address", () => {
    for (const cidr of ["999.1.1.1/24", "192.168.1.5/24", "192.168.1.0/40"]) {
      const bad = structuredClone(example);
      bad.host.lanCidr = cidr;
      expect(() => parseConfig(bad), cidr).toThrow(/lanCidr/);
    }
  });

  it("rejects root as the SSH user", () => {
    const bad = structuredClone(example);
    bad.host.sshUser = "root";
    expect(() => parseConfig(bad)).toThrow(/sshUser/);
  });

  it("has a prune.paths switch that defaults to off", () => {
    expect(parseConfig(example).jellyfin.prune.paths).toBe(false);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { renderCompose } from "../src/domain/compose.ts";
import { hmEnvFile } from "../src/domain/hm.ts";
import { ConfigError } from "../src/domain/errors.ts";
import { exampleConfig } from "./fixtures.ts";

const ids = { uid: 998, gid: 997, renderGid: 991 };
const hm = { uid: 996, gid: 997, image: "orca-hm:0123456789ab" };
const withHm = (r: any) => {
  r.hm = { mediaDir: "/srv/jellyfin/media/tv" };
};

describe("compose with hm", () => {
  it("is byte-identical to the Jellyfin-only file when no hm runtime is given", () => {
    const cfg = exampleConfig();
    expect(renderCompose(exampleConfig(withHm), ids)).toBe(renderCompose(cfg, ids));
    // Configured but not deployed: still the same bytes, and no hm key at all.
    expect(Object.keys(parse(renderCompose(cfg, ids)).services)).toEqual(["jellyfin"]);
  });

  it("keeps the jellyfin service unchanged when hm is added", () => {
    const a = parse(renderCompose(exampleConfig(), ids));
    const b = parse(renderCompose(exampleConfig(withHm), ids, hm));
    expect(b.services.jellyfin).toEqual(a.services.jellyfin);
  });

  it("describes the hm service", () => {
    const s = parse(renderCompose(exampleConfig(withHm), ids, hm)).services["orca-hm"];
    expect(s).toMatchObject({
      image: "orca-hm:0123456789ab",
      container_name: "orca-hm",
      user: "996:997",
      init: true,
      shm_size: "1gb",
      mem_limit: "1536m",
      restart: "unless-stopped",
      ports: ["192.168.1.10:8787:8787/tcp"],
      env_file: ["/srv/orca-hm/hm.env"],
      volumes: ["/srv/orca-hm/data:/data", "/srv/jellyfin/media/tv:/media/tv"],
    });
    expect(s.healthcheck.test.join(" ")).toContain("/health");
  });

  it("publishes only on host.address, never 0.0.0.0", () => {
    const text = renderCompose(exampleConfig(withHm), ids, hm);
    const ports: string[] = Object.values<any>(parse(text).services).flatMap((s) => s.ports);
    for (const p of ports) expect(p.startsWith("192.168.1.10:")).toBe(true);
    expect(text).not.toContain("0.0.0.0");
  });

  it("uses the configured host port", () => {
    const cfg = exampleConfig((r) => (r.hm = { mediaDir: "/srv/jellyfin/media/tv", port: 9000 }));
    expect(parse(renderCompose(cfg, ids, hm)).services["orca-hm"].ports).toEqual([
      "192.168.1.10:9000:8787/tcp",
    ]);
  });

  it("maps the media dir through a disk mount to the same path in both containers", () => {
    const cfg = exampleConfig((r) => {
      r.host.mediaDisk = { uuid: "abc", mount: "/mnt/media" };
      r.jellyfin.libraries[1].paths = ["/media/tv"];
      r.hm = { mediaDir: "/mnt/media/tv" };
    });
    const doc = parse(renderCompose(cfg, ids, hm));
    expect(doc.services.jellyfin.volumes).toContain("/mnt/media:/media:ro");
    expect(doc.services["orca-hm"].volumes).toContain("/mnt/media/tv:/media/tv");
  });
});

describe("hm config", () => {
  it("rejects a media dir Jellyfin cannot see", () => {
    expect(() => exampleConfig((r) => (r.hm = { mediaDir: "/elsewhere/tv" }))).toThrow(ConfigError);
  });
  it("rejects a media dir outside every tvshows library", () => {
    expect(() => exampleConfig((r) => (r.hm = { mediaDir: "/srv/jellyfin/media/movies" }))).toThrow(
      /tvshows/,
    );
  });
  it("accepts a subfolder of a tvshows library and applies defaults", () => {
    const cfg = exampleConfig((r) => (r.hm = { mediaDir: "/srv/jellyfin/media/tv/kids" }));
    expect(cfg.hm).toMatchObject({
      port: 8787,
      dataDir: "/srv/orca-hm",
      source: "HEAD",
      apiKeySecret: "ORCA_HM_JELLYFIN_API_KEY",
    });
  });
  it("rejects a git ref that looks like an option", () => {
    expect(() =>
      exampleConfig((r) => (r.hm = { mediaDir: "/srv/jellyfin/media/tv", source: "--output=x" })),
    ).toThrow(ConfigError);
  });
  it("refuses env values that could break the file", () => {
    expect(() => hmEnvFile(exampleConfig(withHm), { apiKey: "a b" })).toThrow();
    expect(() => hmEnvFile(exampleConfig(withHm), { apiKey: "a$b" })).toThrow();
  });
});

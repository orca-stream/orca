import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";
import { renderCompose } from "../src/domain/compose.ts";
import { exampleConfig } from "./fixtures.ts";

const ids = { uid: 998, gid: 998, renderGid: 991 };

function compose(patch?: (r: any) => void) {
  return parse(renderCompose(exampleConfig(patch), ids)).services.jellyfin;
}

describe("renderCompose", () => {
  it("renders the pinned image, the unprivileged user and the render group", () => {
    const svc = compose();
    expect(svc.image).toBe("jellyfin/jellyfin:12.2.20261005-225228");
    expect(svc.container_name).toBe("jellyfin");
    expect(svc.user).toBe("998:998");
    expect(svc.group_add).toEqual(["991"]);
    expect(svc.devices).toEqual(["/dev/dri/renderD128:/dev/dri/renderD128"]);
    expect(svc.restart).toBe("unless-stopped");
    expect(svc.environment.JELLYFIN_PublishedServerUrl).toBe("http://192.168.1.10:8096");
  });

  it("publishes the configured ports and maps the configured render device", () => {
    const svc = compose((r) => {
      r.jellyfin.port = 9096;
      r.jellyfin.discoveryPort = 7360;
      r.host.renderDevice = "/dev/dri/renderD129";
    });
    // The container side stays 8096 and 7359: those are Jellyfin's own ports.
    expect(svc.ports).toEqual(["192.168.1.10:9096:8096/tcp", "192.168.1.10:7360:7359/udp"]);
    expect(svc.devices).toEqual(["/dev/dri/renderD129:/dev/dri/renderD129"]);
    expect(svc.healthcheck.test).toContain("http://localhost:8096/health");
  });

  it("never publishes a port on 0.0.0.0 or on every interface", () => {
    const ports: string[] = compose().ports;
    expect(ports).toEqual(["192.168.1.10:8096:8096/tcp", "192.168.1.10:7359:7359/udp"]);
    for (const p of ports) {
      expect(p).not.toMatch(/^0\.0\.0\.0/);
      expect(p.split(":").length).toBeGreaterThanOrEqual(3); // ip:host:container
    }
    expect(renderCompose(exampleConfig(), ids)).not.toContain("0.0.0.0");
  });

  it("mounts config and cache from the data dir and the media read-only", () => {
    expect(compose().volumes).toEqual([
      "/srv/jellyfin/config:/config",
      "/srv/jellyfin/cache:/cache",
      "/srv/jellyfin/media:/media:ro",
    ]);
    const disk = compose((r) => {
      r.host.mediaDisk = { uuid: "1234-ABCD", mount: "/mnt/media" };
    });
    expect(disk.volumes[2]).toBe("/mnt/media:/media:ro");
    const old = compose((r) => {
      r.host.mediaMounts = [{ source: "/mnt/media/movies", target: "/data/jellyfin/movies" }];
    });
    expect(old.volumes.slice(2)).toEqual(["/mnt/media/movies:/data/jellyfin/movies:ro"]);
  });

  it("has a healthcheck that waits out the startup migrations", () => {
    const hc = compose().healthcheck;
    expect(hc.test).toEqual([
      "CMD",
      "curl",
      "--noproxy",
      "localhost",
      "-fsS",
      "http://localhost:8096/health",
    ]);
    expect(hc.start_period).toBe("120s");
    expect(hc.retries).toBe(3);
  });
});

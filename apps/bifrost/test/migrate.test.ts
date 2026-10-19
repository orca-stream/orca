import { describe, expect, it } from "vite-plus/test";
import { migrate } from "../src/application/migrate.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { FakeRemoteHost } from "./fakes/remote-host.ts";
import { exampleConfig } from "./fixtures.ts";

function setup(sourceVersion = "12.2.0", targetVersion = "12.2.0") {
  const source = new FakeJellyfinServer();
  const target = new FakeJellyfinServer();
  source.wizardCompleted = target.wizardCompleted = true;
  source.version = sourceVersion;
  target.version = targetVersion;
  const adminFor = (s: FakeJellyfinServer) =>
    new SdkJellyfinAdmin({ url: "http://fake:8096", token: "k", axios: s.axios });
  const remote = new FakeRemoteHost();
  const clock = new FakeClock();
  const lines: string[] = [];
  const deps = {
    source: adminFor(source),
    target: adminFor(target),
    remote,
    clock,
    log: (l: string) => lines.push(l),
  };
  return { source, target, remote, clock, deps, lines };
}

describe("migrate", () => {
  it("backs up the source, copies the zip to the host, then restores it on the target — in that order", async () => {
    const { source, target, remote, clock, deps } = setup();
    const seenAtCopy: { restore: number; created: number }[] = [];
    const copyTo = remote.copyTo.bind(remote);
    remote.copyTo = async (...args) => {
      seenAtCopy.push({
        restore: target.find("post", "/Backup/Restore").length,
        created: source.find("post", "/Backup/Create").length,
      });
      return copyTo(...args);
    };

    await migrate(deps, exampleConfig(), { dryRun: false });

    expect(seenAtCopy).toEqual([{ restore: 0, created: 1 }]);
    const copy = remote.calls.find((c) => c.kind === "copy")!;
    expect(copy.stdin).toBe(source.backupPath);
    expect(copy.cmd).toBe("/srv/jellyfin/config/data/backups/jellyfin-backup-1.zip");
    expect(copy.sudo).toBe(true);
    expect(
      remote
        .scripts()
        .some((s) =>
          s.includes(
            "chown jellyfin:jellyfin /srv/jellyfin/config/data/backups/jellyfin-backup-1.zip",
          ),
        ),
    ).toBe(true);

    expect(target.find("post", "/Backup/Restore")[0]?.body).toEqual({
      ArchiveFileName: "jellyfin-backup-1.zip",
    });
    // It waited for the target to come back after the restore restarted it.
    expect(target.downPolls).toBe(0);
    expect(clock.sleeps.length).toBeGreaterThan(1);
    expect(source.writes().map((w) => w.path)).toEqual(["/Backup/Create"]);
  });

  it("uses --backup-file instead of the path the source reports", async () => {
    const { remote, deps } = setup();
    await migrate(deps, exampleConfig(), { dryRun: false, backupFile: "/tmp/copy/other.zip" });
    expect(remote.calls.find((c) => c.kind === "copy")).toMatchObject({
      stdin: "/tmp/copy/other.zip",
      cmd: "/srv/jellyfin/config/data/backups/other.zip",
    });
  });

  it("refuses to restore a backup from a newer server", async () => {
    const { source, target, remote, deps } = setup("12.3.0", "12.2.0");
    await expect(migrate(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(/newer/);
    expect(source.writes()).toEqual([]);
    expect(target.writes()).toEqual([]);
    expect(remote.mutations()).toEqual([]);
  });

  it("changes nothing on --dry-run", async () => {
    const { source, target, remote, deps, lines } = setup();
    await migrate(deps, exampleConfig(), { dryRun: true });
    expect(source.writes()).toEqual([]);
    expect(target.writes()).toEqual([]);
    expect(remote.mutations()).toEqual([]);
    expect(lines.join("\n")).toMatch(/would/i);
  });
});

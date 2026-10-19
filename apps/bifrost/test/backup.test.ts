import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { backup } from "../src/application/backup.ts";
import { restore } from "../src/application/restore.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { FakeRemoteHost } from "./fakes/remote-host.ts";
import { InMemorySecretStore } from "./fakes/secret-store.ts";
import { exampleConfig } from "./fixtures.ts";

const PASSWORD = "correct horse battery staple";
const withBackup = (r: any) => {
  r.backup = {
    repository: "/mnt/backup/restic",
    passwordSecret: "RESTIC_PASSWORD",
    keep: { daily: 7, weekly: 4 },
  };
};

function setup() {
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  const jellyfin = new SdkJellyfinAdmin({
    url: "http://fake:8096",
    token: "k",
    axios: server.axios,
  });
  const secrets = new InMemorySecretStore({ RESTIC_PASSWORD: PASSWORD });
  const remote = new FakeRemoteHost({ answers: [["docker inspect", { stdout: "healthy\n" }]] });
  const lines: string[] = [];
  const deps = {
    remote,
    secrets,
    jellyfin,
    clock: new FakeClock(),
    log: (l: string) => lines.push(l),
  };
  return { server, secrets, remote, deps, lines };
}

describe("backup", () => {
  it("takes a consistent database backup, then a restic snapshot with retention", async () => {
    const { server, remote, deps } = setup();
    await backup(deps, exampleConfig(withBackup), { dryRun: false });

    expect(server.find("post", "/Backup/Create")).toHaveLength(1);
    const script = remote.scripts().find((s) => s.includes("restic backup"))!;
    expect(script).toContain("RESTIC_REPOSITORY='/mnt/backup/restic'");
    expect(script).toContain("restic cat config >/dev/null 2>&1 || restic init");
    expect(script).toContain("restic backup /srv/jellyfin/config");
    expect(script).toContain("--exclude-caches");
    expect(script).toContain("restic forget --keep-daily 7 --keep-weekly 4 --prune");
  });

  it("hands the password over through a private file on tmpfs, never in a script", async () => {
    const { remote, deps } = setup();
    await backup(deps, exampleConfig(withBackup), { dryRun: false });

    expect(JSON.stringify(remote.scripts())).not.toContain(PASSWORD);
    const write = remote.calls.find((c) => c.kind === "write")!;
    expect(write.cmd.startsWith("/run/")).toBe(true);
    expect(write.mode).toBe("0600");
    expect(write.stdin).toContain(PASSWORD);
    expect(remote.scripts().find((s) => s.includes("restic backup"))).toContain(
      `trap 'rc=$?; rm -f ${write.cmd}; exit $rc' EXIT`,
    );
  });

  it("prunes old Jellyfin zips with a pipeline that survives there being none", async () => {
    const { remote, deps } = setup();
    await backup(deps, exampleConfig(withBackup), { dryRun: false });
    const line = remote
      .scripts()
      .find((s) => s.includes("restic backup"))!
      .split("\n")
      .find((l) => l.includes("xargs"))!;
    const empty = mkdtempSync(join(tmpdir(), "bifrost-nozip-"));
    const code = spawnSync("bash", [
      "-c",
      `set -eo pipefail; ${line.replace("/srv/jellyfin/config/data/backups", empty)}`,
    ]).status;
    expect(code).toBe(0);
  });

  it("explains what is missing", async () => {
    const { deps, secrets } = setup();
    await expect(backup(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(/backup/);
    secrets.values.delete("RESTIC_PASSWORD");
    await expect(backup(deps, exampleConfig(withBackup), { dryRun: false })).rejects.toThrow(
      /RESTIC_PASSWORD/,
    );
  });

  it("changes nothing on --dry-run", async () => {
    const { server, remote, deps } = setup();
    await backup(deps, exampleConfig(withBackup), { dryRun: true });
    expect(server.writes()).toEqual([]);
    expect(remote.mutations()).toEqual([]);
  });
});

describe("restore", () => {
  it("refuses to overwrite without --yes", async () => {
    const { remote, deps } = setup();
    await expect(
      restore(deps, exampleConfig(withBackup), { dryRun: false, yes: false, snapshot: "latest" }),
    ).rejects.toThrow(/--yes/);
    expect(remote.mutations()).toEqual([]);
  });

  it("stops the stack, restores the config directory, fixes ownership and starts again", async () => {
    const { remote, deps } = setup();
    await restore(deps, exampleConfig(withBackup), {
      dryRun: false,
      yes: true,
      snapshot: "abc123",
    });
    const scripts = remote.scripts();
    const script = scripts.find((s) => s.includes("restic restore"))!;
    const at = (needle: string) => script.indexOf(needle);
    const stop = at("docker compose -f /srv/jellyfin/compose.yaml stop");
    const res = at("restic restore abc123 --target / --include /srv/jellyfin/config");
    const chown = at("chown -R jellyfin:jellyfin /srv/jellyfin/config");
    const start = script.lastIndexOf("docker compose -f /srv/jellyfin/compose.yaml up -d");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(res).toBeGreaterThan(stop);
    expect(chown).toBeGreaterThan(res);
    expect(start).toBeGreaterThan(chown);
    expect(JSON.stringify(scripts)).not.toContain(PASSWORD);
  });

  it("deletes what the snapshot does not have, drops stale WAL/SHM files and always brings Jellyfin back", async () => {
    const { remote, deps } = setup();
    await restore(deps, exampleConfig(withBackup), {
      dryRun: false,
      yes: true,
      snapshot: "latest",
    });
    const script = remote.scripts().find((s) => s.includes("restic restore"))!;
    expect(script).toContain(
      "restic restore latest --target / --include /srv/jellyfin/config --delete",
    );
    const res = script.indexOf("restic restore");
    const wal = script.indexOf("-name '*.db-wal'");
    expect(wal).toBeGreaterThan(res);
    expect(script.indexOf("-name '*.db-shm'")).toBeGreaterThan(res);
    // The EXIT trap restarts the stack even when a step in the middle fails.
    const trap = script.split("\n").find((l) => l.startsWith("trap "))!;
    expect(trap).toContain("rm -f /run/bifrost/restic.pass");
    expect(trap).toContain("docker compose -f /srv/jellyfin/compose.yaml up -d");
  });

  it("changes nothing on --dry-run", async () => {
    const { remote, deps } = setup();
    await restore(deps, exampleConfig(withBackup), {
      dryRun: true,
      yes: false,
      snapshot: "latest",
    });
    expect(remote.mutations()).toEqual([]);
  });
});

const withHm = (r: any) => {
  withBackup(r);
  r.hm = { mediaDir: "/srv/jellyfin/media/tv" };
};
const backupScript = (remote: FakeRemoteHost) =>
  remote.scripts().find((s) => s.includes("restic backup"))!;

describe("backup with Orca'H&M", () => {
  it("snapshots only the H&M data directory, never its env file or build sources", async () => {
    const { remote, deps } = setup();
    await backup(deps, exampleConfig(withHm), { dryRun: false });
    const script = backupScript(remote);
    expect(script).toContain("/srv/orca-hm/data");
    expect(script).not.toContain("hm.env");
    expect(script).not.toContain("/srv/orca-hm/src");
    expect(script).not.toContain("restic backup /srv/orca-hm ");
  });

  it("stops H&M for a consistent SQLite copy and starts it again, even when restic fails", async () => {
    const { remote, deps } = setup();
    await backup(deps, exampleConfig(withHm), { dryRun: false });
    const script = backupScript(remote);
    const stop = script.indexOf("docker stop orca-hm");
    const snap = script.indexOf("restic backup");
    const start = script.indexOf("\nhm_restart\n", snap);
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(snap).toBeGreaterThan(stop);
    expect(start).toBeGreaterThan(snap);
    expect(script.indexOf("restic forget")).toBeGreaterThan(start);
    const trap = script.split("\n").find((l) => l.startsWith("trap "))!;
    expect(trap).toContain("rm -f /run/bifrost/restic.pass");
    expect(trap).toContain("hm_restart");
  });

  it("does nothing about H&M without the hm section", async () => {
    const { remote, deps } = setup();
    await backup(deps, exampleConfig(withBackup), { dryRun: false });
    expect(JSON.stringify(remote.scripts())).not.toContain("orca-hm");
  });
});

describe("restore with Orca'H&M", () => {
  const run = async (patch: (r: any) => void) => {
    const { remote, deps } = setup();
    await restore(deps, exampleConfig(patch), { dryRun: false, yes: true, snapshot: "abc123" });
    return remote.scripts().find((s) => s.includes("restic restore"))!;
  };

  it("restores the H&M data while the stack is stopped, fixes ownership, then starts it", async () => {
    const script = await run(withHm);
    const at = (needle: string) => script.indexOf(needle);
    const stop = at("docker compose -f /srv/jellyfin/compose.yaml stop");
    const res = at("restic restore abc123 --target / --include /srv/orca-hm/data");
    const chown = at("chown -R orca-hm:jellyfin /srv/orca-hm/data");
    const start = script.lastIndexOf("docker compose -f /srv/jellyfin/compose.yaml up -d");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(res).toBeGreaterThan(stop);
    expect(chown).toBeGreaterThan(res);
    expect(start).toBeGreaterThan(chown);
  });

  it("creates the orca-hm user first (a fresh machine does not have it yet)", async () => {
    const script = await run(withHm);
    expect(script.indexOf("useradd")).toBeLessThan(script.indexOf("chown -R orca-hm"));
  });

  it("leaves H&M's data alone when the snapshot has none", async () => {
    const script = await run(withHm);
    expect(script).toMatch(/restic -q ls abc123 \/srv\/orca-hm\/data/);
  });

  it("does nothing about H&M without the hm section", async () => {
    const script = await run(withBackup);
    expect(script).not.toContain("orca-hm");
  });
});

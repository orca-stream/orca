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
      `trap 'rm -f ${write.cmd}' EXIT`,
    );
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
    const start = at("docker compose -f /srv/jellyfin/compose.yaml up -d");
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(res).toBeGreaterThan(stop);
    expect(chown).toBeGreaterThan(res);
    expect(start).toBeGreaterThan(chown);
    expect(JSON.stringify(scripts)).not.toContain(PASSWORD);
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

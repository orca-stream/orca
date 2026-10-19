import { describe, expect, it } from "vite-plus/test";
import { migrate } from "../src/application/migrate.ts";
import { shQuote } from "../src/domain/shell.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { FakeRemoteHost } from "./fakes/remote-host.ts";
import { InMemorySecretStore } from "./fakes/secret-store.ts";
import { exampleConfig } from "./fixtures.ts";

function setup(sourceVersion = "12.2.0", targetVersion = "12.2.0") {
  const source = new FakeJellyfinServer();
  const target = new FakeJellyfinServer();
  source.wizardCompleted = target.wizardCompleted = true;
  source.version = sourceVersion;
  target.version = targetVersion;
  // The target answers to its own key until the restore swaps the database for the source's.
  target.validToken = "target-key";
  target.tokenAfterRestore = "source-key";
  target.authFailuresAfterRestore = 3;
  const client = (s: FakeJellyfinServer, token: string) =>
    new SdkJellyfinAdmin({ url: "http://fake:8096", token, axios: s.axios });
  const remote = new FakeRemoteHost();
  const clock = new FakeClock();
  const secrets = new InMemorySecretStore({ JELLYFIN_API_KEY: "target-key" });
  const lines: string[] = [];
  const reads: string[] = [];
  const deps = {
    source: client(source, "source-key"),
    target: client(target, "target-key"),
    targetAsSource: client(target, "source-key"),
    remote,
    secrets,
    clock,
    canRead: async (path: string) => {
      reads.push(path);
      return true;
    },
    log: (l: string) => lines.push(l),
  };
  return { source, target, remote, clock, secrets, deps, lines, reads };
}

describe("migrate", () => {
  it("backs up the source, copies the zip to the host, then restores it on the target — in that order", async () => {
    const { source, target, remote, deps } = setup();
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
    expect(target.find("post", "/Backup/Restore")[0]?.body).toEqual({
      ArchiveFileName: "jellyfin-backup-1.zip",
    });
    expect(source.writes().map((w) => w.path)).toEqual(["/Backup/Create"]);
  });

  it("calls the restore done only when the target accepts the source's API key", async () => {
    const { target, clock, deps } = setup();
    await migrate(deps, exampleConfig(), { dryRun: false });
    // Three 401s (restore still running) had to be waited out before the key was accepted.
    expect(target.find("get", "/Auth/Keys").length).toBeGreaterThanOrEqual(4);
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(4);
  });

  it("then creates the Bifrost key with the source's key and stores it for the next commands", async () => {
    const { target, secrets, deps } = setup();
    await migrate(deps, exampleConfig(), { dryRun: false });
    expect(target.find("post", "/Auth/Keys")).toHaveLength(1);
    expect(target.keys.map((k) => k.AppName)).toEqual(["Bifrost"]);
    expect(await secrets.get("JELLYFIN_API_KEY")).toBe(target.keys[0]!.AccessToken);
  });

  it("reuses an existing Bifrost key and does not create a second one", async () => {
    const { target, secrets, deps } = setup();
    target.onRestore = () => {
      target.keys = [{ AppName: "Bifrost", AccessToken: "source-key" }];
    };
    await migrate(deps, exampleConfig(), { dryRun: false });
    expect(target.find("post", "/Auth/Keys")).toHaveLength(0);
    expect(await secrets.get("JELLYFIN_API_KEY")).toBe("source-key");
  });

  it("times out with an explanation if the target never accepts the source's key", async () => {
    const { target, deps } = setup();
    target.tokenAfterRestore = "someone-else";
    await expect(migrate(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(
      /source's API key/,
    );
  });

  it("checks that the backup is readable here before copying, and hints at --backup-file", async () => {
    const { remote, target, deps } = setup();
    deps.canRead = async () => false;
    await expect(migrate(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(
      /--backup-file/,
    );
    expect(remote.mutations()).toEqual([]);
    expect(target.writes()).toEqual([]);
  });

  it("uses --backup-file as is, without asking the source for another backup", async () => {
    const { source, remote, reads, deps } = setup();
    await migrate(deps, exampleConfig(), { dryRun: false, backupFile: "/tmp/copy/other.zip" });
    expect(source.writes()).toEqual([]);
    expect(reads).toEqual(["/tmp/copy/other.zip"]);
    expect(remote.calls.find((c) => c.kind === "copy")).toMatchObject({
      stdin: "/tmp/copy/other.zip",
      cmd: "/srv/jellyfin/config/data/backups/other.zip",
    });
  });

  it("quotes the file name in every root script", async () => {
    const { remote, deps } = setup();
    const evil = "/tmp/x'; touch pwned; echo '.zip";
    await migrate(deps, exampleConfig(), { dryRun: false, backupFile: evil });
    const chown = remote.scripts().find((s) => s.includes("chown"))!;
    expect(chown).toContain(
      shQuote("/srv/jellyfin/config/data/backups/x'; touch pwned; echo '.zip"),
    );
  });

  it("refuses to restore a backup from a newer server", async () => {
    const { source, target, remote, deps } = setup("12.3.0", "12.2.0");
    await expect(migrate(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(/newer/);
    expect(source.writes()).toEqual([]);
    expect(target.writes()).toEqual([]);
    expect(remote.mutations()).toEqual([]);
  });

  it("changes nothing on --dry-run", async () => {
    const { source, target, remote, secrets, deps, lines } = setup();
    await migrate(deps, exampleConfig(), { dryRun: true });
    expect(source.writes()).toEqual([]);
    expect(target.writes()).toEqual([]);
    expect(remote.mutations()).toEqual([]);
    expect([...secrets.values.keys()]).toEqual(["JELLYFIN_API_KEY"]);
    expect(lines.join("\n")).toMatch(/would/i);
  });
});

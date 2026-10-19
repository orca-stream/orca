import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * Runs the generated scripts with `bash -se` against stub binaries on PATH, so the shell logic
 * (guards, traps, exit codes) is exercised and not only its text. Nothing touches a real host.
 */
const STUBS: Record<string, string> = {
  docker: `echo "docker $*" >> "$LOG"; if [ "$1" = ps ]; then echo "\${HM_RUNNING:+cid}"; fi`,
  restic: `echo "restic $*" >> "$LOG"
case "$1" in
  version) echo "restic \${RESTIC_VERSION:-0.18.1} compiled with go1.24" ;;
  cat) exit "\${CAT_RC:-0}" ;;
  init) exit "\${INIT_RC:-0}" ;;
  backup) exit "\${BACKUP_RC:-0}" ;;
  restore) exit "\${RESTORE_RC:-0}" ;;
  ls|-q) # restic [-q] ls: a header line the caller must not mistake for data
    echo "snapshot abc of [/x] filtered by []:"
    [ -z "$LS_DATA" ] || echo "\${@: -1}"
    ;;
esac
exit 0`,
  // The real chown fails on a path that does not exist.
  chown: `echo "chown $*" >> "$LOG"; [ -e "\${@: -1}" ]`,
  useradd: `echo "useradd $*" >> "$LOG"`,
  id: `exit 0`,
};

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "bifrost-sim-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const jf = join(root, "srv/jellyfin");
  const hm = join(root, "srv/orca-hm");
  mkdirSync(join(jf, "config"), { recursive: true });
  mkdirSync(join(hm, "data"), { recursive: true });
  const log = join(root, "log");
  writeFileSync(log, "");
  const patch = (r: any) => {
    r.host.dataDir = jf;
    r.backup = {
      repository: "/repo",
      passwordSecret: "RESTIC_PASSWORD",
      keep: { daily: 7, weekly: 4 },
    };
    r.hm = { mediaDir: `${jf}/media/tv`, dataDir: hm };
  };
  const run = (script: string, env: Record<string, string> = {}) => {
    const res = spawnSync("bash", ["-se"], {
      input: script,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, LOG: log, ...env },
    });
    return {
      code: res.status,
      stderr: res.stderr,
      log: readFileSync(log, "utf8").split("\n").filter(Boolean),
    };
  };
  return { root, jf, hm, patch, run };
}

function deps() {
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  const remote = new FakeRemoteHost({ answers: [["docker inspect", { stdout: "healthy\n" }]] });
  return {
    remote,
    secrets: new InMemorySecretStore({ RESTIC_PASSWORD: "pw" }),
    jellyfin: new SdkJellyfinAdmin({ url: "http://fake:8096", token: "k", axios: server.axios }),
    clock: new FakeClock(),
    log: () => {},
  };
}

async function backupScript(patch: (r: any) => void) {
  const d = deps();
  await backup(d, exampleConfig(patch), { dryRun: false });
  return d.remote.scripts().find((s) => s.includes("restic backup"))!;
}

async function restoreScript(patch: (r: any) => void, only?: "all" | "hm" | "jellyfin") {
  const d = deps();
  await restore(d, exampleConfig(patch), {
    dryRun: false,
    yes: true,
    snapshot: "abc123",
    ...(only ? { only } : {}),
  });
  return d.remote.scripts().find((s) => s.includes("restic restore"))!;
}

describe("generated backup script, executed", () => {
  it("backs up both directories, stopping H&M only around the snapshot", async () => {
    const sb = sandbox();
    const out = sb.run(await backupScript(sb.patch), { HM_RUNNING: "1" });
    expect(out.code).toBe(0);
    const at = (needle: string) => out.log.findIndex((l) => l.includes(needle));
    expect(at("docker stop orca-hm")).toBeLessThan(at("restic backup"));
    expect(at("docker start orca-hm")).toBeGreaterThan(at("restic backup"));
    expect(at("restic forget")).toBeGreaterThan(at("docker start orca-hm"));
  });

  it("restarts H&M and keeps restic's exit code when the snapshot fails", async () => {
    const sb = sandbox();
    const out = sb.run(await backupScript(sb.patch), { HM_RUNNING: "1", BACKUP_RC: "3" });
    expect(out.code).toBe(3);
    expect(out.log).toContain("docker start orca-hm");
    expect(out.log.join("\n")).not.toContain("restic forget");
  });

  it("fails cleanly (no 'command not found') when the repository cannot be initialised", async () => {
    const sb = sandbox();
    const out = sb.run(await backupScript(sb.patch), {
      HM_RUNNING: "1",
      CAT_RC: "1",
      INIT_RC: "4",
    });
    expect(out.code).toBe(4);
    expect(out.stderr).not.toContain("not found");
  });

  it("does not start H&M when it was not running", async () => {
    const sb = sandbox();
    const out = sb.run(await backupScript(sb.patch));
    expect(out.code).toBe(0);
    expect(out.log.join("\n")).not.toContain("docker start");
    expect(out.log.join("\n")).not.toContain("docker stop");
  });
});

describe("generated restore script, executed", () => {
  it("skips H&M and still cleans Jellyfin's WAL files when the snapshot has no H&M data", async () => {
    const sb = sandbox();
    // restic prints a header even for an empty listing; H&M's data dir does not exist on the host.
    const out = sb.run(await restoreScript(sb.patch), {});
    expect(out.code).toBe(0);
    const text = out.log.join("\n");
    expect(text).not.toContain("--include " + sb.hm);
    expect(text).not.toContain("chown -R orca-hm");
    expect(text).toContain("chown -R jellyfin:jellyfin " + sb.jf + "/config");
    expect(text).toMatch(/compose.* up -d/);
    expect(out.stderr).toContain("no Orca H&M data");
  });

  it("restores both when the snapshot has the H&M data", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch), { LS_DATA: "1" });
    expect(out.code).toBe(0);
    const text = out.log.join("\n");
    expect(text).toContain(`--include ${sb.hm}/data`);
    expect(text).toContain(`chown -R orca-hm:jellyfin ${sb.hm}/data`);
  });

  it("--only hm leaves Jellyfin alone and touches only the orca-hm container", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch, "hm"), { LS_DATA: "1", HM_RUNNING: "1" });
    expect(out.code).toBe(0);
    const text = out.log.join("\n");
    expect(text).not.toContain("compose");
    expect(text).not.toContain("jellyfin:jellyfin");
    expect(text).not.toContain(sb.jf + "/config");
    expect(text).toContain("docker stop orca-hm");
    expect(text).toContain(`chown -R orca-hm:jellyfin ${sb.hm}/data`);
    expect(out.log).toContain("docker start orca-hm");
  });

  it("--only hm fails loudly (and restarts H&M) when the snapshot has no H&M data", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch, "hm"), { HM_RUNNING: "1" });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("no Orca H&M data");
    expect(out.log).toContain("docker start orca-hm");
  });

  it("--only jellyfin never mentions H&M", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch, "jellyfin"));
    expect(out.code).toBe(0);
    expect(out.log.join("\n")).not.toContain("orca-hm");
    expect(out.log.join("\n")).toContain("chown -R jellyfin:jellyfin");
  });

  it("keeps the failing exit code and still starts Jellyfin", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch), { RESTORE_RC: "5" });
    expect(out.code).toBe(5);
    expect(out.log.some((l) => /compose.* up -d/.test(l))).toBe(true);
  });

  it("refuses restic older than 0.17 (no --delete semantics) before stopping anything", async () => {
    const sb = sandbox();
    const out = sb.run(await restoreScript(sb.patch), { RESTIC_VERSION: "0.16.4" });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("0.17");
    expect(out.log.join("\n")).not.toContain("restic restore");
    expect(out.log.join("\n")).not.toMatch(/compose.* stop/);
  });
});

describe("restore --only", () => {
  it("needs the hm section for --only hm", async () => {
    const d = deps();
    const cfg = exampleConfig((r) => {
      r.backup = {
        repository: "/repo",
        passwordSecret: "RESTIC_PASSWORD",
        keep: { daily: 7, weekly: 4 },
      };
    });
    await expect(
      restore(d, cfg, { dryRun: false, yes: true, snapshot: "latest", only: "hm" }),
    ).rejects.toThrow(/hm/);
  });
});

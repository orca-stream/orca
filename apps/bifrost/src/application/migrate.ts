import { basename } from "node:path/posix";
import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import { compareVersions } from "../domain/version.ts";
import type { Clock } from "./ports/clock.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import { waitFor } from "./wait.ts";

export interface MigrateDeps {
  /** The Jellyfin to move away from, and the new one the config describes. */
  source: JellyfinAdmin;
  target: JellyfinAdmin;
  remote: RemoteHost;
  clock: Clock;
  log: (line: string) => void;
}

/**
 * Jellyfin's built-in backup carries users, passwords, watch state and library ids across servers.
 * Source: create the backup. Host: copy the zip into the container's backup directory. Target: restore it.
 * The media must be mounted at the same paths as on the source, or the library paths will not resolve.
 */
export async function migrate(
  deps: MigrateDeps,
  cfg: Config,
  opts: { dryRun: boolean; backupFile?: string },
): Promise<void> {
  const { source, target, remote, clock, log } = deps;
  const from = await source.publicInfo();
  const to = await target.publicInfo();
  log(`Source Jellyfin ${from.version}, target Jellyfin ${to.version}.`);
  if (compareVersions(from.version, to.version) > 0) {
    throw new BifrostError(
      `The source (${from.version}) is newer than the target (${to.version}): Jellyfin refuses to restore a backup from a newer server.`,
    );
  }
  const backupsDir = `${cfg.host.dataDir}/config/data/backups`;

  if (opts.dryRun) {
    log("would  create a database backup on the source");
    log(`would  copy it to ${backupsDir} on ${cfg.host.name}`);
    log(
      "would  restore it on the target (the target restarts; its users and API keys become the source's)",
    );
    return;
  }

  const manifest = await source.createBackup();
  const localPath = opts.backupFile ?? manifest.Path;
  const fileName = basename(localPath);
  log(`Source backup: ${localPath}`);

  const dest = `${backupsDir}/${fileName}`;
  await remote.exec(`install -d -o jellyfin -g jellyfin -m 0750 ${backupsDir}`, { sudo: true });
  await remote.copyTo(localPath, dest, { sudo: true });
  await remote.exec(`chown jellyfin:jellyfin ${dest}`, { sudo: true });

  await target.startRestore(fileName);
  log("Restore started on the target; waiting for it to restart...");
  await waitFor(
    clock,
    "the target to come back after the restore",
    async () => {
      await target.publicInfo();
      return true;
    },
    { initialDelayMs: 5_000 },
  );
  log(
    "Restore finished. The target now has the source's users and API keys: run `bifrost init` again.",
  );
}

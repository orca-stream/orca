import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import { DryRunRemoteHost } from "./dry-run-remote-host.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";
import { backupConfig, resticPreamble, stagePassword } from "./restic.ts";

export interface BackupDeps {
  remote: RemoteHost;
  secrets: SecretStore;
  jellyfin: JellyfinAdmin;
  log: (line: string) => void;
}

/**
 * Jellyfin's own database backup first (the live database is locked, so a plain file copy is not
 * consistent), then a restic snapshot of the config directory and retention.
 */
export async function backup(
  deps: BackupDeps,
  cfg: Config,
  opts: { dryRun: boolean },
): Promise<void> {
  const { jellyfin, secrets, log } = deps;
  const remote = opts.dryRun ? new DryRunRemoteHost(deps.remote, log) : deps.remote;
  const b = backupConfig(cfg);
  const configDir = `${cfg.host.dataDir}/config`;

  if (opts.dryRun) {
    log("would  ask Jellyfin for a consistent database backup");
  } else {
    const manifest = await jellyfin.createBackup();
    log(`Jellyfin backup created: ${manifest.Path}`);
  }

  await stagePassword(remote, secrets, b.passwordSecret);
  const script = [
    ...resticPreamble(b),
    // Keep only the two newest of Jellyfin's own zips: restic keeps the history.
    `ls -1t ${configDir}/data/backups/*.zip 2>/dev/null | tail -n +3 | xargs -r rm -f`,
    "restic cat config >/dev/null 2>&1 || restic init",
    `restic backup ${configDir} --exclude ${configDir}/log --exclude-caches`,
    `restic forget --keep-daily ${b.keep.daily} --keep-weekly ${b.keep.weekly} --prune`,
    "",
  ].join("\n");
  const res = await remote.exec(script, { sudo: true });
  if (res.code !== 0)
    throw new BifrostError(`restic failed (exit ${res.code}):\n${res.stderr.trim()}`);
  log("Backup done.");
}

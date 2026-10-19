import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import { HM_CREATE_USER_COMMAND, HM_USER, hmDataPath } from "../domain/hm.ts";
import { waitHealthy } from "./docker.ts";
import { DryRunRemoteHost } from "./dry-run-remote-host.ts";
import type { Clock } from "./ports/clock.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";
import { backupConfig, resticPreamble, stagePassword } from "./restic.ts";

export interface RestoreDeps {
  remote: RemoteHost;
  secrets: SecretStore;
  clock: Clock;
  log: (line: string) => void;
}

/**
 * H&M's data comes back while its container is stopped (it shares the compose stack). Snapshots from
 * before H&M was backed up have no such directory: restoring then would `--delete` the live data for
 * nothing, so it is skipped. The user is created first because a fresh machine has not run `hm up`.
 */
function hmRestoreLines(snapshot: string, hmData: string): string[] {
  return [
    `if [ -n "$(restic ls ${snapshot} ${hmData} 2>/dev/null | head -n 1)" ]; then`,
    `  restic restore ${snapshot} --target / --include ${hmData} --delete`,
    `  ${HM_CREATE_USER_COMMAND}`,
    `  chown -R ${HM_USER}:jellyfin ${hmData}`,
    "else",
    `  echo "snapshot ${snapshot} has no Orca H&M data; leaving ${hmData} as it is" >&2`,
    "fi",
  ];
}

/** Stops Jellyfin, restores the config directory from a restic snapshot over the live one, starts again. */
export async function restore(
  deps: RestoreDeps,
  cfg: Config,
  opts: { dryRun: boolean; yes: boolean; snapshot: string },
): Promise<void> {
  const { secrets, clock, log } = deps;
  const remote = opts.dryRun ? new DryRunRemoteHost(deps.remote, log) : deps.remote;
  const b = backupConfig(cfg);
  if (!opts.dryRun && !opts.yes) {
    throw new BifrostError(
      `Restoring replaces ${cfg.host.dataDir}/config with snapshot "${opts.snapshot}". Pass --yes to go ahead.`,
    );
  }
  if (!/^[A-Za-z0-9]+$/.test(opts.snapshot)) {
    throw new BifrostError(
      `"${opts.snapshot}" is not a restic snapshot id (use "latest" or a hex id).`,
    );
  }
  const configDir = `${cfg.host.dataDir}/config`;
  const compose = `${cfg.host.dataDir}/compose.yaml`;

  await stagePassword(remote, secrets, b.passwordSecret);
  const script = [
    // Whatever fails in the middle, Jellyfin is started again when the script ends.
    ...resticPreamble(b, [`docker compose -f ${compose} up -d`]),
    `docker compose -f ${compose} stop`,
    `restic restore ${opts.snapshot} --target / --include ${configDir} --delete`,
    ...(cfg.hm ? hmRestoreLines(opts.snapshot, hmDataPath(cfg.hm)) : []),
    // A snapshot of a live SQLite database may carry write-ahead files that no longer match it.
    `find ${configDir} -name '*.db-wal' -delete`,
    `find ${configDir} -name '*.db-shm' -delete`,
    `chown -R jellyfin:jellyfin ${configDir}`,
    `docker compose -f ${compose} up -d`,
    "",
  ].join("\n");
  const res = await remote.exec(script, { sudo: true });
  if (res.code !== 0)
    throw new BifrostError(`restore failed (exit ${res.code}):\n${res.stderr.trim()}`);
  if (!opts.dryRun) await waitHealthy(remote, clock);
  log(`Restored snapshot ${opts.snapshot}.`);
}

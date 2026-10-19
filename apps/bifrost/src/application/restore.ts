import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import { JELLYFIN_SERVICE } from "../domain/containers.ts";
import { HM_CREATE_USER_COMMAND, HM_SERVICE, HM_USER, hmDataPath } from "../domain/hm.ts";
import { waitHealthy } from "./docker.ts";
import { DryRunRemoteHost } from "./dry-run-remote-host.ts";
import type { Clock } from "./ports/clock.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";
import { hmRestartDefinitions } from "./backup.ts";
import { backupConfig, resticPreamble, resticVersionCheck, stagePassword } from "./restic.ts";

export interface RestoreDeps {
  remote: RemoteHost;
  secrets: SecretStore;
  clock: Clock;
  log: (line: string) => void;
}

export type RestoreOnly = "all" | "hm" | "jellyfin";
export const RESTORE_ONLY: readonly RestoreOnly[] = ["all", "hm", "jellyfin"];

/**
 * H&M's data comes back while its container is stopped. A snapshot taken before H&M was backed up
 * has no such directory: with `all` that is skipped (restoring would `--delete` the live data for
 * nothing), with `hm` it is an error, since the operator asked for exactly that. The listing is
 * captured first (a real restic error aborts the script) and matched on the directory's own line,
 * because `restic ls` prints a header even for an empty result. The user is created first because a
 * fresh machine has not run `hm up`.
 */
function hmRestoreLines(snapshot: string, hmData: string, only: RestoreOnly): string[] {
  return [
    `listing=$(restic -q ls ${snapshot} ${hmData})`,
    `if printf '%s\\n' "$listing" | grep -Fxq ${hmData}; then`,
    `  restic restore ${snapshot} --target / --include ${hmData} --delete`,
    `  ${HM_CREATE_USER_COMMAND}`,
    `  [ ! -d ${hmData} ] || chown -R ${HM_USER}:jellyfin ${hmData}`,
    "else",
    `  echo "snapshot ${snapshot} has no Orca H&M data; leaving ${hmData} as it is" >&2`,
    ...(only === "hm" ? ["  exit 1"] : []),
    "fi",
  ];
}

/**
 * Restores from a restic snapshot over the live directories, with the affected containers stopped:
 * `all` (default) the whole stack, `jellyfin` only Jellyfin's config, `hm` only H&M's data (Jellyfin
 * keeps running).
 */
export async function restore(
  deps: RestoreDeps,
  cfg: Config,
  opts: { dryRun: boolean; yes: boolean; snapshot: string; only?: RestoreOnly },
): Promise<void> {
  const { secrets, clock, log } = deps;
  const only = opts.only ?? "all";
  const remote = opts.dryRun ? new DryRunRemoteHost(deps.remote, log) : deps.remote;
  const b = backupConfig(cfg);
  if (only === "hm" && !cfg.hm) throw new BifrostError("--only hm needs the `hm` section.");
  const what =
    only === "hm"
      ? `${cfg.hm?.dataDir}/data`
      : only === "jellyfin"
        ? `${cfg.host.dataDir}/config`
        : `${cfg.host.dataDir}/config${cfg.hm ? ` and ${cfg.hm.dataDir}/data` : ""}`;
  if (!opts.dryRun && !opts.yes) {
    throw new BifrostError(
      `Restoring replaces ${what} with snapshot "${opts.snapshot}". Pass --yes to go ahead.`,
    );
  }
  if (!/^[A-Za-z0-9]+$/.test(opts.snapshot)) {
    throw new BifrostError(
      `"${opts.snapshot}" is not a restic snapshot id (use "latest" or a hex id).`,
    );
  }
  const configDir = `${cfg.host.dataDir}/config`;
  const compose = `docker compose -f ${cfg.host.dataDir}/compose.yaml`;
  const withJellyfin = only !== "hm";
  const withHm = !!cfg.hm && only !== "jellyfin";
  // Jellyfin-only stops just its service; `all` stops the stack (H&M shares the compose file).
  const target = only === "jellyfin" ? ` ${JELLYFIN_SERVICE}` : "";
  const startJellyfin = `${compose} up -d${only === "jellyfin" ? ` --no-deps ${JELLYFIN_SERVICE}` : ""}`;

  await stagePassword(remote, secrets, b.passwordSecret);
  const script = [
    // H&M alone is stopped with plain docker: its compose service may not exist yet on a new machine.
    ...(only === "hm" ? hmRestartDefinitions() : []),
    // `stopped` arms the start-on-exit only once the stack is really stopped, so a failed version
    // check does not start services the operator had stopped.
    ...(only === "hm" ? [] : ["stopped="]),
    // Whatever fails in the middle, what was stopped is started again when the script ends.
    ...resticPreamble(b, [only === "hm" ? "hm_restart" : `[ -z "$stopped" ] || ${startJellyfin}`]),
    ...resticVersionCheck(),
    ...(only === "hm"
      ? [`[ -z "$hm_was_running" ] || docker stop ${HM_SERVICE} >/dev/null`]
      : [`${compose} stop${target}`, "stopped=1"]),
    ...(withJellyfin
      ? [
          `restic restore ${opts.snapshot} --target / --include ${configDir} --delete`,
          // A snapshot of a live SQLite database may carry write-ahead files that no longer match it.
          `find ${configDir} -name '*.db-wal' -delete`,
          `find ${configDir} -name '*.db-shm' -delete`,
          `chown -R jellyfin:jellyfin ${configDir}`,
        ]
      : []),
    ...(withHm ? hmRestoreLines(opts.snapshot, hmDataPath(cfg.hm!), only) : []),
    // Started once here; the trap only covers a failure before this point.
    ...(only === "hm" ? ["hm_restart"] : [startJellyfin, "stopped="]),
    "",
  ].join("\n");
  const res = await remote.exec(script, { sudo: true });
  if (res.code !== 0)
    throw new BifrostError(`restore failed (exit ${res.code}):\n${res.stderr.trim()}`);
  if (!opts.dryRun && withJellyfin) await waitHealthy(remote, clock);
  log(`Restored snapshot ${opts.snapshot}.`);
}

import { basename } from "node:path/posix";
import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import { shQuote } from "../domain/shell.ts";
import { compareVersions } from "../domain/version.ts";
import { API_KEY_APP } from "./init.ts";
import type { Clock } from "./ports/clock.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";
import { waitFor } from "./wait.ts";

export interface MigrateDeps {
  /** The Jellyfin to move away from, authenticated with its own API key. */
  source: JellyfinAdmin;
  /** The new Jellyfin the config describes, authenticated with its own (Bifrost) key. */
  target: JellyfinAdmin;
  /** The target's URL, authenticated with the SOURCE's key: only valid once the restore has replaced the database. */
  targetAsSource: JellyfinAdmin;
  remote: RemoteHost;
  secrets: SecretStore;
  clock: Clock;
  /** Whether the backup zip can be read on this machine. */
  canRead(path: string): Promise<boolean>;
  log: (line: string) => void;
}

/**
 * Jellyfin's built-in backup carries users, passwords, watch state, API keys and library ids across
 * servers. Source: create the backup. Host: copy the zip into the container's backup directory.
 * Target: restore it, wait until it answers to the source's API key (the restore is then done),
 * and make sure a "Bifrost" key exists so the next commands keep working.
 *
 * The media must be mounted at the same paths as on the source, and `apply` must declare those
 * paths: this is an alternative to pathMap, not something to combine with it.
 */
export async function migrate(
  deps: MigrateDeps,
  cfg: Config,
  opts: { dryRun: boolean; backupFile?: string },
): Promise<void> {
  const { source, target, targetAsSource, remote, secrets, clock, log } = deps;
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
    log("would  create a database backup on the source (or use --backup-file)");
    log(`would  copy it to ${backupsDir} on ${cfg.host.name}`);
    log(
      "would  restore it on the target (it restarts; its users and API keys become the source's)",
    );
    log(
      `would  wait until the target accepts the source's API key, then store a "${API_KEY_APP}" key as ${cfg.jellyfin.apiKeySecret}`,
    );
    return;
  }

  const localPath = opts.backupFile ?? (await source.createBackup()).Path;
  if (!(await deps.canRead(localPath))) {
    throw new BifrostError(
      `Cannot read ${localPath} on this machine. The backup is on the source server's disk (Jellyfin keeps it readable only by its own user): copy it here and pass --backup-file <zip>, or run Bifrost on the source machine as a user that can read it.`,
    );
  }
  const fileName = basename(localPath);
  log(`Source backup: ${localPath}`);

  const dest = `${backupsDir}/${fileName}`;
  await remote.exec(`install -d -o jellyfin -g jellyfin -m 0750 ${shQuote(backupsDir)}`, {
    sudo: true,
  });
  await remote.copyTo(localPath, dest, { sudo: true });
  await remote.exec(`chown jellyfin:jellyfin ${shQuote(dest)}`, { sudo: true });

  await target.startRestore(fileName);
  log("Restore started on the target; waiting until it accepts the source's API key...");
  await waitFor(
    clock,
    "the target to accept the source's API key (the restore has not finished, or that key does not exist on the source)",
    async () => {
      await targetAsSource.listApiKeys();
      return true;
    },
    { initialDelayMs: 5_000, timeoutMs: 600_000 },
  );

  let keys = await targetAsSource.listApiKeys();
  if (!keys.some((k) => k.AppName === API_KEY_APP)) {
    await targetAsSource.createApiKey(API_KEY_APP);
    keys = await targetAsSource.listApiKeys();
  }
  const key = keys.find((k) => k.AppName === API_KEY_APP);
  if (!key)
    throw new BifrostError(
      `The "${API_KEY_APP}" API key was not found on the target after creating it.`,
    );
  await secrets.set(cfg.jellyfin.apiKeySecret, key.AccessToken);
  log(
    `Restore finished. The "${API_KEY_APP}" key of the target is stored as ${cfg.jellyfin.apiKeySecret}.`,
  );
}

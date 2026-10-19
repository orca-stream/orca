import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";

export const RESTIC_PASSWORD_FILE = "/run/bifrost/restic.pass";

export function backupConfig(cfg: Config): NonNullable<Config["backup"]> {
  if (!cfg.backup)
    throw new BifrostError(
      "The config has no `backup` section (repository, passwordSecret, keep).",
    );
  return cfg.backup;
}

/**
 * Puts the restic password where only root can read it, on tmpfs (/run), so it never reaches a
 * disk. The script that uses it must delete it again (see `resticPreamble`).
 */
export async function stagePassword(
  remote: RemoteHost,
  secrets: SecretStore,
  key: string,
): Promise<void> {
  const password = await secrets.get(key);
  if (!password)
    throw new BifrostError(
      `The restic password is not set: put ${key}=<password> in the .env file.`,
    );
  await remote.exec("install -d -m 0700 /run/bifrost", { sudo: true });
  await remote.writeFile(RESTIC_PASSWORD_FILE, `${password}\n`, { sudo: true, mode: "0600" });
}

/** Shell lines that point restic at the repository and clean the password file up however the script ends. */
export function resticPreamble(backup: NonNullable<Config["backup"]>): string[] {
  return [
    "set -o pipefail",
    `export RESTIC_REPOSITORY='${backup.repository}'`,
    `export RESTIC_PASSWORD_FILE=${RESTIC_PASSWORD_FILE}`,
    `trap 'rm -f ${RESTIC_PASSWORD_FILE}' EXIT`,
  ];
}

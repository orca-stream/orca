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
export function resticPreamble(
  backup: NonNullable<Config["backup"]>,
  /** Extra commands for the EXIT trap, run after the password file is removed. */
  onExit: string[] = [],
): string[] {
  return [
    "set -o pipefail",
    `export RESTIC_REPOSITORY='${backup.repository}'`,
    `export RESTIC_PASSWORD_FILE=${RESTIC_PASSWORD_FILE}`,
    // The script's own exit status survives the cleanup commands.
    `trap '${["rc=$?", `rm -f ${RESTIC_PASSWORD_FILE}`, ...onExit, "exit $rc"].join("; ")}' EXIT`,
  ];
}

/** `restore --delete` with `--include` only behaves as documented from this restic version. */
export const RESTIC_MIN_VERSION = "0.17";

/** Fails with a clear message before anything is touched when the host's restic is too old. */
export function resticVersionCheck(): string[] {
  return [
    `restic_ver=$(restic version 2>/dev/null | sed -n 's/^restic \\([0-9]*\\.[0-9]*\\).*/\\1/p' || true)`,
    `if [ "$(printf '%s\\n${RESTIC_MIN_VERSION}\\n' "$restic_ver" | sort -V | head -n 1)" != "${RESTIC_MIN_VERSION}" ]; then`,
    `  echo "restic >= ${RESTIC_MIN_VERSION} is required to restore (found: \${restic_ver:-unknown})" >&2`,
    "  exit 1",
    "fi",
  ];
}

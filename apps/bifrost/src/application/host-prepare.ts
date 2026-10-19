import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import {
  prepareSteps,
  SSHD_DROPIN,
  SSHD_DROPIN_CONTENT,
  SSHD_HARDENED_PROBE,
  type HostStep,
} from "../domain/host-steps.ts";
import type { RemoteHost } from "./ports/remote-host.ts";

export interface HostPrepareDeps {
  remote: RemoteHost;
  log: (line: string) => void;
}

export interface HostPrepareOptions {
  dryRun: boolean;
  withDisk: boolean;
}

/** Brings a fresh Ubuntu host to the state Jellyfin needs. Every step probes first and skips if done. */
export async function hostPrepare(
  deps: HostPrepareDeps,
  cfg: Config,
  opts: HostPrepareOptions,
): Promise<void> {
  const { remote, log } = deps;

  // Fail early on config problems (e.g. --with-disk without mediaDisk) before touching anything.
  const steps = prepareSteps(cfg, { withDisk: opts.withDisk });

  const sudoCheck = await remote.exec("sudo -n true", { readOnly: true });
  if (sudoCheck.code !== 0) {
    throw new BifrostError(
      `${cfg.host.sshUser} cannot run sudo without a password on ${cfg.host.name}. Bifrost needs passwordless sudo (sudo -n).`,
    );
  }

  if (cfg.host.mediaDisk && !opts.withDisk) {
    log(`skip   media disk (host.mediaDisk is set; pass --with-disk once it is connected)`);
  }

  for (const step of steps) await runStep(remote, log, step, opts.dryRun);
  await hardenSshd(remote, log, cfg, opts.dryRun);
  log("Host is prepared.");
}

async function runStep(
  remote: RemoteHost,
  log: (l: string) => void,
  step: HostStep,
  dryRun: boolean,
) {
  const probe = await remote.exec(step.probe, { sudo: true, readOnly: true });
  if (probe.code === 0) {
    log(`ok     ${step.title}`);
    return;
  }
  if (dryRun) {
    log(`would  ${step.title}`);
    return;
  }
  log(`run    ${step.title}`);
  for (const f of step.files ?? [])
    await remote.writeFile(f.path, f.content, { sudo: true, mode: f.mode });
  if (step.script) {
    const res = await remote.exec(step.script, { sudo: true });
    if (res.code !== 0)
      throw new BifrostError(`Step "${step.id}" failed (exit ${res.code}):\n${res.stderr.trim()}`);
  }
}

/**
 * Password logins off, without ever locking ourselves out: key login is proven first, the new
 * config is validated with `sshd -t` before it is loaded, and after the reload a brand-new
 * connection must still get in, or the change is undone from the session that is still open.
 */
async function hardenSshd(
  remote: RemoteHost,
  log: (l: string) => void,
  cfg: Config,
  dryRun: boolean,
) {
  const hardened = await remote.exec(SSHD_HARDENED_PROBE, { sudo: true, readOnly: true });
  if (hardened.code === 0) {
    log("ok     sshd: password logins already disabled");
    return;
  }
  if (dryRun) {
    log(
      `would  sshd: disable password logins (${SSHD_DROPIN}, sshd -t, reload, verify with a new connection)`,
    );
    return;
  }
  if (!(await remote.verifyKeyLogin())) {
    throw new BifrostError(
      `Key login to ${cfg.host.sshUser}@${cfg.host.address} does not work without a password: refusing to disable password logins.`,
    );
  }
  log("run    sshd: disable password logins");
  await remote.writeFile(SSHD_DROPIN, SSHD_DROPIN_CONTENT, { sudo: true, mode: "0644" });

  const revert = async () => {
    await remote.exec(`rm -f ${SSHD_DROPIN}`, { sudo: true });
  };
  const check = await remote.exec("sshd -t", { sudo: true });
  if (check.code !== 0) {
    await revert();
    throw new BifrostError(
      `\`sshd -t\` rejected the new config; it was removed again:\n${check.stderr.trim()}`,
    );
  }
  await remote.exec("systemctl reload ssh", { sudo: true });

  const fresh = await remote.verifyKeyLogin();
  const effective =
    (await remote.exec(SSHD_HARDENED_PROBE, { sudo: true, readOnly: true })).code === 0;
  if (!fresh || !effective) {
    await revert();
    await remote.exec("systemctl reload ssh", { sudo: true });
    throw new BifrostError(
      `After reloading sshd ${fresh ? "the setting did not take effect" : "a new key login failed"}: the change was reverted.`,
    );
  }
  log("ok     sshd: verified with a new connection");
}

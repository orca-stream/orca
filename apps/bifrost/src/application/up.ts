import type { Config } from "../domain/config.ts";
import { COMPOSE_FILE, mediaRoot, renderCompose } from "../domain/compose.ts";
import { BifrostError } from "../domain/errors.ts";
import { DryRunRemoteHost } from "./dry-run-remote-host.ts";
import type { Clock } from "./ports/clock.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import { waitHealthy } from "./docker.ts";

export interface UpDeps {
  remote: RemoteHost;
  clock: Clock;
  log: (line: string) => void;
}

const VAINFO =
  "docker exec jellyfin /usr/lib/jellyfin-ffmpeg/vainfo --display drm --device /dev/dri/renderD128";

async function readNumber(remote: RemoteHost, script: string): Promise<number | undefined> {
  const res = await remote.exec(script, { readOnly: true });
  const n = Number.parseInt(res.stdout.trim(), 10);
  return res.code === 0 && Number.isFinite(n) ? n : undefined;
}

/** Generates the compose file from the config, starts Jellyfin, waits until healthy and checks VA-API. */
export async function up(deps: UpDeps, cfg: Config, opts: { dryRun: boolean }): Promise<void> {
  const { clock, log } = deps;
  const remote = opts.dryRun ? new DryRunRemoteHost(deps.remote, log) : deps.remote;
  const { host } = cfg;
  const composePath = `${host.dataDir}/${COMPOSE_FILE}`;

  let uid = await readNumber(remote, "id -u jellyfin");
  let gid = await readNumber(remote, "id -g jellyfin");
  if (uid === undefined || gid === undefined) {
    if (!opts.dryRun) {
      throw new BifrostError(
        "The jellyfin user does not exist on the host: run `bifrost host prepare` first.",
      );
    }
    log("note: the jellyfin user does not exist yet; showing placeholder ids.");
    uid = gid = 999;
  }
  let renderGid = await readNumber(remote, "getent group render | cut -d: -f3");
  if (renderGid === undefined) {
    renderGid = host.renderGid;
    if (renderGid === undefined)
      throw new BifrostError("Could not read the GID of the `render` group on the host.");
    log(`warning: no render group on the host, using host.renderGid ${renderGid} from the config.`);
  } else if (host.renderGid !== undefined && host.renderGid !== renderGid) {
    log(
      `warning: the host's render group is ${renderGid}, not ${host.renderGid} as in the config; using ${renderGid}.`,
    );
  }

  const compose = renderCompose(cfg, { uid, gid, renderGid });
  if (opts.dryRun) log(`compose file ${composePath}:\n${compose}`);

  await remote.exec(
    [
      `install -d -o jellyfin -g jellyfin -m 0750 ${host.dataDir}/config ${host.dataDir}/cache`,
      `mkdir -p ${mediaRoot(host)}`,
      "",
    ].join("\n"),
    { sudo: true },
  );

  const existing = await remote.exec(`cat ${composePath}`, { readOnly: true });
  if (existing.code === 0 && existing.stdout === compose) {
    log(`ok     ${composePath} is up to date`);
  } else {
    await remote.writeFile(composePath, compose, { sudo: true, mode: "0644" });
    log(`wrote  ${composePath}`);
  }

  const started = await remote.exec(`docker compose -f ${composePath} up -d --remove-orphans`, {
    sudo: true,
  });
  if (started.code !== 0)
    throw new BifrostError(`docker compose up failed:\n${started.stderr.trim()}`);
  if (opts.dryRun) return;

  log("Waiting for the container to become healthy...");
  await waitHealthy(remote, clock);

  const vainfo = await remote.exec(VAINFO, { sudo: true, readOnly: true });
  if (vainfo.code !== 0) {
    throw new BifrostError(
      `VA-API check failed inside the container (hardware transcoding will not work):\n${(vainfo.stderr || vainfo.stdout).trim()}`,
    );
  }
  log("VA-API works inside the container:");
  log(vainfo.stdout.trim().split("\n").slice(0, 3).join("\n"));
}

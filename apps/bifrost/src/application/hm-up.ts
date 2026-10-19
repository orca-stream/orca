import type { Config } from "../domain/config.ts";
import { COMPOSE_FILE, renderCompose } from "../domain/compose.ts";
import { BifrostError } from "../domain/errors.ts";
import {
  HM_API_KEY_APP,
  HM_DATA_SUBDIR,
  HM_DOCKERFILE,
  HM_ENV_FILE,
  HM_IMAGE_MARKER,
  HM_SERVICE,
  HM_SRC_SUBDIR,
  HM_USER,
  type HmRuntime,
  hmEnvFile,
  hmImageTag,
  hmMediaPath,
} from "../domain/hm.ts";
import { shQuote } from "../domain/shell.ts";
import { DryRunRemoteHost } from "./dry-run-remote-host.ts";
import { readNumber, waitHealthy } from "./docker.ts";
import type { Clock } from "./ports/clock.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import type { SecretStore } from "./ports/secret-store.ts";
import type { SourceArchive } from "./ports/source-archive.ts";

export interface HmUpDeps {
  remote: RemoteHost;
  clock: Clock;
  secrets: SecretStore;
  source: SourceArchive;
  /** Not signed in; the use case logs in as the admin to create the API key. */
  jellyfin: JellyfinAdmin;
  log: (line: string) => void;
}

const markerPath = (cfg: Config) => `${cfg.hm!.dataDir}/${HM_IMAGE_MARKER}`;

/** The H&M container as deployed (image tag from the marker file, user from the host), if any. */
export async function readDeployedHm(
  remote: RemoteHost,
  cfg: Config,
  jellyfinGid: number,
): Promise<HmRuntime | undefined> {
  const marker = await remote.exec(`cat ${markerPath(cfg)}`, { readOnly: true });
  const image = marker.stdout.trim();
  if (marker.code !== 0 || !image) return undefined;
  const uid = await readNumber(remote, `id -u ${HM_USER}`);
  return uid === undefined ? undefined : { uid, gid: jellyfinGid, image };
}

/** Writes only when the content differs. Returns whether it wrote. */
async function writeIfChanged(
  remote: RemoteHost,
  path: string,
  content: string,
  mode: string,
  opts: { dryRun: boolean; log: (l: string) => void },
): Promise<boolean> {
  const existing = await remote.exec(`cat ${shQuote(path)}`, { readOnly: true, sudo: true });
  if (existing.code === 0 && existing.stdout === content) {
    opts.log(`ok     ${path} is up to date`);
    return false;
  }
  await remote.writeFile(path, content, { sudo: true, mode });
  if (!opts.dryRun) opts.log(`wrote  ${path}`);
  return true;
}

/** Makes sure the "Orca H&M" Jellyfin API key exists and is stored; returns its token. */
async function ensureApiKey(deps: HmUpDeps, cfg: Config): Promise<string> {
  const { jellyfin: jf, secrets, log } = deps;
  const jelly = cfg.jellyfin;
  const password = await secrets.get(jelly.admin.passwordSecret);
  if (!password) {
    throw new BifrostError(
      `The admin password is not set: put ${jelly.admin.passwordSecret}=<password> in the .env file.`,
    );
  }
  await jf.login(jelly.admin.username, password);
  let keys = await jf.listApiKeys();
  if (!keys.some((k) => k.AppName === HM_API_KEY_APP)) {
    await jf.createApiKey(HM_API_KEY_APP);
    keys = await jf.listApiKeys();
    log(`Created the "${HM_API_KEY_APP}" API key.`);
  }
  const key = keys.find((k) => k.AppName === HM_API_KEY_APP);
  if (!key)
    throw new BifrostError(`The "${HM_API_KEY_APP}" API key was not found after creating it.`);
  if ((await secrets.get(cfg.hm!.apiKeySecret)) !== key.AccessToken) {
    await secrets.set(cfg.hm!.apiKeySecret, key.AccessToken);
    log(`Stored the API key as ${cfg.hm!.apiKeySecret}.`);
  }
  return key.AccessToken;
}

/**
 * Builds Orca'H&M on the host from this repository, then adds it to the compose file next to Jellyfin
 * and starts it. Every step is skipped when it is already done.
 */
export async function hmUp(deps: HmUpDeps, cfg: Config, opts: { dryRun: boolean }): Promise<void> {
  const hm = cfg.hm;
  if (!hm) throw new BifrostError("The config has no `hm` section.");
  const { clock, log, secrets, source } = deps;
  const remote = opts.dryRun ? new DryRunRemoteHost(deps.remote, log) : deps.remote;
  const { host } = cfg;
  const composePath = `${host.dataDir}/${COMPOSE_FILE}`;
  const mediaPath = hmMediaPath(cfg, hm);

  const jellyfinUid = await readNumber(remote, "id -u jellyfin");
  const jellyfinGid = await readNumber(remote, "id -g jellyfin");
  const renderGid =
    (await readNumber(remote, "getent group render | cut -d: -f3")) ?? host.renderGid;
  if (jellyfinUid === undefined || jellyfinGid === undefined || renderGid === undefined) {
    if (!opts.dryRun) {
      throw new BifrostError(
        "The jellyfin user or the render group is missing on the host: run `bifrost host prepare` and `bifrost up` first.",
      );
    }
    log("note: the host is not prepared yet; showing placeholder ids.");
  }

  if (host.mediaDisk && hm.mediaDir.startsWith(`${host.mediaDisk.mount}/`)) {
    const mounted = await remote.exec(`mountpoint -q ${host.mediaDisk.mount}`, { readOnly: true });
    if (mounted.code !== 0) {
      const msg = `The media disk is not mounted at ${host.mediaDisk.mount}: H&M would write to the root disk.`;
      if (!opts.dryRun) throw new BifrostError(msg);
      log(`warning: ${msg}`);
    }
  }

  const commit = await source.resolve(hm.source);
  const image = hmImageTag(commit);
  const short = image.slice(image.indexOf(":") + 1);
  log(`Orca'H&M ${hm.source} -> ${commit.slice(0, 12)}, image ${image}`);

  // 1. The image, built on the host (there is no registry).
  const built = await remote.exec(`docker image inspect ${image}`, { sudo: true, readOnly: true });
  if (built.code === 0) {
    log(`ok     image ${image} exists`);
  } else if (opts.dryRun) {
    log(`would pack ${commit.slice(0, 12)}, copy it to the host and build ${image}`);
  } else {
    const dir = `${hm.dataDir}/${HM_SRC_SUBDIR}/${short}`;
    const tar = `${dir}.tar`;
    await remote.exec(`install -d -m 0755 ${hm.dataDir} ${hm.dataDir}/${HM_SRC_SUBDIR}\n`, {
      sudo: true,
    });
    const tarball = await source.archive(commit);
    try {
      log(`Copying the sources to the host...`);
      await remote.copyTo(tarball.path, tar, { sudo: true });
    } finally {
      await tarball.dispose();
    }
    log(`Building ${image} (this takes a few minutes)...`);
    const res = await remote.exec(
      [
        "set -e",
        `trap 'rm -rf ${dir} ${tar}' EXIT`,
        `rm -rf ${dir}`,
        `mkdir -p ${dir}`,
        `tar -xf ${tar} -C ${dir}`,
        `docker build -f ${dir}/${HM_DOCKERFILE} -t ${image} ${dir}`,
        "",
      ].join("\n"),
      { sudo: true },
    );
    if (res.code !== 0) throw new BifrostError(`docker build failed:\n${res.stderr.trim()}`);
  }

  // 2. The user the container runs as, and the directories it writes to.
  await remote.exec(
    [
      `id -u ${HM_USER} >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --gid jellyfin ${HM_USER}`,
      `install -d -m 0755 ${hm.dataDir}`,
      `install -d -o ${HM_USER} -g jellyfin -m 0750 ${hm.dataDir}/${HM_DATA_SUBDIR}`,
      // setgid keeps new series folders in the jellyfin group; group-writable so both can manage them.
      `install -d -o ${HM_USER} -g jellyfin -m 2775 ${hm.mediaDir}`,
      "",
    ].join("\n"),
    { sudo: true },
  );
  const hmUid = (await readNumber(remote, `id -u ${HM_USER}`)) ?? (opts.dryRun ? 999 : undefined);
  if (hmUid === undefined) throw new BifrostError(`The ${HM_USER} user was not created.`);

  // 3. Secrets: the API key and the contact e-mail go only into the root-only env file.
  let contactEmail: string | undefined;
  if (hm.contactEmailSecret) {
    contactEmail = await secrets.get(hm.contactEmailSecret);
    if (!contactEmail && !opts.dryRun)
      throw new BifrostError(`${hm.contactEmailSecret} is not set in the .env file.`);
  }
  let apiKey: string;
  if (opts.dryRun) {
    log(`Would make sure an API key named "${HM_API_KEY_APP}" exists (secret ${hm.apiKeySecret}).`);
    apiKey = (await secrets.get(hm.apiKeySecret)) ?? "dry-run-placeholder";
  } else {
    apiKey = await ensureApiKey(deps, cfg);
  }
  const envPath = `${hm.dataDir}/${HM_ENV_FILE}`;
  const wroteEnv = await writeIfChanged(
    remote,
    envPath,
    hmEnvFile(cfg, { apiKey, contactEmail }),
    "0600",
    { dryRun: opts.dryRun, log },
  );

  // 4. The compose file, now with the hm service.
  await writeIfChanged(remote, markerPath(cfg), `${image}\n`, "0644", { dryRun: opts.dryRun, log });
  const compose = renderCompose(
    cfg,
    { uid: jellyfinUid ?? 999, gid: jellyfinGid ?? 999, renderGid: renderGid ?? 0 },
    { uid: hmUid, gid: jellyfinGid ?? 999, image },
  );
  if (opts.dryRun) log(`compose file ${composePath}:\n${compose}`);
  await writeIfChanged(remote, composePath, compose, "0644", {
    dryRun: opts.dryRun,
    log,
  });

  // 5. Start it. Compose does not notice a changed env file, so a rewrite forces the recreate.
  const started = await remote.exec(
    `docker compose -f ${composePath} up -d${wroteEnv ? " --force-recreate" : ""} --no-deps ${HM_SERVICE}`,
    { sudo: true },
  );
  if (started.code !== 0)
    throw new BifrostError(`docker compose up failed:\n${started.stderr.trim()}`);
  if (opts.dryRun) return;
  log(`Waiting for ${HM_SERVICE} to become healthy...`);
  await waitHealthy(remote, clock, HM_SERVICE);
  log(`Orca'H&M is up: http://${host.address}:${hm.port} (library ${mediaPath})`);
}

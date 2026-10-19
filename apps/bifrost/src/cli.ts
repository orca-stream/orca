import { realpathSync } from "node:fs";
import { access, constants, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { apply } from "./application/apply.ts";
import { backup } from "./application/backup.ts";
import { dump } from "./application/dump.ts";
import { hmUp } from "./application/hm-up.ts";
import { hostPrepare } from "./application/host-prepare.ts";
import { init } from "./application/init.ts";
import { migrate } from "./application/migrate.ts";
import type { Clock } from "./application/ports/clock.ts";
import type { JellyfinAdmin } from "./application/ports/jellyfin-admin.ts";
import type { RemoteHost } from "./application/ports/remote-host.ts";
import type { SourceArchive } from "./application/ports/source-archive.ts";
import type { SecretStore } from "./application/ports/secret-store.ts";
import { RESTORE_ONLY, restore, type RestoreOnly } from "./application/restore.ts";
import { up } from "./application/up.ts";
import type { Config } from "./domain/config.ts";
import { BifrostError } from "./domain/errors.ts";
import { GitSourceArchive } from "./infrastructure/git-source-archive.ts";
import { EnvFileSecretStore } from "./infrastructure/env-file-secret-store.ts";
import { SdkJellyfinAdmin } from "./infrastructure/sdk-jellyfin-admin.ts";
import { SshRemoteHost } from "./infrastructure/ssh-remote-host.ts";
import { SystemClock } from "./infrastructure/system-clock.ts";
import { dumpYaml, loadConfig } from "./infrastructure/yaml-config.ts";

/** Everything the CLI touches outside itself, so tests can swap the world for fakes. */
export interface Runtime {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  loadConfig(path: string): Promise<Config>;
  writeFile(path: string, content: string): Promise<void>;
  secrets(envFile: string): SecretStore;
  remote(cfg: Config): RemoteHost;
  jellyfin(url: string, token?: string): JellyfinAdmin;
  clock(): Clock;
  /** The checkout H&M images are built from. */
  source(): SourceArchive;
  /** Whether a file can be read on this machine. */
  canRead(path: string): Promise<boolean>;
}

export const USAGE = `Usage: bifrost [options] <command>

Provision a Jellyfin server from a YAML config.

Commands:
  host prepare <host>   Docker, firewall, SSH hardening, restic on the host (idempotent)
  up <host>             Generate the compose file, start Jellyfin, check VA-API
  hm up <host>          Build Orca'H&M on the host from this repo and run it next to Jellyfin (needs the hm section)
  init                  Run the setup wizard if needed and create the "Bifrost" API key
  dump                  Print the live server as a config (-o FILE to write it)
  apply                 Make the server match the config (repositories, plugins, libraries, settings)
  backup                Jellyfin database backup, then a restic snapshot
  restore               Restore Jellyfin's config and Orca'H&M's data from a restic snapshot (needs --yes; --only narrows it)
  migrate               Move users and watch state from another Jellyfin (its built-in backup)

Options:
  -c, --config FILE     Config file (default: bifrost.yaml)
      --env-file FILE   Secrets file (default: .env next to the config)
      --dry-run         Show what would change; change nothing
      --with-disk       host prepare: also mount host.mediaDisk (once it is connected)
  -o, --output FILE     dump: write to FILE instead of stdout
      --from WHERE      dump: "target" (default, paths untouched) or "source" (migrate.source, paths mapped through pathMap)
      --snapshot ID     restore: restic snapshot (default: latest)
      --only WHAT       restore: all (default), jellyfin or hm; hm leaves Jellyfin running
      --yes             restore: confirm the overwrite
      --backup-file F   migrate: use this zip instead of the path the source reports
  -h, --help            This text
`;

const options = {
  config: { type: "string", short: "c" },
  "env-file": { type: "string" },
  "dry-run": { type: "boolean" },
  "with-disk": { type: "boolean" },
  output: { type: "string", short: "o" },
  from: { type: "string" },
  snapshot: { type: "string" },
  only: { type: "string" },
  yes: { type: "boolean" },
  "backup-file": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

class UsageError extends Error {
  override name = "UsageError";
}

/** Runs the CLI and returns the exit code: 0 ok, 1 failed, 2 wrong usage. */
export async function run(argv: string[], rt: Runtime): Promise<number> {
  try {
    return await dispatch(argv, rt);
  } catch (e) {
    if (e instanceof UsageError) {
      rt.err(`error: ${e.message}\nRun with --help for usage.`);
      return 2;
    }
    if (e instanceof BifrostError) {
      rt.err(`error: ${e.message}`);
      return 1;
    }
    const code = (e as { code?: string }).code;
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
      rt.err(`error: ${(e as Error).message}\nRun with --help for usage.`);
      return 2;
    }
    rt.err(`error: ${(e as Error).stack ?? String(e)}`);
    return 1;
  }
}

async function dispatch(argv: string[], rt: Runtime): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    rt.out(USAGE);
    return 0;
  }
  if (positionals.length === 0) {
    rt.out(USAGE);
    return 2;
  }

  const [command, ...rest] = positionals;
  const dryRun = values["dry-run"] ?? false;
  const wantsHost = (name: string | undefined, cfg: Config) => {
    if (!name)
      throw new UsageError(
        `${command} needs the host name (the config describes "${cfg.host.name}")`,
      );
    if (name !== cfg.host.name) {
      throw new BifrostError(`The config describes the host "${cfg.host.name}", not "${name}".`);
    }
  };

  const known = ["host", "hm", "up", "init", "dump", "apply", "backup", "restore", "migrate"];
  if (!known.includes(command!)) throw new UsageError(`unknown command "${command}"`);
  const subcommands: Record<string, string> = { host: "prepare", hm: "up" };
  if (command! in subcommands && rest[0] !== subcommands[command!])
    throw new UsageError(`unknown command "${positionals.join(" ")}"`);
  if (command! in subcommands && !rest[1])
    throw new UsageError(`${command} ${rest[0]} needs the host name`);

  const only = values.only ?? "all";
  if (command === "restore" && !RESTORE_ONLY.includes(only as RestoreOnly))
    throw new UsageError(`--only must be one of ${RESTORE_ONLY.join(", ")}, not "${only}"`);

  const configPath = resolve(rt.cwd, values.config ?? "bifrost.yaml");
  const cfg = await rt.loadConfig(configPath);
  const secrets = rt.secrets(
    resolve(rt.cwd, values["env-file"] ?? resolve(dirname(configPath), ".env")),
  );
  const log = (line: string) => rt.out(line);
  const clock = rt.clock();

  const authenticated = async (url: string, secretKey: string): Promise<JellyfinAdmin> => {
    const token = await secrets.get(secretKey);
    if (!token) {
      throw new BifrostError(
        `No API key (${secretKey}) in the secrets file: run \`bifrost init\` first.`,
      );
    }
    return rt.jellyfin(url, token);
  };

  switch (command) {
    case "host":
      wantsHost(rest[1], cfg);
      await hostPrepare({ remote: rt.remote(cfg), log }, cfg, {
        dryRun,
        withDisk: values["with-disk"] ?? false,
      });
      return 0;
    case "up":
      wantsHost(rest[0], cfg);
      await up({ remote: rt.remote(cfg), clock, log }, cfg, { dryRun });
      return 0;
    case "hm":
      wantsHost(rest[1], cfg);
      if (!cfg.hm)
        throw new BifrostError("The config has no `hm` section (see bifrost.example.yaml).");
      await hmUp(
        {
          remote: rt.remote(cfg),
          clock,
          secrets,
          source: rt.source(),
          jellyfin: rt.jellyfin(cfg.jellyfin.url),
          log,
        },
        cfg,
        { dryRun },
      );
      return 0;
    case "init":
      await init({ jellyfin: rt.jellyfin(cfg.jellyfin.url), secrets, log }, cfg, { dryRun });
      return 0;
    case "dump": {
      const from = values.from ?? "target";
      if (from !== "target" && from !== "source")
        throw new UsageError(`--from must be "target" or "source", not "${from}"`);
      if (from === "source" && !cfg.migrate) {
        throw new BifrostError(
          "dump --from source needs the `migrate.source` section (url and apiKeySecret of the old server).",
        );
      }
      const jellyfin =
        from === "source"
          ? await authenticated(cfg.migrate!.source.url, cfg.migrate!.source.apiKeySecret)
          : await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      // The YAML goes to stdout, so progress and warnings go to stderr. Paths are mapped only when
      // dumping the old server: the target already uses this server's paths.
      const { document } = await dump({ jellyfin, log: (line) => rt.err(line) }, cfg, {
        mapPaths: from === "source",
      });
      const yaml = dumpYaml(document);
      if (values.output) await rt.writeFile(resolve(rt.cwd, values.output), yaml);
      else rt.out(yaml.trimEnd());
      return 0;
    }
    case "apply": {
      const jellyfin = await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      await apply({ jellyfin, clock, log }, cfg, { dryRun });
      return 0;
    }
    case "backup": {
      const jellyfin = await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      await backup({ remote: rt.remote(cfg), secrets, jellyfin, log }, cfg, { dryRun });
      return 0;
    }
    case "restore": {
      await restore({ remote: rt.remote(cfg), secrets, clock, log }, cfg, {
        dryRun,
        yes: values.yes ?? false,
        snapshot: values.snapshot ?? "latest",
        only: only as RestoreOnly,
      });
      return 0;
    }
    case "migrate": {
      if (!cfg.migrate) {
        throw new BifrostError(
          "The config has no `migrate.source` section (url and apiKeySecret of the old server).",
        );
      }
      const source = await authenticated(cfg.migrate.source.url, cfg.migrate.source.apiKeySecret);
      const target = await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      const targetAsSource = await authenticated(cfg.jellyfin.url, cfg.migrate.source.apiKeySecret);
      const deps = {
        source,
        target,
        targetAsSource,
        remote: rt.remote(cfg),
        secrets,
        clock,
        canRead: (path: string) => rt.canRead(path),
        log,
      };
      await migrate(deps, cfg, {
        dryRun,
        ...(values["backup-file"] ? { backupFile: values["backup-file"] } : {}),
      });
      return 0;
    }
  }
  throw new UsageError(`unknown command "${command}"`);
}

function systemRuntime(): Runtime {
  return {
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    loadConfig,
    writeFile: (path, content) => writeFile(path, content, "utf8"),
    secrets: (path) => new EnvFileSecretStore(path),
    remote: (cfg) => new SshRemoteHost({ target: `${cfg.host.sshUser}@${cfg.host.address}` }),
    jellyfin: (url, token) => new SdkJellyfinAdmin({ url, token }),
    clock: () => new SystemClock(),
    source: () => new GitSourceArchive(),
    canRead: (path) =>
      access(path, constants.R_OK).then(
        () => true,
        () => false,
      ),
  };
}

/** True when `moduleUrl` is the script node was started with (symlinks resolved). Works on every Node 24. */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2), systemRuntime());
}

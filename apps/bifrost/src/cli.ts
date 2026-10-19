import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { apply } from "./application/apply.ts";
import { backup } from "./application/backup.ts";
import { dump } from "./application/dump.ts";
import { hostPrepare } from "./application/host-prepare.ts";
import { init } from "./application/init.ts";
import { migrate } from "./application/migrate.ts";
import type { Clock } from "./application/ports/clock.ts";
import type { JellyfinAdmin } from "./application/ports/jellyfin-admin.ts";
import type { RemoteHost } from "./application/ports/remote-host.ts";
import type { SecretStore } from "./application/ports/secret-store.ts";
import { restore } from "./application/restore.ts";
import { up } from "./application/up.ts";
import type { Config } from "./domain/config.ts";
import { BifrostError } from "./domain/errors.ts";
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
}

export const USAGE = `Usage: bifrost [options] <command>

Provision a Jellyfin server from a YAML config.

Commands:
  host prepare <host>   Docker, firewall, SSH hardening, restic on the host (idempotent)
  up <host>             Generate the compose file, start Jellyfin, check VA-API
  init                  Run the setup wizard if needed and create the "Bifrost" API key
  dump                  Print the live server as a config (-o FILE to write it)
  apply                 Make the server match the config (repositories, plugins, libraries, settings)
  backup                Jellyfin database backup, then a restic snapshot
  restore               Restore the config directory from a restic snapshot (needs --yes)
  migrate               Move users and watch state from another Jellyfin (its built-in backup)

Options:
  -c, --config FILE     Config file (default: bifrost.yaml)
      --env-file FILE   Secrets file (default: .env next to the config)
      --dry-run         Show what would change; change nothing
      --with-disk       host prepare: also mount host.mediaDisk (once it is connected)
  -o, --output FILE     dump: write to FILE instead of stdout
      --reverse         dump: apply pathMap target -> source instead of source -> target
      --snapshot ID     restore: restic snapshot (default: latest)
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
  reverse: { type: "boolean" },
  snapshot: { type: "string" },
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

  const known = ["host", "up", "init", "dump", "apply", "backup", "restore", "migrate"];
  if (!known.includes(command!)) throw new UsageError(`unknown command "${command}"`);
  if (command === "host" && rest[0] !== "prepare")
    throw new UsageError(`unknown command "${positionals.join(" ")}"`);
  if (command === "host" && !rest[1]) throw new UsageError("host prepare needs the host name");

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
    case "init":
      await init({ jellyfin: rt.jellyfin(cfg.jellyfin.url), secrets, log }, cfg, { dryRun });
      return 0;
    case "dump": {
      const jellyfin = await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      // The YAML goes to stdout, so progress and warnings go to stderr.
      const { document } = await dump({ jellyfin, log: (line) => rt.err(line) }, cfg, {
        reverse: values.reverse ?? false,
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
    case "restore":
      await restore({ remote: rt.remote(cfg), secrets, clock, log }, cfg, {
        dryRun,
        yes: values.yes ?? false,
        snapshot: values.snapshot ?? "latest",
      });
      return 0;
    case "migrate": {
      if (!cfg.migrate) {
        throw new BifrostError(
          "The config has no `migrate.source` section (url and apiKeySecret of the old server).",
        );
      }
      const source = await authenticated(cfg.migrate.source.url, cfg.migrate.source.apiKeySecret);
      const target = await authenticated(cfg.jellyfin.url, cfg.jellyfin.apiKeySecret);
      await migrate({ source, target, remote: rt.remote(cfg), clock, log }, cfg, {
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
  };
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), systemRuntime());
}

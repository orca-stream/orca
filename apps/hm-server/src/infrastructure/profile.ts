import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./config.ts";

/** Folder, under the app root, that holds one `<name>.env` per target. */
export const PROFILES_DIR = "profiles";
const SUFFIX = ".env";
/** Versioned next to the real profiles, with every value commented out as a suggestion. */
const EXAMPLE = ".env.example";
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface ProfileFs {
  exists(path: string): boolean;
  list(dir: string): string[];
  /** Adds the file's variables to the environment, never replacing one already set. */
  load(path: string): void;
}

const nodeFs: ProfileFs = {
  exists: existsSync,
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  load: (path) => process.loadEnvFile(path),
};

/** The profiles a person can pick: every `<name>.env` in the folder. */
export function listProfiles(appRoot: string, fs: ProfileFs = nodeFs): string[] {
  return fs
    .list(join(appRoot, PROFILES_DIR))
    .filter((file) => file.endsWith(SUFFIX))
    .map((file) => file.slice(0, -SUFFIX.length))
    .filter((name) => NAME.test(name))
    .sort();
}

/**
 * Loads `profiles/$HM_PROFILE.env` when HM_PROFILE is set, and returns its name. Without it the
 * environment is used as it is, which is how a container gets its values. Variables already in the
 * environment win over the file, so one can be overridden for a single run.
 */
export function loadProfile(
  env: Record<string, string | undefined>,
  appRoot: string,
  fs: ProfileFs = nodeFs,
): string | null {
  const name = env["HM_PROFILE"];
  if (name === undefined || name === "") return null;
  const available = () => {
    const names = listProfiles(appRoot, fs);
    return names.length > 0
      ? `Profiles here: ${names.join(", ")}.`
      : `There are none yet: copy ${PROFILES_DIR}/${EXAMPLE} to ${PROFILES_DIR}/<name>${SUFFIX} and fill it in.`;
  };
  if (!NAME.test(name)) {
    throw new ConfigError(
      `HM_PROFILE "${name}" is not a profile name (letters, digits, - and _). ${available()}`,
    );
  }
  const file = join(appRoot, PROFILES_DIR, `${name}${SUFFIX}`);
  if (!fs.exists(file)) {
    throw new ConfigError(`HM_PROFILE "${name}": ${file} does not exist. ${available()}`);
  }
  fs.load(file);
  return name;
}

/** What `pnpm setup:hm` asks for: the only things the server needs before its panel takes over. */
export interface ProfileValues {
  dbFile: string;
  host: string;
  port: number;
}

/** Whether a name can be a profile's (it becomes `profiles/<name>.env`). */
export function isProfileName(name: string): boolean {
  return NAME.test(name);
}

/** Where a profile's file goes. */
export function profilePath(appRoot: string, name: string): string {
  return join(appRoot, PROFILES_DIR, `${name}${SUFFIX}`);
}

/** The text of a profile's file, laid out as `profiles/.env.example` is. */
export function profileText(name: string, values: ProfileValues): string {
  return [
    `# Orca'H&M profile "${name}", written by \`pnpm setup:hm\`. Everything else is set from the panel.`,
    "",
    "# --- required",
    `DB_FILE=${values.dbFile}`,
    `HOST=${values.host}`,
    `PORT=${values.port}`,
    "",
  ].join("\n");
}

/**
 * The panel's development server proxies `/api` to HM_SERVER_URL in `apps/hm-web/.env`: the same
 * file with that line set to `url`, every other line kept.
 */
export function withServerUrl(webEnv: string | null, url: string): string {
  const line = `HM_SERVER_URL=${url}`;
  if (webEnv === null || webEnv.trim() === "") {
    return `# Orca'H&M panel, development only: where hm-server listens (written by \`pnpm setup:hm\`).\n${line}\n`;
  }
  const lines = webEnv.split("\n");
  const at = lines.findIndex((text) => /^\s*HM_SERVER_URL\s*=/.test(text));
  if (at === -1) return `${webEnv.replace(/\n*$/, "\n")}${line}\n`;
  lines[at] = line;
  return lines.join("\n");
}

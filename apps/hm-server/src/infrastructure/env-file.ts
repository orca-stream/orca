import { existsSync } from "node:fs";
import { join } from "node:path";

/** The server's one env file, under the app root; only `.env.example` next to it is versioned. */
export const ENV_FILE = ".env";

export interface EnvFileFs {
  exists(path: string): boolean;
  /** Adds the file's variables to the environment, never replacing one already set. */
  load(path: string): void;
}

const nodeFs: EnvFileFs = {
  exists: existsSync,
  load: (path) => process.loadEnvFile(path),
};

/** Where the env file goes. */
export function envFilePath(appRoot: string): string {
  return join(appRoot, ENV_FILE);
}

/**
 * Loads the app root's `.env` when there is one, and says whether it did. Without it the
 * environment is used as it is, which is how a container gets its values. Variables already in the
 * environment win over the file, so one can be overridden for a single run.
 */
export function loadEnvFile(appRoot: string, fs: EnvFileFs = nodeFs): boolean {
  const file = envFilePath(appRoot);
  if (!fs.exists(file)) return false;
  fs.load(file);
  return true;
}

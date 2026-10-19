import { chmod, readFile, writeFile } from "node:fs/promises";
import type { SecretStore } from "../application/ports/secret-store.ts";

function parseValue(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}

function parseLine(line: string): [string, string] | undefined {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  return m ? [m[1]!, parseValue(m[2]!)] : undefined;
}

function formatValue(value: string): string {
  return /[\s#"'\\$]/.test(value) || value === "" ? JSON.stringify(value) : value;
}

/** Secrets in a gitignored `.env` file (mode 0600); the process environment is the read-only fallback. */
export class EnvFileSecretStore implements SecretStore {
  private readonly path: string;
  private readonly env: Record<string, string | undefined>;

  constructor(path: string, env: Record<string, string | undefined> = process.env) {
    this.path = path;
    this.env = env;
  }

  private async lines(): Promise<string[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text === "" ? [] : text.replace(/\n$/, "").split("\n");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async get(key: string): Promise<string | undefined> {
    for (const line of await this.lines()) {
      const kv = parseLine(line);
      if (kv && kv[0] === key) return kv[1];
    }
    return this.env[key];
  }

  async set(key: string, value: string): Promise<void> {
    const lines = await this.lines();
    const entry = `${key}=${formatValue(value)}`;
    const at = lines.findIndex((l) => parseLine(l)?.[0] === key);
    if (at >= 0) lines[at] = entry;
    else lines.push(entry);
    await writeFile(this.path, `${lines.join("\n")}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}

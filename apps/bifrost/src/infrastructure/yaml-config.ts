import { readFile } from "node:fs/promises";
import { parse, stringify, YAMLParseError } from "yaml";
import { parseConfig, type Config } from "../domain/config.ts";
import { ConfigError } from "../domain/errors.ts";
import type { Rec } from "../domain/merge.ts";

/** Reads, parses and validates the YAML config. */
export async function loadConfig(path: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Config file not found: ${path}\nCopy apps/bifrost/bifrost.example.yaml to bifrost.yaml and edit it, or pass -c <file>.`,
      );
    }
    throw e;
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      const line = e.linePos?.[0]?.line;
      throw new ConfigError(`${path}: invalid YAML${line ? ` at line ${line}` : ""}: ${e.message}`);
    }
    throw e;
  }
  return parseConfig(raw);
}

export function dumpYaml(document: Rec | Config): string {
  return stringify(document, { lineWidth: 0 });
}

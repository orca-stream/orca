import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { parseConfig, type Config } from "../src/domain/config.ts";
import type { Snapshot } from "../src/domain/jellyfin.ts";

export function exampleRaw(): any {
  return parse(readFileSync(new URL("../bifrost.example.yaml", import.meta.url), "utf8"));
}

export function exampleConfig(patch?: (raw: any) => void): Config {
  const raw = exampleRaw();
  patch?.(raw);
  return parseConfig(raw);
}

export function emptySnapshot(): Snapshot {
  return {
    repositories: [],
    plugins: [],
    folders: [],
    system: { ServerName: "x", UICulture: "en-US", Unrelated: 1 },
    encoding: { HardwareAccelerationType: "none" },
    network: { EnableRemoteAccess: true },
    pluginConfigs: {},
  };
}

import type { Config } from "../domain/config.ts";
import { buildDump } from "../domain/dump.ts";
import type { Rec } from "../domain/merge.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";

export interface DumpDeps {
  jellyfin: JellyfinAdmin;
  log: (line: string) => void;
}

/** Reads the live server and returns it as a config document (read only). */
export async function dump(
  deps: DumpDeps,
  base: Config,
  opts: { reverse: boolean },
): Promise<{ document: Rec; warnings: string[] }> {
  const jf = deps.jellyfin;
  const [repositories, plugins, packages, folders, system, encoding, network] = await Promise.all([
    jf.getRepositories(),
    jf.getPlugins(),
    jf.getPackages(),
    jf.getFolders(),
    jf.getConfig("system"),
    jf.getConfig("encoding"),
    jf.getConfig("network"),
  ]);
  const result = buildDump(
    base,
    { repositories, plugins, packages, folders, system, encoding, network },
    opts,
  );
  for (const w of result.warnings) deps.log(`warning: ${w}`);
  return result;
}

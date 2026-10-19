import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import type { Snapshot } from "../domain/jellyfin.ts";
import type { Rec } from "../domain/merge.ts";
import { describeChange, needsRestart, planApply, type Change } from "../domain/plan.ts";
import type { Clock } from "./ports/clock.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import { waitFor } from "./wait.ts";

export interface ApplyDeps {
  jellyfin: JellyfinAdmin;
  clock: Clock;
  log: (line: string) => void;
}

export interface ApplyResult {
  changes: Change[];
  restarted: boolean;
}

const normGuid = (g: string) => g.replaceAll("-", "").toLowerCase();

/** Reads the parts of the server that the declared config can differ from. */
export async function readSnapshot(jf: JellyfinAdmin, cfg: Config["jellyfin"]): Promise<Snapshot> {
  const [repositories, plugins, folders, system, encoding, network] = await Promise.all([
    jf.getRepositories(),
    jf.getPlugins(),
    jf.getFolders(),
    jf.getConfig("system"),
    jf.getConfig("encoding"),
    jf.getConfig("network"),
  ]);
  const pluginConfigs: Record<string, Rec> = {};
  for (const wanted of cfg.plugins.filter((p) => p.config)) {
    const have = plugins.find(
      (p) =>
        (wanted.guid && normGuid(p.Id) === normGuid(wanted.guid)) ||
        p.Name.toLowerCase() === wanted.name.toLowerCase(),
    );
    if (have && have.Status !== "Restart")
      pluginConfigs[have.Id] = await jf.getPluginConfig(have.Id);
  }
  return { repositories, plugins, folders, system, encoding, network, pluginConfigs };
}

async function execute(jf: JellyfinAdmin, change: Change): Promise<void> {
  switch (change.kind) {
    case "setRepositories":
      return jf.setRepositories(change.repositories);
    case "installPlugin": {
      const { kind: _kind, ...req } = change;
      return jf.installPlugin(req);
    }
    case "uninstallPlugin":
      return jf.uninstallPlugin(change.id, change.version);
    case "setPluginEnabled":
      return jf.setPluginEnabled(change.id, change.version, change.enabled);
    case "setPluginConfig":
      return jf.setPluginConfig(change.id, change.config);
    case "addLibrary":
      return jf.addLibrary(change);
    case "removeLibrary":
      return jf.removeLibrary(change.name);
    case "addPath":
      return jf.addMediaPath(change.library, change.path);
    case "removePath":
      return jf.removeMediaPath(change.library, change.path);
    case "updateLibraryOptions":
      return jf.updateLibraryOptions(change.itemId, change.options);
    case "updateConfig":
      return jf.setConfig(change.section, change.config);
  }
}

const touchesLibraries = (c: Change) =>
  c.kind === "addLibrary" ||
  c.kind === "removeLibrary" ||
  c.kind === "addPath" ||
  c.kind === "removePath";

/**
 * Reads the server, diffs it against the config, prints the plan and (unless dry-run) executes it.
 * A plugin install or a network change restarts the server; the plan is then recomputed once, so
 * plugin toggles and settings land on plugins that only exist after the restart.
 */
export async function apply(
  deps: ApplyDeps,
  cfg: Config,
  opts: { dryRun: boolean },
): Promise<ApplyResult> {
  const { jellyfin: jf, clock, log } = deps;
  const wanted = cfg.jellyfin;
  const done: Change[] = [];
  let restarted = false;

  for (let pass = 1; pass <= 2; pass++) {
    const snap = await readSnapshot(jf, wanted);
    const plan = planApply(wanted, snap);
    const pending = snap.plugins.some((p) => p.Status === "Restart");

    if (plan.length === 0 && !pending) {
      if (pass === 1) log("0 changes: the server already matches the config.");
      break;
    }
    log(`Plan (${plan.length} change${plan.length === 1 ? "" : "s"}):`);
    for (const c of plan) log(`  - ${describeChange(c)}`);
    if (opts.dryRun) {
      if (needsRestart(plan) || pending) log("  (the server would be restarted)");
      return { changes: plan, restarted: false };
    }

    for (const c of plan) {
      await execute(jf, c);
      done.push(c);
    }
    if (plan.some(touchesLibraries)) await jf.refreshLibrary();

    if (!needsRestart(plan) && !pending) break;

    // Installs are asynchronous on the server: the plugin shows up once it has been downloaded.
    const installs = plan.filter((c) => c.kind === "installPlugin");
    if (installs.length > 0) {
      await waitFor(clock, "the plugins to finish installing", async () => {
        const have = await jf.getPlugins();
        return installs.every((i) =>
          have.some(
            (p) =>
              (i.guid && normGuid(p.Id) === normGuid(i.guid)) ||
              p.Name.toLowerCase() === i.name.toLowerCase(),
          ),
        );
      });
    }
    log("Restarting Jellyfin...");
    await jf.restart();
    restarted = true;
    await waitFor(
      clock,
      "Jellyfin to come back after the restart",
      async () => {
        await jf.publicInfo();
        return true;
      },
      { initialDelayMs: 3_000 },
    );
    await assertPluginsActive(jf, wanted);
  }
  return { changes: done, restarted };
}

async function assertPluginsActive(jf: JellyfinAdmin, cfg: Config["jellyfin"]): Promise<void> {
  const installed = await jf.getPlugins();
  const bad: string[] = [];
  for (const wanted of cfg.plugins.filter((p) => p.enabled)) {
    const have = installed.find(
      (p) =>
        (wanted.guid && normGuid(p.Id) === normGuid(wanted.guid)) ||
        p.Name.toLowerCase() === wanted.name.toLowerCase(),
    );
    if (!have) bad.push(`${wanted.name}: not installed`);
    else if (have.Status !== "Active") bad.push(`${wanted.name}: ${have.Status}`);
  }
  if (bad.length > 0) {
    throw new BifrostError(`After the restart these plugins are not Active: ${bad.join("; ")}`);
  }
}

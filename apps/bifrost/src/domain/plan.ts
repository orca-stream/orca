import type { Config, LibraryType } from "./config.ts";
import type {
  ConfigSection,
  PluginInfo,
  RepositoryInfo,
  Snapshot,
  VirtualFolder,
} from "./jellyfin.ts";
import { deepEqual, deepMerge, type Rec } from "./merge.ts";
import { compareVersions } from "./version.ts";

type JellyfinConfig = Config["jellyfin"];

export type Change =
  | { kind: "setRepositories"; repositories: RepositoryInfo[] }
  | { kind: "installPlugin"; name: string; guid?: string; version?: string; repositoryUrl?: string }
  | { kind: "uninstallPlugin"; id: string; name: string; version: string }
  | { kind: "setPluginEnabled"; id: string; name: string; version: string; enabled: boolean }
  | { kind: "setPluginConfig"; id: string; name: string; config: Rec }
  | { kind: "addLibrary"; name: string; type: LibraryType; paths: string[]; options: Rec }
  | { kind: "removeLibrary"; name: string }
  | { kind: "addPath"; library: string; path: string }
  | { kind: "removePath"; library: string; path: string }
  | { kind: "updateLibraryOptions"; library: string; itemId: string; options: Rec }
  | { kind: "updateConfig"; section: ConfigSection; config: Rec; keys: string[] };

export function describeChange(c: Change): string {
  switch (c.kind) {
    case "setRepositories":
      return `set plugin repositories (${c.repositories.map((r) => r.Name).join(", ")})`;
    case "installPlugin":
      return `install plugin ${c.name}${c.version ? ` ${c.version}` : ""}`;
    case "uninstallPlugin":
      return `uninstall plugin ${c.name} ${c.version}`;
    case "setPluginEnabled":
      return `${c.enabled ? "enable" : "disable"} plugin ${c.name}`;
    case "setPluginConfig":
      return `update the configuration of plugin ${c.name}`;
    case "addLibrary":
      return `add ${c.type} library "${c.name}" (${c.paths.join(", ")})`;
    case "removeLibrary":
      return `remove library "${c.name}"`;
    case "addPath":
      return `add path ${c.path} to library "${c.library}"`;
    case "removePath":
      return `remove path ${c.path} from library "${c.library}"`;
    case "updateLibraryOptions":
      return `update the options of library "${c.library}"`;
    case "updateConfig":
      return `update ${c.section} configuration (${c.keys.join(", ")})`;
  }
}

/** Plugin installs and removals, and network changes, only take effect after a restart. */
export function needsRestart(plan: readonly Change[]): boolean {
  return plan.some(
    (c) =>
      c.kind === "installPlugin" ||
      c.kind === "uninstallPlugin" ||
      // A plugin enabled or disabled stays in "Restart" until the server restarts.
      c.kind === "setPluginEnabled" ||
      (c.kind === "updateConfig" && c.section === "network"),
  );
}

const normGuid = (g: string) => g.replaceAll("-", "").toLowerCase();

/** "25.0.0.0" and "25.0.0" are the same version. */
export function sameVersion(a: string, b: string): boolean {
  return compareVersions(a, b) === 0;
}

function findPlugin(installed: PluginInfo[], want: { guid?: string | undefined; name: string }) {
  if (want.guid) {
    const byGuid = installed.find((p) => normGuid(p.Id) === normGuid(want.guid!));
    if (byGuid) return byGuid;
  }
  return installed.find((p) => p.Name.toLowerCase() === want.name.toLowerCase());
}

function planRepositories(cfg: JellyfinConfig, snap: Snapshot): Change[] {
  const wanted: RepositoryInfo[] = cfg.repositories.map((r) => ({
    Name: r.name,
    Url: r.url,
    Enabled: r.enabled,
  }));
  const urls = new Set(wanted.map((r) => r.Url));
  const extras = snap.repositories.filter((r) => !urls.has(r.Url));
  const next = [...wanted, ...(cfg.prune.repositories ? [] : extras)];
  const differs =
    wanted.some((w) => {
      const cur = snap.repositories.find((r) => r.Url === w.Url);
      return !cur || cur.Name !== w.Name || cur.Enabled !== w.Enabled;
    }) ||
    (cfg.prune.repositories && extras.length > 0);
  return differs ? [{ kind: "setRepositories", repositories: next }] : [];
}

function planPlugins(cfg: JellyfinConfig, snap: Snapshot): Change[] {
  const out: Change[] = [];
  const repoUrl = (name: string | null | undefined) =>
    name ? cfg.repositories.find((r) => r.name === name)?.url : undefined;
  for (const p of cfg.plugins) {
    const have = findPlugin(snap.plugins, p);
    if (!have || (p.version !== undefined && !sameVersion(p.version, have.Version))) {
      const change: Change = { kind: "installPlugin", name: p.name };
      if (p.guid) change.guid = p.guid;
      if (p.version) change.version = p.version;
      const url = repoUrl(p.repository);
      if (url) change.repositoryUrl = url;
      out.push(change);
    }
  }
  if (cfg.prune.plugins) {
    for (const have of snap.plugins) {
      if (have.CanUninstall && !cfg.plugins.some((p) => findPlugin([have], p))) {
        out.push({ kind: "uninstallPlugin", id: have.Id, name: have.Name, version: have.Version });
      }
    }
  }
  return out;
}

/** PathInfos mirrors Locations and is changed through the path calls; sending it back would undo them. */
function withoutPathInfos(options: Rec): Rec {
  const { PathInfos: _pathInfos, ...rest } = options;
  return rest;
}

function planLibraries(cfg: JellyfinConfig, snap: Snapshot): Change[] {
  const out: Change[] = [];
  for (const lib of cfg.libraries) {
    const have: VirtualFolder | undefined = snap.folders.find((f) => f.Name === lib.name);
    if (!have) {
      out.push({
        kind: "addLibrary",
        name: lib.name,
        type: lib.type,
        paths: lib.paths,
        options: lib.options,
      });
      continue;
    }
    for (const path of lib.paths) {
      if (!have.Locations.includes(path)) out.push({ kind: "addPath", library: lib.name, path });
    }
    // Removing a path makes Jellyfin re-create its items from the remaining ones, losing ids and
    // watch state: only when asked for.
    if (cfg.prune.paths) {
      for (const path of have.Locations) {
        if (!lib.paths.includes(path)) out.push({ kind: "removePath", library: lib.name, path });
      }
    }
    const current = withoutPathInfos(have.LibraryOptions);
    const merged = deepMerge(current, withoutPathInfos(lib.options));
    if (!deepEqual(merged, current)) {
      out.push({
        kind: "updateLibraryOptions",
        library: lib.name,
        itemId: have.ItemId,
        options: merged,
      });
    }
  }
  if (cfg.prune.libraries) {
    for (const f of snap.folders) {
      if (!cfg.libraries.some((l) => l.name === f.Name))
        out.push({ kind: "removeLibrary", name: f.Name });
    }
  }
  return out;
}

/** Things worth saying that are not changes: drift `apply` will not (or cannot) fix. */
export function planWarnings(cfg: JellyfinConfig, snap: Snapshot): string[] {
  const out: string[] = [];
  for (const lib of cfg.libraries) {
    const have = snap.folders.find((f) => f.Name === lib.name);
    if (!have) continue;
    if (have.CollectionType && have.CollectionType !== lib.type) {
      out.push(
        `Library "${lib.name}" is "${have.CollectionType}" on the server but "${lib.type}" in the config; Jellyfin cannot change the type (remove and re-add the library).`,
      );
    }
    if (have.Locations.length > 0 && !lib.paths.some((p) => have.Locations.includes(p))) {
      out.push(
        `Library "${lib.name}": none of the declared paths exist on the server (${have.Locations.join(", ")}). If the server came from \`migrate\`, declare the paths it has: pathMap and a backup migration are alternatives, not meant to be combined.`,
      );
    }
    if (!cfg.prune.paths) {
      for (const p of have.Locations.filter((l) => !lib.paths.includes(l))) {
        out.push(
          `Library "${lib.name}": path ${p} is on the server but not declared; kept (set prune.paths to remove it).`,
        );
      }
    }
  }
  return out;
}

function planSection(section: ConfigSection, declared: Rec, current: Rec): Change[] {
  const keys = Object.keys(declared).filter((k) => !deepEqual(declared[k], current[k]));
  if (keys.length === 0) return [];
  return [{ kind: "updateConfig", section, config: deepMerge(current, declared), keys }];
}

function planPluginSettings(cfg: JellyfinConfig, snap: Snapshot): Change[] {
  const out: Change[] = [];
  for (const p of cfg.plugins) {
    const have = findPlugin(snap.plugins, p);
    // A plugin that is only waiting for a restart cannot be toggled or configured yet.
    if (!have || have.Status === "Restart") continue;
    const isEnabled = have.Status !== "Disabled";
    if (isEnabled !== p.enabled) {
      out.push({
        kind: "setPluginEnabled",
        id: have.Id,
        name: have.Name,
        version: have.Version,
        enabled: p.enabled,
      });
    }
    if (p.config) {
      const current = snap.pluginConfigs[have.Id] ?? {};
      const merged = deepMerge(current, p.config);
      if (!deepEqual(merged, current)) {
        out.push({ kind: "setPluginConfig", id: have.Id, name: have.Name, config: merged });
      }
    }
  }
  return out;
}

/** Pure diff of the declared state against a snapshot of the server: the ordered list of changes. */
export function planApply(cfg: JellyfinConfig, snap: Snapshot): Change[] {
  const system: Rec = {
    ServerName: cfg.server.name,
    UICulture: cfg.server.uiCulture,
    PreferredMetadataLanguage: cfg.server.metadataLanguage,
    MetadataCountryCode: cfg.server.metadataCountry,
    ...cfg.system,
  };
  return [
    ...planRepositories(cfg, snap),
    ...planPlugins(cfg, snap),
    ...planLibraries(cfg, snap),
    ...planSection("system", system, snap.system),
    ...planSection("encoding", cfg.encoding, snap.encoding),
    ...planSection("network", cfg.network, snap.network),
    ...planPluginSettings(cfg, snap),
  ];
}

import { describe, expect, it } from "vite-plus/test";
import { planApply, needsRestart } from "../src/domain/plan.ts";
import { deepEqual, deepMerge } from "../src/domain/merge.ts";
import type { Snapshot } from "../src/domain/jellyfin.ts";
import { emptySnapshot, exampleConfig } from "./fixtures.ts";

const OPEN_SUBTITLES = "4b9ed42f-5185-48b5-9803-6ff2989014c4";
const INTRO_SKIPPER = "c83d86bb-a1e0-4c35-a113-e2101cf4ee6b";

/** A server that already satisfies the example config. */
function satisfied(): Snapshot {
  const cfg = exampleConfig().jellyfin;
  return {
    repositories: cfg.repositories.map((r) => ({ Name: r.name, Url: r.url, Enabled: true })),
    plugins: [
      {
        Id: OPEN_SUBTITLES,
        Name: "Open Subtitles",
        Version: "25.0.0.0",
        CanUninstall: true,
        Status: "Active",
      },
      {
        Id: INTRO_SKIPPER,
        Name: "Intro Skipper",
        Version: "12.0.5.0",
        CanUninstall: true,
        Status: "Active",
      },
      { Id: "bundled", Name: "TMDb", Version: "12.2.0.0", CanUninstall: false, Status: "Active" },
    ],
    folders: [
      {
        Name: "Películas",
        ItemId: "f1",
        CollectionType: "movies",
        Locations: ["/media/movies"],
        LibraryOptions: { EnableTrickplayImageExtraction: false, Enabled: true },
      },
      {
        Name: "Series",
        ItemId: "f2",
        CollectionType: "tvshows",
        Locations: ["/media/tv"],
        LibraryOptions: {},
      },
    ],
    system: {
      ServerName: "Orca",
      UICulture: "es-MX",
      PreferredMetadataLanguage: "es-419",
      MetadataCountryCode: "HN",
    },
    encoding: { ...cfg.encoding },
    network: { ...cfg.network },
    pluginConfigs: {},
  };
}

describe("merge helpers", () => {
  it("deep-merges objects and replaces arrays", () => {
    expect(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] } })).toEqual({
      a: { b: 1, c: [3] },
      d: 1,
    });
  });
  it("compares deeply, with arrays ordered", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe("planApply", () => {
  it("computes the full plan against an empty server", () => {
    const cfg = exampleConfig().jellyfin;
    const plan = planApply(cfg, emptySnapshot());
    const kinds = plan.map((c) => c.kind);
    expect(kinds).toEqual([
      "setRepositories",
      "installPlugin",
      "installPlugin",
      "addLibrary",
      "addLibrary",
      "updateConfig",
      "updateConfig",
      "updateConfig",
    ]);
    const install = plan.filter((c) => c.kind === "installPlugin");
    expect(install[1]).toMatchObject({
      name: "Intro Skipper",
      guid: INTRO_SKIPPER,
      repositoryUrl: "https://intro-skipper.org/manifest.json",
    });
    const system = plan.find((c) => c.kind === "updateConfig" && c.section === "system");
    expect(system).toMatchObject({
      config: { ServerName: "Orca", UICulture: "es-MX", Unrelated: 1 },
    });
    expect(needsRestart(plan)).toBe(true);
  });

  it("plans nothing when the server already matches", () => {
    expect(planApply(exampleConfig().jellyfin, satisfied())).toEqual([]);
  });

  it("keeps extra repositories and plugins unless prune is on", () => {
    const snap = satisfied();
    snap.repositories.push({ Name: "Extra", Url: "https://extra.example/m.json", Enabled: true });
    snap.plugins.push({
      Id: "x",
      Name: "Extra",
      Version: "1.0.0.0",
      CanUninstall: true,
      Status: "Active",
    });
    expect(planApply(exampleConfig().jellyfin, snap)).toEqual([]);

    const pruning = exampleConfig((r) => {
      r.jellyfin.prune = { plugins: true, repositories: true };
    }).jellyfin;
    const plan = planApply(pruning, snap);
    expect(plan.map((c) => c.kind)).toEqual(["setRepositories", "uninstallPlugin"]);
    // Never touches a plugin that cannot be uninstalled (the bundled TMDb above).
    expect(plan.find((c) => c.kind === "uninstallPlugin")).toMatchObject({ id: "x" });
  });

  it("reinstalls when the pinned version differs, matching the version loosely", () => {
    const pinned = (version: string) =>
      exampleConfig((r) => {
        r.jellyfin.plugins[1].version = version;
      }).jellyfin;
    expect(planApply(pinned("12.0.5"), satisfied())).toEqual([]);
    expect(planApply(pinned("12.1.0.0"), satisfied())).toMatchObject([
      { kind: "installPlugin", name: "Intro Skipper", version: "12.1.0.0" },
    ]);
  });

  it("matches plugins by guid even if the name changed", () => {
    const snap = satisfied();
    snap.plugins[0]!.Name = "OpenSubtitles";
    expect(planApply(exampleConfig().jellyfin, snap)).toEqual([]);
  });

  it("diffs library paths and merges options only when they change", () => {
    const cfg = exampleConfig((r) => {
      r.jellyfin.libraries[0].paths = ["/media/movies", "/media/extra"];
      r.jellyfin.libraries[1].options = { EnableRealtimeMonitor: true };
    }).jellyfin;
    const snap = satisfied();
    snap.folders[0]!.Locations = ["/media/movies", "/old"];
    const plan = planApply(cfg, snap);
    expect(plan).toMatchObject([
      { kind: "addPath", library: "Películas", path: "/media/extra" },
      { kind: "removePath", library: "Películas", path: "/old" },
      {
        kind: "updateLibraryOptions",
        library: "Series",
        itemId: "f2",
        options: { EnableRealtimeMonitor: true },
      },
    ]);
  });

  it("toggles plugins and merges plugin configuration", () => {
    const cfg = exampleConfig((r) => {
      r.jellyfin.plugins[0].enabled = false;
      r.jellyfin.plugins[1].config = { Skip: true };
    }).jellyfin;
    const snap = satisfied();
    snap.pluginConfigs[INTRO_SKIPPER] = { Skip: false, Other: 1 };
    expect(planApply(cfg, snap)).toMatchObject([
      { kind: "setPluginEnabled", id: OPEN_SUBTITLES, enabled: false },
      { kind: "setPluginConfig", id: INTRO_SKIPPER, config: { Skip: true, Other: 1 } },
    ]);
  });

  it("does not touch the toggle of a plugin that is still waiting for a restart", () => {
    const cfg = exampleConfig((r) => {
      r.jellyfin.plugins[0].enabled = false;
    }).jellyfin;
    const snap = satisfied();
    snap.plugins[0]!.Status = "Restart";
    expect(planApply(cfg, snap)).toEqual([]);
  });

  it("flags a network change as needing a restart, a system change not", () => {
    const cfg = exampleConfig().jellyfin;
    const net = satisfied();
    net.network.LocalNetworkSubnets = ["10.0.0.0/8"];
    const plan = planApply(cfg, net);
    expect(plan).toMatchObject([{ kind: "updateConfig", section: "network" }]);
    expect(needsRestart(plan)).toBe(true);

    const sys = satisfied();
    sys.system.ServerName = "Other";
    expect(needsRestart(planApply(cfg, sys))).toBe(false);
  });

  it("removes undeclared libraries only with prune.libraries", () => {
    const snap = satisfied();
    snap.folders.push({
      Name: "Old",
      ItemId: "f3",
      CollectionType: "movies",
      Locations: ["/x"],
      LibraryOptions: {},
    });
    expect(planApply(exampleConfig().jellyfin, snap)).toEqual([]);
    const cfg = exampleConfig((r) => {
      r.jellyfin.prune = { libraries: true };
    }).jellyfin;
    expect(planApply(cfg, snap)).toMatchObject([{ kind: "removeLibrary", name: "Old" }]);
  });
});

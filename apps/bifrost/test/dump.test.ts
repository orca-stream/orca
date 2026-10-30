import { describe, expect, it } from "vite-plus/test";
import { dump } from "../src/application/dump.ts";
import { parseConfig } from "../src/domain/config.ts";
import { mapPath } from "../src/domain/dump.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { exampleConfig } from "./fixtures.ts";

function laptop() {
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  server.repositories = [
    {
      Name: "Jellyfin Stable",
      Url: "https://repo.jellyfin.org/files/plugin/manifest.json",
      Enabled: true,
    },
  ];
  server.plugins = [
    { Id: "tmdb", Name: "TMDb", Version: "12.2.0.0", CanUninstall: false, Status: "Active" },
    {
      Id: "4b9ed42f518548b598036ff2989014c4",
      Name: "Open Subtitles",
      Version: "25.0.0.0",
      CanUninstall: true,
      Status: "Active",
    },
    {
      Id: "c83d86bba1e04c35a113e2101cf4ee6b",
      Name: "Intro Skipper",
      Version: "12.0.5.0",
      CanUninstall: true,
      Status: "Active",
    },
  ];
  server.packages = [
    {
      name: "Open Subtitles",
      guid: "4b9ed42f-5185-48b5-9803-6ff2989014c4",
      versions: [
        {
          version: "25.0.0.0",
          repositoryName: "Jellyfin Stable",
          repositoryUrl: "https://repo.jellyfin.org/files/plugin/manifest.json",
        },
      ],
    },
  ];
  server.folders = [
    {
      Name: "Películas",
      ItemId: "abc123",
      CollectionType: "movies",
      Locations: ["/data/jellyfin/movies"],
      LibraryOptions: {
        Enabled: true,
        PathInfos: [{ Path: "/data/jellyfin/movies" }],
        EnableTrickplayImageExtraction: false,
      },
    },
    {
      Name: "Series",
      ItemId: "def456",
      CollectionType: "tvshows",
      Locations: ["/data/jellyfin/tv"],
      LibraryOptions: {},
    },
  ];
  server.configs = {
    system: {
      ServerName: "Laptop",
      UICulture: "es-MX",
      PreferredMetadataLanguage: "es-419",
      MetadataCountryCode: "HN",
      EnableFolderView: true,
      CachePath: "/var/cache/jellyfin",
      MetadataPath: "/var/lib/jellyfin/metadata",
      PluginRepositories: [],
      IsStartupWizardCompleted: true,
      ServerId: "sid",
    },
    encoding: {
      HardwareAccelerationType: "none",
      VaapiDevice: "/dev/dri/renderD128",
      HardwareDecodingCodecs: ["h264", "vc1"],
      TranscodingTempPath: "/var/lib/jellyfin/transcodes",
      EncoderAppPath: "/usr/lib/jellyfin-ffmpeg/ffmpeg",
    },
    network: {
      EnableRemoteAccess: true,
      LocalNetworkSubnets: [],
      BaseUrl: "",
      InternalHttpPort: 8096,
    },
  };
  const jellyfin = new SdkJellyfinAdmin({
    url: "http://fake:8096",
    token: "k",
    axios: server.axios,
  });
  const lines: string[] = [];
  return { server, deps: { jellyfin, log: (l: string) => lines.push(l) }, lines };
}

describe("mapPath", () => {
  const map = { "/data/jellyfin/movies": "/media/movies", "/data": "/other" };
  it("rewrites exact and nested paths, longest source first", () => {
    expect(mapPath("/data/jellyfin/movies", map)).toBe("/media/movies");
    expect(mapPath("/data/jellyfin/movies/Alien", map)).toBe("/media/movies/Alien");
    expect(mapPath("/data/x", map)).toBe("/other/x");
    expect(mapPath("/datax", map)).toBe("/datax");
  });
});

describe("dump", () => {
  it("captures the portable state, drops ids and runtime state, and re-validates", async () => {
    const { deps } = laptop();
    const { document } = await dump(deps, exampleConfig(), { mapPaths: true });
    const text = JSON.stringify(document);
    for (const noise of [
      "ItemId",
      "PathInfos",
      "CachePath",
      "MetadataPath",
      "ServerId",
      "TranscodingTempPath",
      "EncoderAppPath",
      "PluginRepositories",
      "IsStartupWizardCompleted",
      "abc123",
      "Status",
    ]) {
      expect(text).not.toContain(noise);
    }
    const cfg = parseConfig(document);
    expect(cfg.jellyfin.server).toEqual({
      name: "Laptop",
      uiCulture: "es-MX",
      metadataLanguage: "es-419",
      metadataCountry: "HN",
    });
    expect(cfg.jellyfin.system).toEqual({ EnableFolderView: true });
    expect(cfg.jellyfin.encoding).toEqual({
      HardwareAccelerationType: "none",
      VaapiDevice: "/dev/dri/renderD128",
      HardwareDecodingCodecs: ["h264", "vc1"],
    });
    expect(cfg.jellyfin.network).toEqual({ EnableRemoteAccess: true, LocalNetworkSubnets: [] });
    expect(cfg.jellyfin.libraries.map((l) => [l.name, l.type, l.paths])).toEqual([
      ["Películas", "movies", ["/media/movies"]],
      ["Series", "tvshows", ["/media/tv"]],
    ]);
    expect(cfg.jellyfin.libraries[0]?.options).toEqual({
      Enabled: true,
      EnableTrickplayImageExtraction: false,
    });
    // Host, admin and the pathMap come from the existing config.
    expect(cfg.host.address).toBe("192.168.1.10");
    expect(cfg.pathMap).toEqual(exampleConfig().pathMap);
  });

  it("keeps only plugins that can be installed, with guid and repository", async () => {
    const { deps, lines } = laptop();
    const { document } = await dump(deps, exampleConfig(), { mapPaths: true });
    const cfg = parseConfig(document);
    expect(cfg.jellyfin.plugins).toMatchObject([
      {
        name: "Open Subtitles",
        guid: "4b9ed42f-5185-48b5-9803-6ff2989014c4",
        version: "25.0.0.0",
        repository: "Jellyfin Stable",
      },
      {
        name: "Intro Skipper",
        guid: "c83d86bb-a1e0-4c35-a113-e2101cf4ee6b",
        version: "12.0.5.0",
        repository: null,
      },
    ]);
    // Intro Skipper is in no configured repository: warn instead of guessing.
    expect(lines.join("\n")).toMatch(/Intro Skipper has no repository/);
  });

  it("leaves the paths alone when the server is already on target paths", async () => {
    const { server, deps } = laptop();
    server.folders[0]!.Locations = ["/media/movies"];
    server.folders[1]!.Locations = ["/media/tv"];
    const { document } = await dump(deps, exampleConfig(), { mapPaths: false });
    const cfg = parseConfig(document);
    expect(cfg.jellyfin.libraries.map((l) => l.paths)).toEqual([["/media/movies"], ["/media/tv"]]);
  });

  it("keeps the published ports of the config it starts from", async () => {
    const { deps } = laptop();
    const base = exampleConfig((r) => {
      r.jellyfin.port = 9096;
      r.jellyfin.url = `http://${r.host.address}:9096`;
      r.jellyfin.discoveryPort = 7360;
    });
    const { document } = await dump(deps, base, { mapPaths: true });
    const cfg = parseConfig(document);
    expect([cfg.jellyfin.port, cfg.jellyfin.discoveryPort]).toEqual([9096, 7360]);
  });

  it("only reads", async () => {
    const { server, deps } = laptop();
    await dump(deps, exampleConfig(), { mapPaths: true });
    expect(server.writes()).toEqual([]);
  });
});

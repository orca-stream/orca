import { describe, expect, it } from "vite-plus/test";
import { BifrostError } from "../src/domain/errors.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";

function setup(token: string | undefined = "api-key") {
  const server = new FakeJellyfinServer();
  const admin = new SdkJellyfinAdmin({ url: "http://fake:8096", token, axios: server.axios });
  return { server, admin };
}

describe("SdkJellyfinAdmin", () => {
  it("reads the public info without a token", async () => {
    const { admin, server } = setup(undefined);
    server.wizardCompleted = true;
    expect(await admin.publicInfo()).toEqual({ version: "12.2.0", startupWizardCompleted: true });
  });

  it("runs the wizard in order and ends with remote access off", async () => {
    const { admin, server } = setup(undefined);
    await admin.runWizard({
      serverName: "Orca",
      uiCulture: "es-MX",
      metadataLanguage: "es-419",
      metadataCountry: "HN",
      adminName: "admin",
      adminPassword: "s3cret",
    });
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "post /Startup/Configuration",
      "get /Startup/User",
      "post /Startup/User",
      "post /Startup/RemoteAccess",
      "post /Startup/Complete",
    ]);
    expect(server.wizardCompleted).toBe(true);
    expect(server.configs.network).toMatchObject({ EnableRemoteAccess: false });
  });

  it("logs in and keeps the token for later calls", async () => {
    const { admin, server } = setup(undefined);
    server.wizardCompleted = true;
    server.firstUserName = "admin";
    server.adminPassword = "pw";
    expect(await admin.login("admin", "pw")).toBe("user-token");
    await admin.createApiKey("Bifrost");
    expect(await admin.listApiKeys()).toMatchObject([{ AppName: "Bifrost" }]);
  });

  it("round-trips repositories, plugins, libraries and configuration", async () => {
    const { admin, server } = setup();
    server.wizardCompleted = true;
    await admin.setRepositories([{ Name: "R", Url: "https://r.example/m.json", Enabled: true }]);
    expect(await admin.getRepositories()).toEqual([
      { Name: "R", Url: "https://r.example/m.json", Enabled: true },
    ]);

    await admin.installPlugin({
      name: "Intro Skipper",
      guid: "c83d86bb",
      version: "12.0.5.0",
      repositoryUrl: "https://r.example/m.json",
    });
    const install = server.find("post", "/Packages/Installed/Intro Skipper")[0]!;
    expect(Object.fromEntries(install.query)).toEqual({
      assemblyGuid: "c83d86bb",
      version: "12.0.5.0",
      repositoryUrl: "https://r.example/m.json",
    });
    await admin.setPluginEnabled("c83d86bb", "12.0.5.0", false);
    expect((await admin.getPlugins()).find((p) => p.Id === "c83d86bb")?.Status).toBe("Disabled");
    await admin.setPluginConfig("c83d86bb", { A: 1 });
    expect(await admin.getPluginConfig("c83d86bb")).toEqual({ A: 1 });
    await admin.uninstallPlugin("c83d86bb", "12.0.5.0");

    await admin.addLibrary({
      name: "Series",
      type: "tvshows",
      paths: ["/a", "/b"],
      options: { X: 1 },
    });
    const add = server.find("post", "/Library/VirtualFolders")[0]!;
    expect(add.query.getAll("paths")).toEqual(["/a", "/b"]);
    expect(add.query.get("collectionType")).toBe("tvshows");
    expect(add.query.get("refreshLibrary")).toBe("false");
    await admin.addMediaPath("Series", "/c");
    await admin.removeMediaPath("Series", "/a");
    const [folder] = await admin.getFolders();
    expect(folder).toMatchObject({
      Name: "Series",
      Locations: ["/b", "/c"],
      LibraryOptions: { X: 1 },
    });
    await admin.updateLibraryOptions(folder!.ItemId, { X: 2 });
    expect((await admin.getFolders())[0]?.LibraryOptions).toEqual({ X: 2 });
    await admin.removeLibrary("Series");
    expect(await admin.getFolders()).toEqual([]);

    await admin.setConfig("encoding", { HardwareAccelerationType: "vaapi" });
    expect(await admin.getConfig("encoding")).toEqual({ HardwareAccelerationType: "vaapi" });
    expect(await admin.getConfig("system")).toMatchObject({ ServerName: "jellyfin" });
  });

  it("creates a backup and asks for a restore", async () => {
    const { admin, server } = setup();
    server.wizardCompleted = true;
    expect(await admin.createBackup()).toMatchObject({ Path: server.backupPath });
    expect(server.find("post", "/Backup/Create")[0]?.body).toMatchObject({ Database: true });
    await admin.startRestore("jellyfin-backup-1.zip");
    expect(server.find("post", "/Backup/Restore")[0]?.body).toEqual({
      ArchiveFileName: "jellyfin-backup-1.zip",
    });
  });

  it("turns HTTP failures into a BifrostError that names the call", async () => {
    const { admin, server } = setup("key");
    server.validToken = "other";
    const err = await admin.getRepositories().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BifrostError);
    expect((err as Error).message).toMatch(/GET \/Repositories.*401/);
  });

  it("turns an unreachable server into a BifrostError", async () => {
    const { admin, server } = setup();
    server.downPolls = 1;
    const err = await admin.publicInfo().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BifrostError);
    expect((err as Error).message).toMatch(/cannot reach/i);
  });
});

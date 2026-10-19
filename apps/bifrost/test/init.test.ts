import { describe, expect, it } from "vite-plus/test";
import { init } from "../src/application/init.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { InMemorySecretStore } from "./fakes/secret-store.ts";
import { exampleConfig } from "./fixtures.ts";

function setup(secrets: Record<string, string> = { JELLYFIN_ADMIN_PASSWORD: "s3cret" }) {
  const server = new FakeJellyfinServer();
  const jellyfin = new SdkJellyfinAdmin({ url: "http://fake:8096", axios: server.axios });
  const store = new InMemorySecretStore(secrets);
  const lines: string[] = [];
  return {
    server,
    store,
    deps: { jellyfin, secrets: store, log: (l: string) => lines.push(l) },
    lines,
  };
}

describe("init", () => {
  it("runs the wizard, creates the Bifrost key and stores it", async () => {
    const { server, store, deps } = setup();
    const result = await init(deps, exampleConfig(), { dryRun: false });
    expect(result).toEqual({ wizardRan: true, keyCreated: true });
    expect(server.wizardCompleted).toBe(true);
    expect(server.adminPassword).toBe("s3cret");
    expect(server.configs.network).toMatchObject({ EnableRemoteAccess: false });
    expect(server.keys).toHaveLength(1);
    expect(await store.get("JELLYFIN_API_KEY")).toBe(server.keys[0]!.AccessToken);
  });

  it("skips the wizard when it is already completed and does not duplicate the key", async () => {
    const { server, deps, store } = setup();
    await init(deps, exampleConfig(), { dryRun: false });
    server.requests.length = 0;

    const again = await init(deps, exampleConfig(), { dryRun: false });
    expect(again).toEqual({ wizardRan: false, keyCreated: false });
    expect(server.requests.some((r) => r.path.startsWith("/Startup/"))).toBe(false);
    expect(server.find("post", "/Auth/Keys")).toHaveLength(0);
    expect(server.keys).toHaveLength(1);
    expect(await store.get("JELLYFIN_API_KEY")).toBe(server.keys[0]!.AccessToken);
  });

  it("creates the key when the wizard was done by hand and no Bifrost key exists", async () => {
    const { server, deps } = setup();
    server.wizardCompleted = true;
    server.firstUserName = "admin";
    server.adminPassword = "s3cret";
    server.keys.push({ AppName: "Other", AccessToken: "other" });
    const result = await init(deps, exampleConfig(), { dryRun: false });
    expect(result).toEqual({ wizardRan: false, keyCreated: true });
    expect(server.keys.map((k) => k.AppName)).toEqual(["Other", "Bifrost"]);
  });

  it("explains what to do when the admin password is not in the secret store", async () => {
    const { deps } = setup({});
    await expect(init(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(
      /JELLYFIN_ADMIN_PASSWORD/,
    );
  });

  it("changes nothing on --dry-run", async () => {
    const { server, deps } = setup();
    await init(deps, exampleConfig(), { dryRun: true });
    expect(server.writes()).toEqual([]);
  });
});

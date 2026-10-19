import { describe, expect, it } from "vite-plus/test";
import { apply } from "../src/application/apply.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { exampleConfig } from "./fixtures.ts";

function setup() {
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  const jellyfin = new SdkJellyfinAdmin({
    url: "http://fake:8096",
    token: "key",
    axios: server.axios,
  });
  const clock = new FakeClock();
  const lines: string[] = [];
  return { server, deps: { jellyfin, clock, log: (l: string) => lines.push(l) }, lines, clock };
}

describe("apply", () => {
  it("brings an empty server to the declared state, restarting once for the plugins", async () => {
    const { server, deps, clock } = setup();
    const cfg = exampleConfig();
    const result = await apply(deps, cfg, { dryRun: false });

    expect(result.restarted).toBe(true);
    expect(server.find("post", "/System/Restart")).toHaveLength(1);
    // It waited for the server to answer again: the two failed polls cost sleeps.
    expect(clock.sleeps.length).toBeGreaterThan(2);
    expect(server.repositories.map((r) => r.Name)).toEqual(["Jellyfin Stable", "Intro Skipper"]);
    expect(server.plugins.filter((p) => p.CanUninstall).map((p) => [p.Name, p.Status])).toEqual([
      ["Open Subtitles", "Active"],
      ["Intro Skipper", "Active"],
    ]);
    expect(server.folders.map((f) => [f.Name, f.Locations])).toEqual([
      ["Películas", ["/media/movies"]],
      ["Series", ["/media/tv"]],
    ]);
    expect(server.configs.system).toMatchObject({
      ServerName: "Orca",
      UICulture: "es-MX",
      Untouched: true,
    });
    expect(server.configs.encoding).toMatchObject({ HardwareAccelerationType: "vaapi" });
    expect(server.configs.network).toMatchObject({ EnableRemoteAccess: false });
    expect(server.find("post", "/Library/Refresh")).toHaveLength(1);
  });

  it("makes zero writes on the second run", async () => {
    const { server, deps, lines } = setup();
    const cfg = exampleConfig();
    await apply(deps, cfg, { dryRun: false });
    server.requests.length = 0;
    lines.length = 0;

    const second = await apply(deps, cfg, { dryRun: false });
    expect(second.changes).toEqual([]);
    expect(second.restarted).toBe(false);
    expect(server.writes()).toEqual([]);
    expect(lines.join("\n")).toContain("0 changes");
  });

  it("prints the plan and writes nothing on --dry-run", async () => {
    const { server, deps, lines } = setup();
    const result = await apply(deps, exampleConfig(), { dryRun: true });
    expect(result.changes.length).toBeGreaterThan(0);
    expect(server.writes()).toEqual([]);
    expect(lines.join("\n")).toContain("install plugin Intro Skipper");
  });

  it("fails loudly if a plugin does not come back Active after the restart", async () => {
    const { server, deps } = setup();
    // After the restart the server reports the plugin as malfunctioned.
    const adapter = server.axios.defaults.adapter as (c: unknown) => Promise<unknown>;
    server.axios.defaults.adapter = async (c: any) => {
      const res: any = await adapter(c);
      if (c.url.endsWith("/Plugins") && c.method === "get") {
        res.data = res.data.map((p: any) =>
          p.CanUninstall && server.find("post", "/System/Restart").length
            ? { ...p, Status: "Malfunctioned" }
            : p,
        );
      }
      return res;
    };
    await expect(apply(deps, exampleConfig(), { dryRun: false })).rejects.toThrow(/Malfunctioned/);
  });

  it("applies plugin settings once the plugin is active after the restart", async () => {
    const { server, deps } = setup();
    const cfg = exampleConfig((r) => {
      r.jellyfin.plugins[1].config = { SkipIntro: true };
    });
    await apply(deps, cfg, { dryRun: false });
    const introId = "c83d86bb-a1e0-4c35-a113-e2101cf4ee6b";
    expect(server.pluginConfigs[introId]).toEqual({ SkipIntro: true });
  });
});

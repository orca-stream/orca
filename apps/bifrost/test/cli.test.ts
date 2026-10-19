import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint, run, type Runtime } from "../src/cli.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { FakeRemoteHost } from "./fakes/remote-host.ts";
import { InMemorySecretStore } from "./fakes/secret-store.ts";
import { exampleConfig } from "./fixtures.ts";

const OLD_URL = "http://old:8096";
const withSource = (r: any) => {
  r.migrate = { source: { url: OLD_URL, apiKeySecret: "OLD_KEY" } };
};

function setup(
  secrets: Record<string, string> = { JELLYFIN_API_KEY: "key", JELLYFIN_ADMIN_PASSWORD: "pw" },
  patch?: (raw: any) => void,
) {
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  const oldServer = new FakeJellyfinServer();
  oldServer.wizardCompleted = true;
  oldServer.folders = [
    {
      Name: "Películas",
      ItemId: "a",
      CollectionType: "movies",
      Locations: ["/data/jellyfin/movies"],
      LibraryOptions: {},
    },
  ];
  const remote = new FakeRemoteHost({ probes: "fail" });
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const loaded: string[] = [];
  const envFiles: string[] = [];
  const rt: Runtime = {
    cwd: "/work",
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    loadConfig: async (path) => {
      loaded.push(path);
      return exampleConfig(patch);
    },
    writeFile: async (path, content) => {
      written[path] = content;
    },
    secrets: (path) => {
      envFiles.push(path);
      return new InMemorySecretStore(secrets);
    },
    remote: () => remote,
    jellyfin: (url, token) =>
      new SdkJellyfinAdmin({
        url: "http://fake:8096",
        token,
        axios: (url === OLD_URL ? oldServer : server).axios,
      }),
    canRead: async () => true,
    clock: () => new FakeClock(),
  };
  return { rt, out, err, server, oldServer, remote, written, loaded, envFiles };
}

const text = (lines: string[]) => lines.join("\n");

describe("cli", () => {
  it("prints usage for --help and for no command", async () => {
    const a = setup();
    expect(await run(["--help"], a.rt)).toBe(0);
    for (const c of [
      "host prepare",
      "up",
      "init",
      "dump",
      "apply",
      "backup",
      "restore",
      "migrate",
      "--dry-run",
      "--config",
    ]) {
      expect(text(a.out)).toContain(c);
    }
    const b = setup();
    expect(await run([], b.rt)).toBe(2);
    expect(text(b.out)).toContain("Usage");
  });

  it("rejects unknown commands and options with exit code 2", async () => {
    const a = setup();
    expect(await run(["fly"], a.rt)).toBe(2);
    expect(text(a.err)).toMatch(/unknown command/i);
    const b = setup();
    expect(await run(["apply", "--nope"], b.rt)).toBe(2);
    expect(text(b.err)).toContain("--nope");
  });

  it("defaults the config to bifrost.yaml in the working directory and the .env beside it", async () => {
    const a = setup();
    await run(["apply", "--dry-run"], a.rt);
    expect(a.loaded).toEqual(["/work/bifrost.yaml"]);
    expect(a.envFiles).toEqual(["/work/.env"]);
    const b = setup();
    await run(["-c", "/etc/orca/x.yaml", "apply", "--dry-run"], b.rt);
    expect(b.loaded).toEqual(["/etc/orca/x.yaml"]);
    expect(b.envFiles).toEqual(["/etc/orca/.env"]);
  });

  it("apply --dry-run prints the plan and writes nothing", async () => {
    const a = setup();
    expect(await run(["apply", "--dry-run"], a.rt)).toBe(0);
    expect(text(a.out)).toContain("install plugin Intro Skipper");
    expect(a.server.writes()).toEqual([]);
  });

  it("apply asks for `init` when there is no API key yet", async () => {
    const a = setup({});
    expect(await run(["apply"], a.rt)).toBe(1);
    expect(text(a.err)).toMatch(/bifrost init/);
  });

  it("host prepare needs the host name, and it must be the configured one", async () => {
    const a = setup();
    expect(await run(["host", "prepare"], a.rt)).toBe(2);
    expect(await run(["host", "prepare", "elsewhere", "--dry-run"], a.rt)).toBe(1);
    expect(text(a.err)).toContain("homelab");
    expect(a.remote.calls).toEqual([]);
  });

  it("host prepare --dry-run only probes", async () => {
    const a = setup();
    expect(await run(["host", "prepare", "homelab", "--dry-run"], a.rt)).toBe(0);
    expect(a.remote.mutations()).toEqual([]);
    expect(text(a.out)).toMatch(/would/);
  });

  it("dump prints YAML, or writes it with -o", async () => {
    const a = setup();
    expect(await run(["dump"], a.rt)).toBe(0);
    expect(parse(text(a.out))).toMatchObject({
      version: 1,
      jellyfin: { server: { name: "jellyfin" } },
    });
    const b = setup();
    expect(await run(["dump", "-o", "out.yaml"], b.rt)).toBe(0);
    expect(Object.keys(b.written)).toEqual(["/work/out.yaml"]);
  });

  it("turns expected failures into a message and exit code 1, without a stack trace", async () => {
    const a = setup();
    a.rt.loadConfig = async () => {
      throw new (await import("../src/domain/errors.ts")).ConfigError(
        "Invalid configuration: nope",
      );
    };
    expect(await run(["apply"], a.rt)).toBe(1);
    expect(text(a.err)).toBe("error: Invalid configuration: nope");
  });

  it("restore refuses without --yes, backup needs a backup section", async () => {
    const a = setup({ JELLYFIN_API_KEY: "key" });
    expect(await run(["backup"], a.rt)).toBe(1);
    expect(text(a.err)).toMatch(/backup/);
  });

  it("migrate needs a migrate.source section", async () => {
    const a = setup();
    expect(await run(["migrate", "--dry-run"], a.rt)).toBe(1);
    expect(text(a.err)).toMatch(/migrate/);
  });

  it("dump reads the target as it is, without touching paths", async () => {
    const a = setup({ JELLYFIN_API_KEY: "key", OLD_KEY: "old" }, withSource);
    a.server.folders = [
      {
        Name: "X",
        ItemId: "x",
        CollectionType: "movies",
        Locations: ["/data/jellyfin/movies"],
        LibraryOptions: {},
      },
    ];
    expect(await run(["dump"], a.rt)).toBe(0);
    expect(text(a.out)).toContain("/data/jellyfin/movies");
  });

  it("dump --from source reads the old server and maps its paths forward", async () => {
    const a = setup({ JELLYFIN_API_KEY: "key", OLD_KEY: "old" }, withSource);
    expect(await run(["dump", "--from", "source"], a.rt)).toBe(0);
    const doc = parse(text(a.out));
    expect(doc.jellyfin.libraries[0].paths).toEqual(["/media/movies"]);
    expect(a.oldServer.requests.length).toBeGreaterThan(0);
    expect(a.server.requests).toEqual([]);
  });

  it("dump --from needs migrate.source and a known value; --reverse is gone", async () => {
    const a = setup();
    expect(await run(["dump", "--from", "source"], a.rt)).toBe(1);
    expect(text(a.err)).toMatch(/migrate/);
    const b = setup();
    expect(await run(["dump", "--from", "moon"], b.rt)).toBe(2);
    const c = setup();
    expect(await run(["dump", "--reverse"], c.rt)).toBe(2);
  });

  it("recognises when it is the entry point, through symlinks too", () => {
    const here = fileURLToPath(import.meta.url);
    expect(isEntryPoint(import.meta.url, here)).toBe(true);
    expect(isEntryPoint(import.meta.url, undefined)).toBe(false);
    expect(isEntryPoint(import.meta.url, "/somewhere/else.ts")).toBe(false);
    const link = join(mkdtempSync(join(tmpdir(), "bifrost-link-")), "cli.ts");
    symlinkSync(here, link);
    expect(isEntryPoint(import.meta.url, link)).toBe(true);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { hmUp } from "../src/application/hm-up.ts";
import { up } from "../src/application/up.ts";
import { renderCompose } from "../src/domain/compose.ts";
import { HM_API_KEY_APP, hmImageTag } from "../src/domain/hm.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeJellyfinServer } from "./fakes/jellyfin-server.ts";
import { FakeRemoteHost, type Answer } from "./fakes/remote-host.ts";
import { InMemorySecretStore } from "./fakes/secret-store.ts";
import { COMMIT, FakeSourceArchive } from "./fakes/source-archive.ts";
import { SdkJellyfinAdmin } from "../src/infrastructure/sdk-jellyfin-admin.ts";
import { exampleConfig } from "./fixtures.ts";

const IMAGE = hmImageTag(COMMIT);
const COMPOSE = "/srv/jellyfin/compose.yaml";
const ENV = "/srv/orca-hm/hm.env";
const withHm = (r: any) => {
  r.hm = { mediaDir: "/srv/jellyfin/media/tv", contactEmailSecret: "HM_CONTACT_EMAIL" };
};

function answers(extra: Answer[] = []): Answer[] {
  return [
    ...extra,
    ["id -u jellyfin", { stdout: "998\n" }],
    ["id -g jellyfin", { stdout: "997\n" }],
    ["id -u orca-hm", { stdout: "996\n" }],
    ["getent group render", { stdout: "991\n" }],
    ["docker image inspect", { code: 1 }],
    [`cat '${ENV}'`, { code: 1 }],
    [`cat '${COMPOSE}'`, { code: 1 }],
    ["cat '/srv/orca-hm/image'", { code: 1 }],
    ["docker inspect", { stdout: "healthy\n" }],
    ["ufw status", { code: 1 }],
    ["docker image ls", { stdout: `${IMAGE}\norca-hm:aaaaaaaaaaaa\norca-hm:bbbbbbbbbbbb\n` }],
  ];
}

function setup(
  opts: { dryRun?: boolean; remote?: FakeRemoteHost; secrets?: Record<string, string> } = {},
) {
  const remote = opts.remote ?? new FakeRemoteHost({ answers: answers() });
  const server = new FakeJellyfinServer();
  server.wizardCompleted = true;
  server.firstUserName = "admin";
  server.adminPassword = "pw";
  const secrets = new InMemorySecretStore({
    JELLYFIN_ADMIN_PASSWORD: "pw",
    HM_CONTACT_EMAIL: "me@example.org",
    ...opts.secrets,
  });
  const source = new FakeSourceArchive();
  const lines: string[] = [];
  const jellyfin = new SdkJellyfinAdmin({ url: "http://fake:8096", axios: server.axios });
  const promise = () =>
    hmUp(
      { remote, clock: new FakeClock(), secrets, source, jellyfin, log: (l) => lines.push(l) },
      exampleConfig(withHm),
      { dryRun: opts.dryRun ?? false },
    );
  return { remote, server, secrets, source, lines, run: promise };
}

describe("hm up", () => {
  it("packs the ref, builds on the host, writes env and compose, starts and waits", async () => {
    const t = setup();
    await t.run();

    expect(t.source.resolved).toEqual(["HEAD"]);
    expect(t.source.archived).toEqual([COMMIT]);
    expect(t.source.disposed).toBe(1);
    const copy = t.remote.calls.find((c) => c.kind === "copy")!;
    expect(copy.cmd).toBe(`/srv/orca-hm/src/${IMAGE.split(":")[1]}.tar`);
    const build = t.remote.scripts().find((s) => s.includes("docker build"))!;
    expect(build).toContain(`-f /srv/orca-hm/src/${IMAGE.split(":")[1]}/apps/hm-server/Dockerfile`);
    expect(build).toContain(`-t ${IMAGE}`);

    const compose = t.remote.calls.find((c) => c.kind === "write" && c.cmd === COMPOSE)!;
    expect(compose.stdin).toBe(
      renderCompose(
        exampleConfig(withHm),
        { uid: 998, gid: 997, renderGid: 991 },
        {
          uid: 996,
          gid: 997,
          image: IMAGE,
        },
      ),
    );
    expect(t.remote.scripts().find((s) => s.includes("docker compose"))).toContain(
      `docker compose -f ${COMPOSE} up -d --force-recreate --no-deps orca-hm`,
    );
    // The build precedes the start; the start precedes the health wait.
    const cmds = t.remote.calls.map((c) => c.cmd);
    expect(cmds.findIndex((c) => c.includes("docker build"))).toBeLessThan(
      cmds.findIndex((c) => c.includes("up -d")),
    );
    expect(
      cmds.some((c) => c.includes("docker inspect -f '{{.State.Health.Status}}' orca-hm")),
    ).toBe(true);
  });

  it("extracts the tarball without taking its owner or modes", async () => {
    const t = setup();
    await t.run();
    const build = t.remote.scripts().find((s) => s.includes("docker build"))!;
    expect(build).toContain("tar -xf");
    expect(build).toContain("--no-same-owner --no-same-permissions");
  });

  it("clears leftover tarballs from earlier runs before copying", async () => {
    const t = setup();
    await t.run();
    const cmds = t.remote.calls.map((c) => c.kind + ":" + c.cmd);
    const clean = cmds.findIndex((c) => c.includes("-name '*.tar'") && c.includes("rm -rf {} +"));
    expect(clean).toBeGreaterThanOrEqual(0);
    expect(clean).toBeLessThan(cmds.findIndex((c) => c.startsWith("copy:")));
  });

  it("allows the LAN to reach H&M's port in ufw, once", async () => {
    const t = setup();
    await t.run();
    const rule = t.remote.scripts().find((s) => s.startsWith("ufw allow"))!;
    expect(rule.trim()).toBe("ufw allow from 192.168.1.0/24 to 192.168.1.10 port 8787 proto tcp");
    const probe = t.remote.calls.find((c) => c.cmd.includes("ufw status"))!;
    expect(probe.readOnly).toBe(true);

    const present = new FakeRemoteHost({ answers: answers([["ufw status", { code: 0 }]]) });
    await setup({ remote: present }).run();
    expect(present.scripts().some((s) => s.includes("ufw allow"))).toBe(false);
  });

  it("fails loudly when Jellyfin does not answer 200 from inside the container", async () => {
    const remote = new FakeRemoteHost({
      answers: answers([["docker exec orca-hm", { code: 1, stderr: "Jellyfin answered 403" }]]),
    });
    await expect(setup({ remote }).run()).rejects.toThrow(/403/);
  });

  it("checks Jellyfin from inside the container with the key from its environment, not argv", async () => {
    const t = setup();
    await t.run();
    const check = t.remote.calls.find((c) => c.cmd.includes("docker exec orca-hm"))!;
    expect(check.cmd).toContain("process.env.JELLYFIN_API_KEY");
    expect(check.cmd).toContain("/System/Info");
    expect(check.cmd).not.toContain(t.server.keys[0]!.AccessToken);
  });

  it("removes old images, keeping the current and the previous one", async () => {
    const t = setup({
      remote: new FakeRemoteHost({
        answers: answers([["cat '/srv/orca-hm/image'", { stdout: "orca-hm:aaaaaaaaaaaa\n" }]]),
      }),
    });
    await t.run();
    const rmi = t.remote.scripts().filter((s) => s.includes("docker rmi"));
    expect(rmi.join("\n")).toContain("orca-hm:bbbbbbbbbbbb");
    expect(rmi.join("\n")).not.toContain("orca-hm:aaaaaaaaaaaa");
    expect(rmi.join("\n")).not.toContain(IMAGE);
  });

  it("creates a dedicated API key once and stores it", async () => {
    const t = setup();
    await t.run();
    expect(t.server.keys.map((k) => k.AppName)).toEqual([HM_API_KEY_APP]);
    expect(t.secrets.values.get("ORCA_HM_JELLYFIN_API_KEY")).toBe(t.server.keys[0]!.AccessToken);
    await t.run();
    expect(t.server.keys).toHaveLength(1);
  });

  it("writes the env file 0600 as root with every required variable", async () => {
    const t = setup();
    await t.run();
    const env = t.remote.calls.find((c) => c.kind === "write" && c.cmd === ENV)!;
    expect(env.mode).toBe("0600");
    expect(env.sudo).toBe(true);
    const lines = Object.fromEntries(
      env
        .stdin!.split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split("=") as [string, string]),
    );
    const key = t.server.keys[0]!.AccessToken;
    expect(lines).toEqual({
      HOST: "192.168.1.10",
      PORT: "8787",
      DB_FILE: "/data/hm.sqlite",
      MEDIA_ROOT: "/media/tv",
      JELLYFIN_MEDIA_ROOT: "/media/tv",
      JELLYFIN_URL: "http://192.168.1.10:8096",
      JELLYFIN_API_KEY: key,
      CONTACT_EMAIL: "me@example.org",
    });
  });

  it("never puts a secret in a script, a path or a log line", async () => {
    const t = setup();
    await t.run();
    const key = t.server.keys[0]!.AccessToken;
    for (const c of t.remote.calls) {
      expect(c.cmd).not.toContain(key);
      expect(c.cmd).not.toContain("me@example.org");
      if (c.cmd !== ENV) expect(c.stdin ?? "").not.toContain(key);
    }
    expect(t.lines.join("\n")).not.toContain(key);
    expect(t.lines.join("\n")).not.toContain("me@example.org");
  });

  it("is idempotent: with the image, env and compose in place it builds and copies nothing", async () => {
    const first = setup();
    await first.run();
    const written = Object.fromEntries(
      first.remote.calls.filter((c) => c.kind === "write").map((c) => [c.cmd, c.stdin!]),
    );
    const remote = new FakeRemoteHost({
      answers: answers([
        ["docker image inspect", { code: 0 }],
        [`cat '${ENV}'`, { stdout: written[ENV]! }],
        [`cat '${COMPOSE}'`, { stdout: written[COMPOSE]! }],
        ["cat '/srv/orca-hm/image'", { stdout: written["/srv/orca-hm/image"]! }],
        ["ufw status", { code: 0 }],
      ]),
    });
    const t = setup({ remote, secrets: Object.fromEntries(first.secrets.values) });
    t.server.keys = first.server.keys;
    await t.run();

    expect(remote.calls.some((c) => c.kind === "copy" || c.kind === "write")).toBe(false);
    expect(remote.scripts().some((s) => s.includes("docker build"))).toBe(false);
    expect(t.source.archived).toEqual([]);
    const start = remote.scripts().find((s) => s.includes("docker compose"))!;
    expect(start).toContain("up -d --no-deps orca-hm");
    expect(start).not.toContain("--force-recreate");
  });

  it("--dry-run changes nothing on the host and hides no read", async () => {
    const t = setup({ dryRun: true });
    await t.run();
    expect(t.remote.mutations()).toEqual([]);
    expect(t.server.keys).toEqual([]);
    expect(t.source.archived).toEqual([]);
    expect(t.lines.join("\n")).toContain("would");
    expect(t.lines.join("\n")).toContain("orca-hm:");
  });

  it("refuses when the host is not prepared", async () => {
    const remote = new FakeRemoteHost({ answers: answers([["id -u jellyfin", { code: 1 }]]) });
    await expect(setup({ remote }).run()).rejects.toThrow(/host prepare/);
  });

  it("makes the shared directories owned by the hm user and group jellyfin", async () => {
    const t = setup();
    await t.run();
    const prep = t.remote.scripts().find((s) => s.includes("useradd"))!;
    expect(prep).toContain("--gid jellyfin orca-hm");
    expect(prep).toContain("install -d -o orca-hm -g jellyfin -m 2775 /srv/jellyfin/media/tv");
    expect(prep).toContain("install -d -o orca-hm -g jellyfin -m 0750 /srv/orca-hm/data");
  });
});

describe("up with H&M", () => {
  it("keeps a deployed hm service in the file it regenerates", async () => {
    const remote = new FakeRemoteHost({
      answers: answers([["cat /srv/orca-hm/image", { stdout: `${IMAGE}\n` }]]),
    });
    const lines: string[] = [];
    await up({ remote, clock: new FakeClock(), log: (l) => lines.push(l) }, exampleConfig(withHm), {
      dryRun: false,
    });
    const write = remote.calls.find((c) => c.kind === "write")!;
    expect(write.stdin).toContain("orca-hm:");
  });

  it("writes the Jellyfin-only file when hm is configured but not deployed", async () => {
    const remote = new FakeRemoteHost({ answers: answers() });
    await up({ remote, clock: new FakeClock(), log: () => {} }, exampleConfig(withHm), {
      dryRun: false,
    });
    expect(remote.calls.find((c) => c.kind === "write")!.stdin).toBe(
      renderCompose(exampleConfig(), { uid: 998, gid: 997, renderGid: 991 }),
    );
  });
});

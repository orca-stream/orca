import { describe, expect, it } from "vite-plus/test";
import { up } from "../src/application/up.ts";
import { renderCompose } from "../src/domain/compose.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeRemoteHost, type Answer } from "./fakes/remote-host.ts";
import { exampleConfig } from "./fixtures.ts";

const COMPOSE = "/srv/jellyfin/compose.yaml";

function hostAnswers(extra: Answer[] = []): Answer[] {
  return [
    ...extra,
    ["id -u jellyfin", { stdout: "998\n" }],
    ["id -g jellyfin", { stdout: "998\n" }],
    ["getent group render", { stdout: "991\n" }],
    [`cat ${COMPOSE}`, { code: 1 }],
    ["docker inspect", (n) => ({ stdout: n < 3 ? "starting\n" : "healthy\n" })],
    ["vainfo", { stdout: "vainfo: Driver version: Mesa Gallium driver\nVAProfileH264Main" }],
  ];
}

function run(remote: FakeRemoteHost, opts: { dryRun?: boolean; patch?: (r: any) => void } = {}) {
  const lines: string[] = [];
  const clock = new FakeClock();
  const promise = up({ remote, clock, log: (l) => lines.push(l) }, exampleConfig(opts.patch), {
    dryRun: opts.dryRun ?? false,
  });
  return { promise, lines, clock };
}

describe("up", () => {
  it("writes the compose file, starts the stack, waits for health and verifies VA-API", async () => {
    const remote = new FakeRemoteHost({ answers: hostAnswers() });
    const { promise, clock } = run(remote);
    await promise;

    const write = remote.calls.find((c) => c.kind === "write")!;
    expect(write.cmd).toBe(COMPOSE);
    expect(write.sudo).toBe(true);
    expect(write.stdin).toBe(
      renderCompose(exampleConfig(), { uid: 998, gid: 998, renderGid: 991 }),
    );

    const scripts = remote.scripts();
    expect(scripts[0]).toContain("install -d -o jellyfin -g jellyfin");
    expect(scripts[0]).toContain("/srv/jellyfin/config");
    const upAt = scripts.findIndex((s) => s.includes(`docker compose -f ${COMPOSE} up -d`));
    expect(upAt).toBeGreaterThan(0);

    // Health was polled until "healthy", and vainfo came after.
    const order = remote.calls.map((c) => c.cmd);
    const lastInspect = order
      .map((c, i) => (c.includes("docker inspect") ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    const vainfoAt = order.findIndex((c) => c.includes("vainfo"));
    expect(vainfoAt).toBeGreaterThan(lastInspect);
    expect(order[vainfoAt]).toContain(
      "docker exec jellyfin /usr/lib/jellyfin-ffmpeg/vainfo --display drm --device /dev/dri/renderD128",
    );
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(2);
  });

  it("does not rewrite an identical compose file", async () => {
    const same = renderCompose(exampleConfig(), { uid: 998, gid: 998, renderGid: 991 });
    const remote = new FakeRemoteHost({
      answers: hostAnswers([[`cat ${COMPOSE}`, { stdout: same }]]),
    });
    await run(remote).promise;
    expect(remote.calls.some((c) => c.kind === "write")).toBe(false);
  });

  it("uses the render GID of the host and says so when the config disagrees", async () => {
    const remote = new FakeRemoteHost({
      answers: hostAnswers([["getent group render", { stdout: "992\n" }]]),
    });
    const { promise, lines } = run(remote);
    await promise;
    expect(remote.calls.find((c) => c.kind === "write")!.stdin).toContain('"992"');
    expect(lines.join("\n")).toMatch(/render.*992.*991/);
  });

  it("stops with a hint if host prepare has not run (no jellyfin user)", async () => {
    const remote = new FakeRemoteHost({ answers: hostAnswers([["id -u jellyfin", { code: 1 }]]) });
    await expect(run(remote).promise).rejects.toThrow(/host prepare/);
    expect(remote.mutations()).toEqual([]);
  });

  it("fails when VA-API does not work inside the container", async () => {
    const remote = new FakeRemoteHost({
      answers: hostAnswers([["vainfo", { code: 1, stderr: "libva error" }]]),
    });
    await expect(run(remote).promise).rejects.toThrow(/VA-API/);
  });

  it("times out if the container never becomes healthy", async () => {
    const remote = new FakeRemoteHost({
      answers: hostAnswers([["docker inspect", { stdout: "unhealthy\n" }]]),
    });
    await expect(run(remote).promise).rejects.toThrow(/healthy/);
  });

  it("with --dry-run changes nothing and skips the health wait", async () => {
    const remote = new FakeRemoteHost({ answers: hostAnswers() });
    const { promise, lines } = run(remote, { dryRun: true });
    await promise;
    expect(remote.mutations()).toEqual([]);
    expect(remote.calls.some((c) => c.cmd.includes("vainfo"))).toBe(false);
    expect(lines.join("\n")).toContain("jellyfin/jellyfin:12.2.20261005-225228");
  });
});

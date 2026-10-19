import { describe, expect, it } from "vite-plus/test";
import { hostPrepare } from "../src/application/host-prepare.ts";
import { up } from "../src/application/up.ts";
import { FakeClock } from "./fakes/clock.ts";
import { FakeRemoteHost } from "./fakes/remote-host.ts";
import { exampleConfig } from "./fixtures.ts";

/** Verbs that change a host. A script declared readOnly must contain none of them. */
const MUTATING =
  /\b(apt-get|useradd|systemctl\s+(enable|disable|reload|restart|start|stop|daemon-reload)|ufw\s+(allow|default|--force)|rm\s|mkdir|install\s+-|tee\s|sysctl\s+-p|mount\s+-a|chown|chmod|docker\s+compose|mv\s|cp\s)/;
const REDIRECT = />\s*(?!\/dev\/null|&)\S/;

function readOnlyScripts(remote: FakeRemoteHost): string[] {
  return remote.calls.filter((c) => c.kind === "exec" && c.readOnly).map((c) => c.cmd);
}

describe("read-only scripts", () => {
  it("host prepare never labels a mutating script as read-only", async () => {
    for (const probes of ["pass", "fail"] as const) {
      const remote = new FakeRemoteHost({ probes });
      await hostPrepare({ remote, log: () => {} }, exampleConfig(), {
        dryRun: false,
        withDisk: false,
      }).catch(() => {});
      const scripts = readOnlyScripts(remote);
      expect(scripts.length).toBeGreaterThan(5);
      for (const s of scripts) {
        expect(s, s).not.toMatch(MUTATING);
        expect(s, s).not.toMatch(REDIRECT);
      }
    }
  });

  it("host prepare in a dry run lets nothing but read-only scripts reach the host", async () => {
    const remote = new FakeRemoteHost({ probes: "fail" });
    await hostPrepare({ remote, log: () => {} }, exampleConfig(), {
      dryRun: true,
      withDisk: false,
    });
    expect(remote.mutations()).toEqual([]);
  });

  it("up never labels a mutating script as read-only", async () => {
    const remote = new FakeRemoteHost({
      answers: [
        ["id -u", { stdout: "998" }],
        ["id -g", { stdout: "998" }],
        ["getent", { stdout: "991" }],
        ["cat ", { code: 1 }],
        ["docker inspect", { stdout: "healthy" }],
      ],
    });
    await up({ remote, clock: new FakeClock(), log: () => {} }, exampleConfig(), { dryRun: false });
    for (const s of readOnlyScripts(remote)) {
      expect(s, s).not.toMatch(MUTATING);
      expect(s, s).not.toMatch(REDIRECT);
    }
  });
});

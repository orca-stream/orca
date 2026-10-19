import { describe, expect, it } from "vite-plus/test";
import { hostPrepare } from "../src/application/host-prepare.ts";
import { FakeRemoteHost, type Answer } from "./fakes/remote-host.ts";
import { exampleConfig } from "./fixtures.ts";

const SSHD = "/etc/ssh/sshd_config.d/10-bifrost.conf";

function run(
  remote: FakeRemoteHost,
  opts: { dryRun?: boolean; withDisk?: boolean; patch?: (r: any) => void } = {},
) {
  const lines: string[] = [];
  const cfg = exampleConfig(opts.patch);
  const promise = hostPrepare({ remote, log: (l) => lines.push(l) }, cfg, {
    dryRun: opts.dryRun ?? false,
    withDisk: opts.withDisk ?? false,
  });
  return { promise, lines };
}

describe("hostPrepare", () => {
  /** The sshd probe says "not hardened" the first time and "hardened" once the drop-in is live. */
  const hardenedAfterReload: Answer = ["sshd -T", (n) => ({ code: n === 1 ? 1 : 0 })];

  it("installs everything on a fresh host, every change through sudo", async () => {
    const remote = new FakeRemoteHost({ probes: "fail", answers: [hardenedAfterReload] });
    await run(remote).promise;

    const scripts = remote.scripts().join("\n");
    expect(scripts).toContain(
      "apt-get install -y -qq ca-certificates curl ufw restic unattended-upgrades",
    );
    expect(scripts).toContain("download.docker.com/linux/ubuntu");
    expect(scripts).toMatch(
      /docker-ce docker-ce-cli containerd\.io docker-buildx-plugin docker-compose-plugin/,
    );
    expect(scripts).toContain("useradd --system");
    expect(remote.calls.filter((c) => !c.readOnly).every((c) => c.sudo)).toBe(true);

    const written = Object.fromEntries(
      remote.calls.filter((c) => c.kind === "write").map((c) => [c.cmd, c.stdin]),
    );
    expect(written["/etc/sysctl.d/60-bifrost.conf"]).toBe("net.ipv4.ip_nonlocal_bind=1\n");
    expect(written[SSHD]).toContain("PasswordAuthentication no");
    expect(written[SSHD]).toContain("PermitRootLogin no");
  });

  it("adds the ufw SSH rule before enabling the firewall, and before touching sshd", async () => {
    const remote = new FakeRemoteHost({ probes: "fail", answers: [hardenedAfterReload] });
    await run(remote).promise;

    const rule = "ufw allow from 192.168.1.0/24 to any port 22 proto tcp";
    const ufw = remote.scripts().find((s) => s.includes("ufw --force enable"))!;
    expect(ufw.indexOf(rule)).toBeGreaterThan(-1);
    expect(ufw.indexOf(rule)).toBeLessThan(ufw.indexOf("ufw --force enable"));
    const order = remote.calls.filter((c) => !c.readOnly).map((c) => c.cmd);
    expect(order.indexOf(SSHD)).toBeGreaterThan(
      order.findIndex((c) => c.includes("ufw --force enable")),
    );
  });

  it("never mutates a host whose probes all say it is already done", async () => {
    const remote = new FakeRemoteHost({ probes: "pass" });
    await run(remote).promise;
    expect(remote.mutations()).toEqual([]);
    expect(remote.calls.length).toBeGreaterThan(5);
  });

  it("with --dry-run runs only the probes", async () => {
    const remote = new FakeRemoteHost({ probes: "fail" });
    const { promise, lines } = run(remote, { dryRun: true });
    await promise;
    expect(remote.mutations()).toEqual([]);
    expect(lines.join("\n")).toMatch(/would/i);
  });

  it("asks for passwordless sudo when it is missing", async () => {
    const remote = new FakeRemoteHost({
      answers: [["sudo -n true", { code: 1, stderr: "a password is required" }]],
    });
    await expect(run(remote).promise).rejects.toThrow(/sudo/);
    expect(remote.mutations()).toEqual([]);
  });

  describe("sshd hardening", () => {
    const unhardened = (extra: ConstructorParameters<typeof FakeRemoteHost>[0] = {}) =>
      new FakeRemoteHost({
        ...extra,
        probes: "pass",
        answers: [["sshd -T", { code: 1 }], ...(extra.answers ?? [])],
      });

    it("refuses to touch sshd when key login does not work", async () => {
      const remote = unhardened({ keyLogins: [false] });
      await expect(run(remote).promise).rejects.toThrow(/key/i);
      expect(remote.mutations()).toEqual([]);
    });

    it("removes the drop-in and aborts when `sshd -t` fails", async () => {
      const remote = unhardened({ answers: [["sshd -t", { code: 1, stderr: "bad config" }]] });
      await expect(run(remote).promise).rejects.toThrow(/sshd -t/);
      const mutations = remote.mutations().map((c) => `${c.kind}:${c.cmd}`);
      expect(mutations[0]).toBe(`write:${SSHD}`);
      expect(mutations.some((m) => m.includes("rm -f") && m.includes(SSHD))).toBe(true);
      expect(mutations.some((m) => m.includes("systemctl reload ssh"))).toBe(false);
    });

    it("reverts and aborts when a fresh key login fails after the reload", async () => {
      const remote = unhardened({ keyLogins: [true, false] });
      await expect(run(remote).promise).rejects.toThrow(/reverted/i);
      const scripts = remote.scripts();
      const reloads = scripts.filter((s) => s.includes("systemctl reload ssh"));
      expect(reloads).toHaveLength(2); // once to apply, once to undo
      expect(scripts.some((s) => s.includes("rm -f") && s.includes(SSHD))).toBe(true);
    });

    it("hardens, reloads and verifies on success", async () => {
      const remote = new FakeRemoteHost({ probes: "pass", answers: [hardenedAfterReload] });
      await run(remote).promise;
      expect(remote.scripts().filter((s) => s.includes("systemctl reload ssh"))).toHaveLength(1);
    });
  });

  describe("media disk", () => {
    const withDisk = (r: any) => {
      r.host.mediaDisk = { uuid: "1234-ABCD", mount: "/mnt/media" };
    };

    it("is left alone without --with-disk, even when configured", async () => {
      const remote = new FakeRemoteHost({ probes: "fail", answers: [["sshd -T", { code: 0 }]] });
      await run(remote, { patch: withDisk }).promise;
      expect(JSON.stringify(remote.calls)).not.toContain("1234-ABCD");
    });

    it("is mounted by UUID with nofail when asked for", async () => {
      const remote = new FakeRemoteHost({ probes: "fail", answers: [["sshd -T", { code: 0 }]] });
      await run(remote, { patch: withDisk, withDisk: true }).promise;
      const script = remote.scripts().find((s) => s.includes("1234-ABCD"))!;
      expect(script).toContain(
        "UUID=1234-ABCD /mnt/media ext4 defaults,nofail,x-systemd.device-timeout=10 0 2",
      );
      expect(script).toContain("blkid -U 1234-ABCD");
      expect(script).toContain("mount -a");
    });

    it("complains if --with-disk is passed but the config has no mediaDisk", async () => {
      const remote = new FakeRemoteHost();
      await expect(run(remote, { withDisk: true }).promise).rejects.toThrow(/mediaDisk/);
      expect(remote.mutations()).toEqual([]);
    });
  });
});

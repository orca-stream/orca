import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { baseSshArgs, shQuote, SshRemoteHost } from "../src/infrastructure/ssh-remote-host.ts";

/** A stand-in for `ssh`/`scp`: logs its arguments, then runs the remote command (last arg) locally. */
function stubs() {
  const dir = mkdtempSync(join(tmpdir(), "bifrost-ssh-"));
  const log = join(dir, "args.log");
  const ssh = join(dir, "ssh");
  writeFileSync(ssh, `#!/bin/sh\nfor last; do :; done\necho "$@" >> ${log}\nexec sh -c "$last"\n`);
  chmodSync(ssh, 0o755);
  // scp: ... <local> <host:remote>; copy local to the remote path as if it were local.
  const scp = join(dir, "scp");
  writeFileSync(
    scp,
    `#!/bin/sh\nfor a; do prev2=$prev; prev=$a; done\necho "$@" >> ${log}\nlocal=$prev2; remote=\${prev#*:}\ncp "$local" "$remote"\n`,
  );
  chmodSync(scp, 0o755);
  const host = new SshRemoteHost({ target: "user@192.168.1.10", ssh, scp });
  return { dir, host, args: () => readFileSync(log, "utf8") };
}

describe("shQuote", () => {
  it("single-quotes, including embedded quotes", () => {
    expect(shQuote("a b")).toBe("'a b'");
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("baseSshArgs", () => {
  it("never prompts, times out, reuses one connection and trusts a host on first sight only", () => {
    const joined = baseSshArgs().join(" ");
    expect(joined).toContain("BatchMode=yes");
    expect(joined).toContain("ConnectTimeout=10");
    expect(joined).toContain("ControlMaster=auto");
    expect(joined).toContain("ControlPersist=60");
    expect(joined).toContain("StrictHostKeyChecking=accept-new");
  });
});

describe("SshRemoteHost", () => {
  it("pipes the script to bash -se and returns code, stdout and stderr", async () => {
    const { host, args } = stubs();
    const res = await host.exec("echo out; echo err >&2; exit 3");
    expect(res).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
    expect(args()).toContain("user@192.168.1.10");
    expect(args().trim().endsWith("bash -se")).toBe(true);
  });

  it("asks for sudo -n when told to", async () => {
    const { host, args } = stubs();
    // The stub would run `sudo -n bash -se` locally; a missing sudo still proves what was asked for.
    await host.exec("true", { sudo: true });
    expect(args().trim().endsWith("sudo -n bash -se")).toBe(true);
  });

  it("writes a file with the private mode set before the content lands", async () => {
    const { host, dir } = stubs();
    const target = join(dir, "secret");
    await host.writeFile(target, "s3cret\n", { mode: "0600" });
    expect(readFileSync(target, "utf8")).toBe("s3cret\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("copies a local file through scp", async () => {
    const { host, dir } = stubs();
    const local = join(dir, "local.zip");
    writeFileSync(local, "zip");
    const dest = join(dir, "dest.zip");
    await host.copyTo(local, dest);
    expect(readFileSync(dest, "utf8")).toBe("zip");
  });

  it("checks key login on a brand-new connection with passwords off", async () => {
    const { host, args } = stubs();
    expect(await host.verifyKeyLogin()).toBe(true);
    const line = args().trim().split("\n").pop()!;
    expect(line).toContain("ControlPath=none");
    expect(line).toContain("PasswordAuthentication=no");
    expect(line).not.toContain("ControlMaster=auto");
  });
});

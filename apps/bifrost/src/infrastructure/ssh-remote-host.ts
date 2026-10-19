import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { ExecOptions, ExecResult, RemoteHost } from "../application/ports/remote-host.ts";
import { BifrostError } from "../domain/errors.ts";
import { shQuote } from "../domain/shell.ts";

/**
 * Options for every connection: never prompt, give up fast, reuse one TCP connection for the many
 * short commands a run makes, and trust a host key only the first time it is seen.
 */
export function baseSshArgs(): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPath=~/.ssh/cm-%C",
    "-o",
    "ControlPersist=60",
  ];
}

function run(cmd: string, args: string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.stdin.on("error", () => {
      // The remote end closed early (e.g. a failed login): the exit code tells the story.
    });
    child.on("error", (e) => reject(new BifrostError(`Could not run ${cmd}: ${e.message}`)));
    child.on("close", (code) => resolve({ code: code ?? 255, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

export interface SshRemoteHostOptions {
  /** `user@address`. */
  target: string;
  /** Binary overrides, for tests. */
  ssh?: string;
  scp?: string;
}

/**
 * A host reached through the system `ssh` and `scp`: they read ~/.ssh/config, the agent and
 * known_hosts for free. Scripts travel over stdin to `bash -se`, so there is no quoting to get wrong.
 */
export class SshRemoteHost implements RemoteHost {
  private readonly target: string;
  private readonly ssh: string;
  private readonly scp: string;

  constructor(opts: SshRemoteHostOptions) {
    this.target = opts.target;
    this.ssh = opts.ssh ?? "ssh";
    this.scp = opts.scp ?? "scp";
  }

  private remote(command: string, stdin?: string): Promise<ExecResult> {
    return run(this.ssh, [...baseSshArgs(), this.target, command], stdin);
  }

  exec(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return this.remote(opts.sudo ? "sudo -n bash -se" : "bash -se", script);
  }

  async writeFile(
    path: string,
    content: string,
    opts: { sudo?: boolean; mode?: string } = {},
  ): Promise<void> {
    const mode = opts.mode ?? "0644";
    if (!/^[0-7]{3,4}$/.test(mode)) throw new BifrostError(`Invalid file mode: ${mode}`);
    const sudo = opts.sudo ? "sudo -n " : "";
    const p = shQuote(path);
    // Create the file with its final mode first, so a secret is never briefly world-readable.
    const res = await this.remote(
      `${sudo}install -m ${mode} /dev/null ${p} && ${sudo}tee ${p} >/dev/null`,
      content,
    );
    if (res.code !== 0) throw new BifrostError(`Could not write ${path}: ${res.stderr.trim()}`);
  }

  async copyTo(
    localPath: string,
    remotePath: string,
    opts: { sudo?: boolean } = {},
  ): Promise<void> {
    const scpTo = async (dest: string) => {
      const res = await run(this.scp, [
        "-q",
        ...baseSshArgs(),
        localPath,
        `${this.target}:${dest}`,
      ]);
      if (res.code !== 0) throw new BifrostError(`scp ${localPath} failed: ${res.stderr.trim()}`);
    };
    if (!opts.sudo) return scpTo(remotePath);
    // A root-owned destination cannot be written by scp as the login user: stage it, then move it.
    const staged = `/tmp/bifrost-${randomBytes(6).toString("hex")}`;
    // The zip holds password hashes: create the staging file private before scp fills it.
    const made = await this.remote(`umask 077 && install -m 0600 /dev/null ${shQuote(staged)}`);
    if (made.code !== 0)
      throw new BifrostError(`Could not stage ${localPath}: ${made.stderr.trim()}`);
    await scpTo(staged);
    const res = await this.exec(
      `install -m 0644 ${shQuote(staged)} ${shQuote(remotePath)}; rm -f ${shQuote(staged)}`,
      {
        sudo: true,
      },
    );
    if (res.code !== 0)
      throw new BifrostError(`Could not place ${remotePath}: ${res.stderr.trim()}`);
  }

  async verifyKeyLogin(): Promise<boolean> {
    const res = await run(this.ssh, [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      this.target,
      "true",
    ]);
    return res.code === 0;
  }
}

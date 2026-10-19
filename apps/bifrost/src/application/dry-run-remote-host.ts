import type { ExecOptions, ExecResult, RemoteHost } from "./ports/remote-host.ts";

/** Lets read-only scripts through and only describes everything else, so a dry run cannot change the host. */
export class DryRunRemoteHost implements RemoteHost {
  private readonly inner: RemoteHost;
  private readonly log: (line: string) => void;

  constructor(inner: RemoteHost, log: (line: string) => void) {
    this.inner = inner;
    this.log = log;
  }

  async exec(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (opts.readOnly) return this.inner.exec(script, opts);
    this.log(
      `would run${opts.sudo ? " (sudo)" : ""}: ${script.trim().split("\n")[0]}${script.trim().includes("\n") ? " ..." : ""}`,
    );
    return { code: 0, stdout: "", stderr: "" };
  }

  async writeFile(path: string, _content: string, opts: { sudo?: boolean; mode?: string } = {}) {
    this.log(`would write${opts.sudo ? " (sudo)" : ""}: ${path}`);
  }

  async copyTo(localPath: string, remotePath: string) {
    this.log(`would copy: ${localPath} -> ${remotePath}`);
  }

  verifyKeyLogin() {
    return this.inner.verifyKeyLogin();
  }
}

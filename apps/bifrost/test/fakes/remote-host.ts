import type {
  ExecOptions,
  ExecResult,
  RemoteHost,
} from "../../src/application/ports/remote-host.ts";

export interface Call {
  kind: "exec" | "write" | "copy";
  /** The script for exec; the destination path for write and copy. */
  cmd: string;
  sudo: boolean;
  readOnly: boolean;
  /** File content for write; the local path for copy. */
  stdin?: string;
}

/** A result, or a function of how many times this answer has matched so far (1 on the first). */
export type Answer = [
  match: RegExp | string,
  result: Partial<ExecResult> | ((n: number) => Partial<ExecResult>),
];

/**
 * Records everything and answers from a script. Read-only scripts (probes) answer "already done"
 * (exit 0) unless `probes: "fail"`; everything else succeeds. `answers` override both, first match wins.
 */
export class FakeRemoteHost implements RemoteHost {
  calls: Call[] = [];
  answers: Answer[];
  private hits = new Map<Answer, number>();
  probes: "pass" | "fail";
  /** Results for successive verifyKeyLogin() calls; the last one repeats. */
  keyLogins: boolean[];

  constructor(opts: { probes?: "pass" | "fail"; answers?: Answer[]; keyLogins?: boolean[] } = {}) {
    this.probes = opts.probes ?? "pass";
    this.answers = opts.answers ?? [];
    this.keyLogins = opts.keyLogins ?? [true];
  }

  async exec(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
    this.calls.push({ kind: "exec", cmd: script, sudo: !!opts.sudo, readOnly: !!opts.readOnly });
    for (const answer of this.answers) {
      const [match, result] = answer;
      if (typeof match === "string" ? script.includes(match) : match.test(script)) {
        const n = (this.hits.get(answer) ?? 0) + 1;
        this.hits.set(answer, n);
        return {
          code: 0,
          stdout: "",
          stderr: "",
          ...(typeof result === "function" ? result(n) : result),
        };
      }
    }
    const isSudoCheck = script === "sudo -n true";
    const code = opts.readOnly && !isSudoCheck && this.probes === "fail" ? 1 : 0;
    return { code, stdout: "", stderr: "" };
  }

  async writeFile(path: string, content: string, opts: { sudo?: boolean; mode?: string } = {}) {
    this.calls.push({
      kind: "write",
      cmd: path,
      sudo: !!opts.sudo,
      readOnly: false,
      stdin: content,
    });
  }

  async copyTo(localPath: string, remotePath: string, opts: { sudo?: boolean } = {}) {
    this.calls.push({
      kind: "copy",
      cmd: remotePath,
      sudo: !!opts.sudo,
      readOnly: false,
      stdin: localPath,
    });
  }

  async verifyKeyLogin() {
    return this.keyLogins.length > 1 ? this.keyLogins.shift()! : this.keyLogins[0]!;
  }

  /** Everything that is not a read-only exec. */
  mutations(): Call[] {
    return this.calls.filter((c) => c.kind !== "exec" || !c.readOnly);
  }

  scripts(): string[] {
    return this.calls.filter((c) => c.kind === "exec" && !c.readOnly).map((c) => c.cmd);
  }
}

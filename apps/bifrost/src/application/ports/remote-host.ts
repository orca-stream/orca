export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Run through `sudo -n`. */
  sudo?: boolean;
  /** The script only looks, it changes nothing. Dry runs execute read-only scripts and skip the rest. */
  readOnly?: boolean;
}

/** A machine reached over SSH. Scripts are bash; the adapter decides how they travel. */
export interface RemoteHost {
  exec(script: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Writes `content` to `path` on the host. `mode` is an octal string such as "0600". */
  writeFile(path: string, content: string, opts?: { sudo?: boolean; mode?: string }): Promise<void>;
  /** Copies a local file to the host. With `sudo` the destination may be root-owned. */
  copyTo(localPath: string, remotePath: string, opts?: { sudo?: boolean }): Promise<void>;
  /** True when a brand-new connection (no shared master, no password) logs in with a key. */
  verifyKeyLogin(): Promise<boolean>;
}

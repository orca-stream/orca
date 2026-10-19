import { spawn } from "node:child_process";
import { MediaProbeError, type ProbeResult } from "./types.ts";

/** Port: looks inside a stream and says which tracks it has. hm-server depends on this shape. */
export interface StreamInspector {
  inspect(
    url: string,
    options: { signal: AbortSignal; headers?: Record<string, string> },
  ): Promise<ProbeResult>;
}

const FFPROBE_COMMAND = "ffprobe";
/** Enough for HLS and DASH over the network; `file:` and friends stay out of reach of a page's URL. */
const DEFAULT_PROTOCOL_WHITELIST = "http,https,tcp,tls,crypto";
/** ffprobe JSON of a long stream stays far below this; more means something is wrong. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_CHARS = 2000;

export function buildFfprobeArgs(
  url: string,
  headers: Record<string, string>,
  protocolWhitelist: string,
  viaProxy = false,
): string[] {
  const entries = Object.entries(headers);
  for (const [name, value] of entries) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value) || name.includes(":")) {
      throw new MediaProbeError("invalid", `Invalid header "${name}"`);
    }
  }
  const headerArgs =
    entries.length === 0
      ? []
      : ["-headers", entries.map(([name, value]) => `${name}: ${value}\r\n`).join("")];
  return [
    "-v",
    "error",
    "-protocol_whitelist",
    // Reaching the proxy is its own protocol in ffmpeg.
    viaProxy ? `${protocolWhitelist},httpproxy` : protocolWhitelist,
    ...headerArgs,
    "-show_programs",
    "-show_streams",
    "-of",
    "json",
    url,
  ];
}

/** `env` is the child's environment when it differs from ours (a proxy), else undefined. */
export type RunFfprobe = (
  args: string[],
  signal: AbortSignal,
  env?: NodeJS.ProcessEnv,
) => Promise<{ stdout: string }>;

export interface FfprobeInspectorOptions {
  ffprobePath?: string;
  protocolWhitelist?: string;
  /**
   * Fetch everything through this HTTP proxy (`http://user:pass@host:port`), redirects and segments
   * included. It reaches ffprobe through its `http_proxy` environment variable, not its arguments,
   * so the credentials do not show in `ps`.
   */
  httpProxy?: string;
  /** Kill ffprobe after this long. Absent: only the caller's signal stops it. */
  timeoutMs?: number;
  /** Replaces the process spawn. Meant for tests. */
  run?: RunFfprobe;
}

export class FfprobeInspector implements StreamInspector {
  private readonly ffprobePath: string;
  private readonly protocolWhitelist: string;
  private readonly httpProxy: string | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly run: RunFfprobe;

  constructor(options: FfprobeInspectorOptions = {}) {
    this.ffprobePath = options.ffprobePath ?? FFPROBE_COMMAND;
    this.protocolWhitelist = options.protocolWhitelist ?? DEFAULT_PROTOCOL_WHITELIST;
    this.httpProxy = options.httpProxy;
    this.timeoutMs = options.timeoutMs;
    this.run = options.run ?? ((args, signal, env) => this.spawnFfprobe(args, signal, env));
  }

  async inspect(
    url: string,
    options: { signal: AbortSignal; headers?: Record<string, string> },
  ): Promise<ProbeResult> {
    if (options.signal.aborted) throw new MediaProbeError("aborted", "Inspection aborted");
    const args = buildFfprobeArgs(
      url,
      options.headers ?? {},
      this.protocolWhitelist,
      this.httpProxy !== undefined,
    );
    const env =
      this.httpProxy === undefined
        ? undefined
        : // Nothing is exempt from the proxy, whatever the machine's own settings say.
          { ...process.env, http_proxy: this.httpProxy, no_proxy: "", NO_PROXY: "" };
    const timeout = this.timeoutMs === undefined ? undefined : AbortSignal.timeout(this.timeoutMs);
    const signal = timeout ? AbortSignal.any([options.signal, timeout]) : options.signal;

    let stdout: string;
    try {
      ({ stdout } = await this.run(args, signal, env));
    } catch (error) {
      if (error instanceof MediaProbeError) throw error;
      if (timeout?.aborted) {
        throw new MediaProbeError("timeout", `ffprobe took longer than ${this.timeoutMs} ms`, {
          cause: error,
        });
      }
      if (options.signal.aborted) {
        throw new MediaProbeError("aborted", "Inspection aborted", { cause: error });
      }
      throw new MediaProbeError("spawn", "Could not run ffprobe", { cause: error });
    }

    try {
      const parsed = JSON.parse(stdout) as ProbeResult;
      if (!Array.isArray(parsed.streams)) throw new Error("no streams array");
      return parsed;
    } catch (cause) {
      throw new MediaProbeError("parse", "ffprobe printed something that is not stream JSON", {
        cause,
      });
    }
  }

  private spawnFfprobe(
    args: string[],
    signal: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffprobePath, args, {
        signal,
        stdio: ["ignore", "pipe", "pipe"],
        ...(env ? { env } : {}),
      });
      const out: Buffer[] = [];
      let size = 0;
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_STDOUT_BYTES) child.kill();
        else out.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (size > MAX_STDOUT_BYTES) {
          reject(new MediaProbeError("parse", "ffprobe output is too large"));
        } else if (code === 0) {
          resolve({ stdout: Buffer.concat(out).toString("utf8") });
        } else {
          reject(new MediaProbeError("exit", `ffprobe exited with ${code}: ${stderr.trim()}`));
        }
      });
    });
  }
}

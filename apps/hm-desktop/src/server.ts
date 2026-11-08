import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";

/** Where the desktop app keeps the server: its files, its data and its log. */
export interface ServerLayout {
  /** The staged server: dist/, drizzle/, node_modules/ and the panel in public/. */
  serverDir: string;
  dataDir: string;
  logFile: string;
}

/** The server's own default port, so the panel answers where it always has. */
export const SERVER_PORT = 8787;
/** The app is for the person at this computer: the panel only answers here. */
export const SERVER_HOST = "127.0.0.1";
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 250;
const STOP_TIMEOUT_MS = 5_000;

export type StartFailure =
  | { reason: "port-busy" }
  | { reason: "exited"; code: number }
  | { reason: "timeout" };

export class StartError extends Error {
  readonly failure: StartFailure;

  constructor(failure: StartFailure) {
    super(`The server did not start: ${failure.reason}`);
    this.failure = failure;
  }
}

/** Whether something already listens on the port, before the server finds out the hard way. */
function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

export class ServerProcess {
  private child: UtilityProcess | undefined;
  private exited: Promise<number> | undefined;
  private readonly layout: ServerLayout;

  constructor(layout: ServerLayout) {
    this.layout = layout;
  }

  get url(): string {
    return `http://${SERVER_HOST}:${SERVER_PORT}/`;
  }

  /** Starts the server with `env` (the app's own, plus its tools) and resolves once it answers /health. */
  async start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (!(await portIsFree(SERVER_PORT, SERVER_HOST)))
      throw new StartError({ reason: "port-busy" });
    mkdirSync(this.layout.dataDir, { recursive: true });
    mkdirSync(dirname(this.layout.logFile), { recursive: true });
    const log = createWriteStream(this.layout.logFile, { flags: "a" });

    const child = utilityProcess.fork(join(this.layout.serverDir, "dist/main.mjs"), [], {
      cwd: this.layout.serverDir,
      serviceName: "Orca'H&M server",
      stdio: "pipe",
      env: {
        ...env,
        NODE_ENV: "production",
        HOST: SERVER_HOST,
        PORT: String(SERVER_PORT),
        DB_FILE: join(this.layout.dataDir, "hm.sqlite"),
        WEB_ROOT: join(this.layout.serverDir, "public"),
      },
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        log.write(chunk);
        process.stdout.write(chunk);
      });
    }
    this.child = child;
    this.exited = new Promise((resolve) =>
      child.once("exit", (code) => {
        this.child = undefined;
        log.end();
        resolve(code);
      }),
    );

    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let gone: number | undefined;
    void this.exited.then((code) => (gone = code));
    while (Date.now() < deadline) {
      if (gone !== undefined) throw new StartError({ reason: "exited", code: gone });
      try {
        const response = await fetch(new URL("health", this.url));
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
    throw new StartError({ reason: "timeout" });
  }

  /** Asks the server to shut down (SIGTERM: it finishes its writes), then kills it if it lingers. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.exited) return;
    child.kill();
    const timer = new Promise<"late">((resolve) =>
      setTimeout(() => resolve("late"), STOP_TIMEOUT_MS),
    );
    if ((await Promise.race([this.exited, timer])) === "late" && child.pid) {
      process.kill(child.pid, "SIGKILL");
    }
  }
}

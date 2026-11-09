// Tries the working tree in the desktop app, with the installed app's data (its userData folder):
// quits whichever Orca'H&M is running (installed or a previous try), stages the server and the
// panel, and opens the app from source. The fast loop for changes that must be seen in the app.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

/** The app's server port and host (src/server.ts): free once the running app has quit. */
const SERVER_PORT = 8787;
const SERVER_HOST = "127.0.0.1";
const QUIT_TIMEOUT_MS = 15_000;

const desktopRoot = resolve(import.meta.dirname, "..");

/** Main processes of a running Orca'H&M: the installed binary, or Electron started from here. */
function runningApps(): number[] {
  if (process.platform !== "linux") return [];
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      // Chromium rewrites its process title: one string with spaces, not NUL-separated arguments.
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/).filter(Boolean);
      if (argv.length === 0 || argv.some((arg) => arg.startsWith("--type="))) continue;
      const installed = argv[0].endsWith("/orca-hm");
      const fromSource =
        /[/\\]electron$/.test(argv[0]) && readlinkSync(`/proc/${pid}/cwd`) === desktopRoot;
      if (installed || fromSource) pids.push(pid);
    } catch {
      // Gone meanwhile, or not ours to read.
    }
  }
  return pids;
}

function portInUse(): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port: SERVER_PORT, host: SERVER_HOST });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function quitRunningApps(): Promise<void> {
  const pids = runningApps();
  for (const pid of pids) process.kill(pid, "SIGTERM");
  if (pids.length > 0) console.log(`Quitting the running Orca'H&M (${pids.join(", ")})…`);
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (await portInUse()) {
    if (Date.now() > deadline)
      throw new Error(`Port ${SERVER_PORT} is still taken: close what holds it and try again.`);
    await new Promise((wait) => setTimeout(wait, 250));
  }
}

function pnpm(...args: string[]): void {
  execFileSync("pnpm", args, { cwd: desktopRoot, stdio: "inherit" });
}

await quitRunningApps();
pnpm("stage:server");
pnpm("build");
// In the foreground: Ctrl+C quits the app, and its server's log stays in this terminal. On Linux it
// gets the X11 switch here, or it relaunches itself with it (src/main.ts) and leaves the terminal.
const electronArgs = [".", "--no-sandbox"];
if (process.platform === "linux") electronArgs.push("--ozone-platform=x11");
process.exitCode =
  spawnSync("pnpm", ["exec", "electron", ...electronArgs], { cwd: desktopRoot, stdio: "inherit" })
    .status ?? 1;

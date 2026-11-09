// Stages the server and its panel into build/hm-server, the folder electron-builder ships as an
// extra resource. The server keeps its own node_modules (a `pnpm deploy`, as in its Dockerfile).
// better-sqlite3 needs no rebuild for Electron: it ships Node-API prebuilds, which any runtime loads.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const out = resolve(desktopRoot, "build/hm-server");

function pnpm(...args: string[]): void {
  // On Windows pnpm is a `.cmd`, which only a shell runs (the arguments here are all fixed).
  execFileSync("pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

rmSync(out, { recursive: true, force: true });
pnpm("--filter", "@orca/hm-server", "build");
pnpm("--filter", "@orca/hm-web", "build");
// Hoisted: plain folders, no symlinks into a virtual store, which the Windows installer cannot keep.
pnpm("--filter", "@orca/hm-server", "deploy", "--prod", "--config.node-linker=hoisted", out);
cpSync(resolve(repoRoot, "apps/hm-web/dist"), resolve(out, "public"), { recursive: true });
// What `pnpm deploy` leaves to reinstall the folder; the app never runs pnpm.
rmSync(resolve(out, "pnpm-lock.yaml"), { force: true });
rmSync(resolve(out, "pnpm-workspace.yaml"), { force: true });
// The server reports its package's version (to Jellyfin, in its log): make it the app's.
const readJson = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const { version } = readJson(resolve(desktopRoot, "package.json"));
const serverManifest = resolve(out, "package.json");
writeFileSync(
  serverManifest,
  `${JSON.stringify({ ...readJson(serverManifest), version }, null, 2)}\n`,
);

console.log(`Staged the server ${String(version)} in ${out}`);

// The browser the server's detector runs, installed on the app's first start by Playwright's own
// installer: the one in the server's node_modules, so it is always the build that Playwright version
// pins. Headless, Playwright runs its "headless shell", so that is all that is installed.
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** What `orca-installed.json` says: the Playwright version whose browser is in the folder. */
export const CHROMIUM_MARKER = "orca-installed.json";
const MARKER = CHROMIUM_MARKER;

/** One line of Playwright's progress when its output is not a terminal: `|■■■   |  30% of 110.9 MiB`. */
const PROGRESS = /\|\s*(\d{1,3})% of ([\d.]+) MiB/;
/** Each file it fetches starts with `Downloading <name> … from <url>`. */
const STARTS = /^Downloading /;
const MIB = 1024 * 1024;

export interface ChromiumProgress {
  received: number;
  total: number;
}

/**
 * Follows the installer's output across the files it fetches (the headless shell, then a small
 * ffmpeg of its own): the bytes of the finished ones plus the share of the current one.
 */
export class ProgressReader {
  private done = 0;
  private current = { received: 0, total: 0 };

  /** The progress so far after one line of output, or undefined when the line says nothing new. */
  read(line: string): ChromiumProgress | undefined {
    if (STARTS.test(line)) {
      this.done += this.current.total;
      this.current = { received: 0, total: 0 };
      return undefined;
    }
    const match = PROGRESS.exec(line);
    if (!match) return undefined;
    const total = Number(match[2]) * MIB;
    this.current = { received: (Number(match[1]) / 100) * total, total };
    return { received: this.done + this.current.received, total: this.done + total };
  }
}

/** The Playwright version the server was staged with. */
export async function playwrightVersion(serverDir: string): Promise<string> {
  const manifest = join(serverDir, "node_modules/playwright/package.json");
  return (JSON.parse(await readFile(manifest, "utf8")) as { version: string }).version;
}

export async function chromiumInstalled(browsersDir: string, version: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(browsersDir, MARKER), "utf8")) as {
      playwright?: unknown;
    };
    return marker.playwright === version;
  } catch {
    return false;
  }
}

export interface InstallChromiumOptions {
  serverDir: string;
  browsersDir: string;
  version: string;
  onProgress: (progress: ChromiumProgress) => void;
  signal: AbortSignal;
  /** The Node that runs the installer: Electron itself, as Node. */
  nodePath?: string;
}

/**
 * Runs `playwright install chromium-headless-shell` into `browsersDir`. Playwright writes its own
 * "installation complete" mark per browser and removes the builds no installed version uses any
 * more; our mark only spares the next start from running the installer at all.
 */
export async function installChromium(options: InstallChromiumOptions): Promise<void> {
  const { serverDir, browsersDir, version, signal } = options;
  await mkdir(browsersDir, { recursive: true });
  const cli = join(serverDir, "node_modules/playwright/cli.js");
  const child = spawn(
    options.nodePath ?? process.execPath,
    [cli, "install", "chromium-headless-shell"],
    {
      cwd: serverDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PLAYWRIGHT_BROWSERS_PATH: browsersDir },
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    },
  );
  const reader = new ProgressReader();
  const tail: string[] = [];
  const remember = (line: string) => {
    tail.push(line);
    if (tail.length > 5) tail.shift();
  };
  createInterface({ input: child.stdout }).on("line", (line) => {
    remember(line);
    const progress = reader.read(line);
    if (progress) options.onProgress(progress);
  });
  createInterface({ input: child.stderr }).on("line", remember);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`Playwright's installer exited with ${String(code)}: ${tail.join(" / ")}`);
  }
  await writeFile(join(browsersDir, MARKER), `${JSON.stringify({ playwright: version })}\n`);
}

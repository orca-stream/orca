// ffmpeg and ffprobe for the server's downloads, fetched on the app's first start instead of shipped
// in the installer. The builds are BtbN's LGPL "shared" ones: the server only copies streams and
// turns subtitles into SRT, which needs no GPL encoder, and shared is half the size of static.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadFile } from "./download.ts";

/**
 * A month-end build: BtbN prunes its daily builds after about a month but keeps those of each
 * month's last day, so the URL and its checksum stay valid. Moving to a newer ffmpeg = a newer
 * month-end tag and the checksums from that release's `checksums.sha256`.
 */
const RELEASE = "autobuild-2026-10-31-12-59";
const RELEASES = "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download";
const VERSION = "n8.1.3-27-g8dca1586f4";

export interface FfmpegBuild {
  archive: string;
  url: string;
  sha256: string;
}

const BUILDS: Partial<Record<string, { file: string; sha256: string }>> = {
  "linux-x64": {
    file: `ffmpeg-${VERSION}-linux64-lgpl-shared-8.1.tar.xz`,
    sha256: "493e89a48da02b9a7d217b60f7f60c3c917c9bed73459d8a106e5e987da082ef",
  },
  "win32-x64": {
    file: `ffmpeg-${VERSION}-win64-lgpl-shared-8.1.zip`,
    sha256: "5cef7bc48e513f3cee7c881e8b2999d835541edb1846c3e89443a67f8f8556ab",
  },
};

/** The build for this computer; none where BtbN has none, and then the server uses the system's. */
export function ffmpegBuildFor(platform: string, arch: string): FfmpegBuild | undefined {
  const build = BUILDS[`${platform}-${arch}`];
  if (!build) return undefined;
  return { archive: build.file, url: `${RELEASES}/${RELEASE}/${build.file}`, sha256: build.sha256 };
}

/** What `installed.json` says, so a newer build in a newer app replaces the old one. */
export const FFMPEG_MARKER = "installed.json";
const MARKER = FFMPEG_MARKER;

/** The folder the server finds ffmpeg and ffprobe in. */
export function ffmpegBinDir(dir: string): string {
  return join(dir, "bin");
}

export async function ffmpegInstalled(dir: string, build: FfmpegBuild): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(dir, MARKER), "utf8")) as { archive?: unknown };
    return marker.archive === build.archive;
  } catch {
    return false;
  }
}

export interface InstallFfmpegOptions {
  dir: string;
  build: FfmpegBuild;
  onBytes: (received: number, total: number | undefined) => void;
  /** After the download, while the archive is unpacked. */
  onInstalling: () => void;
  signal: AbortSignal;
  /** Unpacks an archive into a folder; `tar` reads .tar.xz on Linux and .zip on Windows 10+. */
  extract?: (archive: string, into: string) => Promise<void>;
  fetch?: typeof fetch;
}

const run = promisify(execFile);
const tar = async (archive: string, into: string) => {
  await run("tar", ["-xf", archive, "-C", into]);
};

/** What the server runs from the build: its two programs and the libraries they load. */
const KEEP = ["bin", "lib", "LICENSE.txt"];
/** In `bin`, besides libraries (`.dll` on Windows); ffplay is never run. */
const DROP_FROM_BIN = /^ffplay(\.exe)?$/;

/**
 * Downloads the build, checks it, unpacks what the server needs into a fresh folder and swaps it in
 * for `dir`, so a half-done install is never what the server finds.
 */
export async function installFfmpeg(options: InstallFfmpegOptions): Promise<void> {
  const { dir, build, signal } = options;
  const work = `${dir}.new`;
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    const archive = join(work, build.archive);
    await downloadFile({
      url: build.url,
      to: archive,
      sha256: build.sha256,
      onBytes: options.onBytes,
      signal,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    options.onInstalling();
    const unpacked = join(work, "unpacked");
    await mkdir(unpacked);
    await (options.extract ?? tar)(archive, unpacked);
    signal.throwIfAborted();
    // The archive holds one folder, named after the build.
    const [top] = await readdir(unpacked);
    if (top === undefined) throw new Error(`${build.archive} is empty`);
    const staged = join(work, "staged");
    await mkdir(staged);
    for (const name of KEEP) {
      const from = join(unpacked, top, name);
      if (existsSync(from)) await rename(from, join(staged, name));
    }
    for (const name of await readdir(join(staged, "bin"))) {
      if (DROP_FROM_BIN.test(name)) await rm(join(staged, "bin", name));
    }
    await writeFile(join(staged, MARKER), `${JSON.stringify({ archive: build.archive })}\n`);
    await rm(dir, { recursive: true, force: true });
    await rename(staged, dir);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

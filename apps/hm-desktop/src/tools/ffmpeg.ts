// ffmpeg and ffprobe for the server's downloads, fetched on the app's first start instead of shipped
// in the installer. On Linux and Windows the builds are BtbN's LGPL "shared" ones: the server only
// copies streams and turns subtitles into SRT, which needs no GPL encoder, and shared is half the
// size of static. BtbN builds nothing for macOS: there, Martin Riedl's static release builds, one
// archive per program, signed by their author (Apple Silicon only runs signed code).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadFile } from "./download.ts";

/**
 * A month-end build: BtbN prunes its daily builds after about a month but keeps those of each
 * month's last day, so the URL and its checksum stay valid. Moving to a newer ffmpeg = a newer
 * month-end tag and the checksums from that release's `checksums.sha256`.
 */
const BTBN_RELEASE = "autobuild-2026-10-31-12-59";
const BTBN_RELEASES = "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download";
const BTBN_VERSION = "n8.1.3-27-g8dca1586f4";

/**
 * A release build (not a snapshot) from ffmpeg.martin-riedl.de, whose folders keep the build's
 * time: moving on = the newer release's folder and the `.sha256` beside each archive.
 */
const RIEDL_BUILD = "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2";

/** One archive to fetch and check. */
export interface FfmpegPart {
  file: string;
  url: string;
  sha256: string;
}

export interface FfmpegBuild {
  /** Names the build in `installed.json`: another id replaces what is installed. */
  id: string;
  parts: FfmpegPart[];
  /**
   * How the archives are laid out: `tree` is one folder with bin/, lib/ and the licence (BtbN);
   * `flat` is a lone program per archive (Martin Riedl), which goes into bin/.
   */
  layout: "tree" | "flat";
}

const btbn = (file: string, sha256: string): FfmpegBuild => ({
  // The archive's name, as the marker has always said: an installed build stays installed.
  id: file,
  parts: [{ file, url: `${BTBN_RELEASES}/${BTBN_RELEASE}/${file}`, sha256 }],
  layout: "tree",
});

const BUILDS: Partial<Record<string, FfmpegBuild>> = {
  "linux-x64": btbn(
    `ffmpeg-${BTBN_VERSION}-linux64-lgpl-shared-8.1.tar.xz`,
    "493e89a48da02b9a7d217b60f7f60c3c917c9bed73459d8a106e5e987da082ef",
  ),
  "win32-x64": btbn(
    `ffmpeg-${BTBN_VERSION}-win64-lgpl-shared-8.1.zip`,
    "5cef7bc48e513f3cee7c881e8b2999d835541edb1846c3e89443a67f8f8556ab",
  ),
  "darwin-arm64": {
    id: "martin-riedl-macos-arm64-9.0.2",
    parts: [
      {
        file: "ffmpeg.zip",
        url: `${RIEDL_BUILD}/ffmpeg.zip`,
        sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
      },
      {
        file: "ffprobe.zip",
        url: `${RIEDL_BUILD}/ffprobe.zip`,
        sha256: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
      },
    ],
    layout: "flat",
  },
};

/** The build for this computer; none where there is none, and then the server uses the system's. */
export function ffmpegBuildFor(platform: string, arch: string): FfmpegBuild | undefined {
  return BUILDS[`${platform}-${arch}`];
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
    return marker.archive === build.id;
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
  /** Unpacks an archive into a folder; `tar` reads .tar.xz on Linux and .zip on Windows 10+ and macOS. */
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
 * Downloads the build's archives side by side, checks them, unpacks what the server needs into a
 * fresh folder and swaps it in for `dir`, so a half-done install is never what the server finds.
 */
export async function installFfmpeg(options: InstallFfmpegOptions): Promise<void> {
  const { dir, build, signal } = options;
  const work = `${dir}.new`;
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    // The bytes of every part add up; the size only once every part has said its own.
    const received = build.parts.map(() => 0);
    const totals: (number | undefined)[] = build.parts.map(() => undefined);
    const report = () => {
      const known = totals.every((total) => total !== undefined);
      options.onBytes(
        received.reduce((sum, bytes) => sum + bytes, 0),
        known ? totals.reduce<number>((sum, total) => sum + (total ?? 0), 0) : undefined,
      );
    };
    await Promise.all(
      build.parts.map((part, index) =>
        downloadFile({
          url: part.url,
          to: join(work, part.file),
          sha256: part.sha256,
          onBytes: (bytes, total) => {
            received[index] = bytes;
            totals[index] = total;
            report();
          },
          signal,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
      ),
    );
    options.onInstalling();
    const staged = join(work, "staged");
    await mkdir(staged);
    for (const [index, part] of build.parts.entries()) {
      const unpacked = join(work, `unpacked-${index}`);
      await mkdir(unpacked);
      await (options.extract ?? tar)(join(work, part.file), unpacked);
      signal.throwIfAborted();
      if (build.layout === "tree") await keepTree(unpacked, part.file, staged);
      else await keepFlat(unpacked, part.file, staged);
    }
    for (const name of await readdir(join(staged, "bin"))) {
      if (DROP_FROM_BIN.test(name)) await rm(join(staged, "bin", name));
    }
    await writeFile(join(staged, MARKER), `${JSON.stringify({ archive: build.id })}\n`);
    await rm(dir, { recursive: true, force: true });
    await rename(staged, dir);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** BtbN's archive holds one folder, named after the build: its bin/, lib/ and licence. */
async function keepTree(unpacked: string, file: string, staged: string): Promise<void> {
  const [top] = await readdir(unpacked);
  if (top === undefined) throw new Error(`${file} is empty`);
  for (const name of KEEP) {
    const from = join(unpacked, top, name);
    if (existsSync(from)) await rename(from, join(staged, name));
  }
}

/** A lone program: into bin/, runnable whatever the archive kept of its mode. */
async function keepFlat(unpacked: string, file: string, staged: string): Promise<void> {
  const names = await readdir(unpacked);
  if (names.length === 0) throw new Error(`${file} is empty`);
  await mkdir(join(staged, "bin"), { recursive: true });
  for (const name of names) {
    const to = join(staged, "bin", name);
    await rename(join(unpacked, name), to);
    await chmod(to, 0o755);
  }
}

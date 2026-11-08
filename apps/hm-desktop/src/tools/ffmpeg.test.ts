import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { downloadFile, DownloadError } from "./download.ts";
import { ffmpegBuildFor, ffmpegInstalled, installFfmpeg, type FfmpegBuild } from "./ffmpeg.ts";

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const archive = new TextEncoder().encode("pretend this is a .tar.xz");
const serve = (body: Uint8Array<ArrayBuffer>) =>
  (async () =>
    new Response(body, { headers: { "content-length": String(body.length) } })) as typeof fetch;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orca-hm-tools-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ffmpegBuildFor", () => {
  it("pins a checked build for Linux and Windows on x64, and none elsewhere", () => {
    const linux = ffmpegBuildFor("linux", "x64");
    expect(linux?.url).toMatch(
      /^https:\/\/github\.com\/.+\/autobuild-2026-10-31-12-59\/.+linux64-lgpl-shared-8\.1\.tar\.xz$/,
    );
    expect(linux?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ffmpegBuildFor("win32", "x64")?.archive).toMatch(/win64-lgpl-shared-8\.1\.zip$/);
    expect(ffmpegBuildFor("darwin", "arm64")).toBeUndefined();
  });
});

describe("downloadFile", () => {
  it("reports the bytes and keeps the file only once its checksum matches", async () => {
    const to = join(dir, "a.bin");
    const seen: (number | undefined)[][] = [];
    await downloadFile({
      url: "https://downloads.example/a.bin",
      to,
      sha256: sha(archive),
      onBytes: (received, total) => seen.push([received, total]),
      signal: new AbortController().signal,
      fetch: serve(archive),
    });
    expect(await readFile(to)).toEqual(Buffer.from(archive));
    expect(seen.at(-1)).toEqual([archive.length, archive.length]);
  });

  it("fetches a big file in parallel ranges from the address it was redirected to", async () => {
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 7) % 251);
    const asked: string[] = [];
    const ranged = (async (input: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range") ?? "";
      asked.push(`${input} ${range}`);
      const [start, end] = /bytes=(\d+)-(\d+)/.exec(range)!.slice(1).map(Number) as [
        number,
        number,
      ];
      const response = new Response(big.slice(start, end + 1), {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${big.length}` },
      });
      Object.defineProperty(response, "url", { value: "https://cdn.example/signed" });
      return response;
    }) as typeof fetch;
    const to = join(dir, "big.bin");
    let last = 0;
    await downloadFile({
      url: "https://downloads.example/big.bin",
      to,
      sha256: sha(big),
      onBytes: (received, total) => {
        expect(total).toBe(big.length);
        last = received;
      },
      signal: new AbortController().signal,
      connections: 4,
      fetch: ranged,
    });
    expect(await readFile(to)).toEqual(Buffer.from(big));
    expect(last).toBe(big.length);
    expect(asked).toHaveLength(5);
    expect(asked[0]).toBe("https://downloads.example/big.bin bytes=0-0");
    expect(asked.slice(1).every((line) => line.startsWith("https://cdn.example/signed "))).toBe(
      true,
    );
  });

  it("leaves nothing behind when the checksum differs", async () => {
    const to = join(dir, "a.bin");
    const error = await downloadFile({
      url: "https://downloads.example/a.bin",
      to,
      sha256: "0".repeat(64),
      onBytes: () => {},
      signal: new AbortController().signal,
      fetch: serve(archive),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("names the host and the network's reason when it cannot connect", async () => {
    const error = await downloadFile({
      url: "https://downloads.example/a.bin",
      to: join(dir, "a.bin"),
      sha256: sha(archive),
      onBytes: () => {},
      signal: new AbortController().signal,
      fetch: (async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      }) as typeof fetch,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("downloads.example: ECONNREFUSED");
  });

  it("fails on an error status", async () => {
    const error = await downloadFile({
      url: "https://downloads.example/gone",
      to: join(dir, "a.bin"),
      sha256: sha(archive),
      onBytes: () => {},
      signal: new AbortController().signal,
      fetch: (async () => new Response("no", { status: 404 })) as typeof fetch,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toContain("404");
  });
});

describe("installFfmpeg", () => {
  const build: FfmpegBuild = {
    archive: "ffmpeg-n8-linux64-lgpl-shared-8.1.tar.xz",
    url: "https://downloads.example/ffmpeg.tar.xz",
    sha256: sha(archive),
  };
  /** Lays the archive out the way BtbN's builds are: one folder with bin/, lib/, docs and headers. */
  const extract = async (_archive: string, into: string) => {
    const top = join(into, "ffmpeg-n8-linux64-lgpl-shared-8.1");
    for (const sub of ["bin", "lib", "include", "doc"])
      await mkdir(join(top, sub), { recursive: true });
    for (const name of ["ffmpeg", "ffprobe", "ffplay"])
      await writeFile(join(top, "bin", name), name);
    await writeFile(join(top, "lib", "libavcodec.so.62"), "lib");
    await writeFile(join(top, "LICENSE.txt"), "LGPL");
  };

  it("keeps ffmpeg, ffprobe, their libraries and the licence, and marks the build", async () => {
    const target = join(dir, "ffmpeg");
    const phases: string[] = [];
    await installFfmpeg({
      dir: target,
      build,
      onBytes: () => phases.push("bytes"),
      onInstalling: () => phases.push("installing"),
      signal: new AbortController().signal,
      extract,
      fetch: serve(archive),
    });
    expect(readdirSync(target).sort()).toEqual(["LICENSE.txt", "bin", "installed.json", "lib"]);
    expect(readdirSync(join(target, "bin")).sort()).toEqual(["ffmpeg", "ffprobe"]);
    expect(phases.at(-1)).toBe("installing");
    expect(await ffmpegInstalled(target, build)).toBe(true);
    expect(await ffmpegInstalled(target, { ...build, archive: "a-newer-build.tar.xz" })).toBe(
      false,
    );
    expect(existsSync(`${target}.new`)).toBe(false);
  });

  it("keeps the build already installed when the new one fails to download", async () => {
    const target = join(dir, "ffmpeg");
    const options = {
      dir: target,
      build,
      onBytes: () => {},
      onInstalling: () => {},
      signal: new AbortController().signal,
      extract,
    };
    await installFfmpeg({ ...options, fetch: serve(archive) });
    const error = await installFfmpeg({
      ...options,
      build: { ...build, archive: "newer.tar.xz", sha256: "0".repeat(64) },
      fetch: serve(archive),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(await ffmpegInstalled(target, build)).toBe(true);
    expect(existsSync(`${target}.new`)).toBe(false);
  });
});

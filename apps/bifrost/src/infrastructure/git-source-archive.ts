import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SourceArchive, SourceTarball } from "../application/ports/source-archive.ts";
import { BifrostError } from "../domain/errors.ts";

const exec = promisify(execFile);
const MAX_BUFFER = 1024 * 1024;

/** The git checkout this file lives in. Arguments are never passed through a shell. */
export class GitSourceArchive implements SourceArchive {
  private readonly dir: string;

  constructor(dir: string = dirname(fileURLToPath(import.meta.url))) {
    this.dir = dir;
  }

  private async git(...args: string[]): Promise<string> {
    try {
      const { stdout } = await exec("git", ["-C", this.dir, ...args], { maxBuffer: MAX_BUFFER });
      return stdout.trim();
    } catch (e) {
      throw new BifrostError(
        `git ${args[0]} failed: ${(e as { stderr?: string }).stderr?.trim() ?? (e as Error).message}`,
      );
    }
  }

  async resolve(ref: string): Promise<string> {
    // `--end-of-options` keeps a ref that looks like a flag from being read as one.
    return this.git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
  }

  async archive(commit: string): Promise<SourceTarball> {
    const root = await this.git("rev-parse", "--show-toplevel");
    const tmp = await mkdtemp(join(tmpdir(), "bifrost-hm-"));
    const path = join(tmp, "src.tar");
    try {
      await this.git("-C", root, "archive", "--format=tar", "-o", path, commit);
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw e;
    }
    return { path, dispose: () => rm(tmp, { recursive: true, force: true }) };
  }
}

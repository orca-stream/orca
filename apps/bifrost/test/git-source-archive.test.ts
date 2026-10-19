import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { GitSourceArchive } from "../src/infrastructure/git-source-archive.ts";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "bifrost-git-"));
  const git = (...a: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], {
      encoding: "utf8",
    });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "apps"));
  writeFileSync(join(dir, "apps/a.txt"), "a");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  writeFileSync(join(dir, "untracked.txt"), "x");
  return { dir, git };
}

describe("GitSourceArchive", () => {
  it("resolves a ref to the full commit and archives only tracked files", async () => {
    const { dir, git } = repo();
    const src = new GitSourceArchive(dir);
    const commit = await src.resolve("HEAD");
    expect(commit).toBe(git("rev-parse", "HEAD").trim());
    const tarball = await src.archive(commit);
    const listing = execFileSync("tar", ["-tf", tarball.path], { encoding: "utf8" });
    expect(listing).toContain("apps/a.txt");
    expect(listing).not.toContain("untracked.txt");
    await tarball.dispose();
    expect(existsSync(tarball.path)).toBe(false);
  });

  it("fails clearly on an unknown ref and never reads a flag as a ref", async () => {
    const src = new GitSourceArchive(repo().dir);
    await expect(src.resolve("nope")).rejects.toThrow(/rev-parse failed/);
    await expect(src.resolve("--output=/tmp/x")).rejects.toThrow(/rev-parse failed/);
  });
});

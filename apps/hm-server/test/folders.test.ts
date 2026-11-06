import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AppError } from "../src/domain/errors.ts";
import { listFolders } from "../src/infrastructure/folders.ts";

describe("listing the server's folders", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hm-folders-"));
    for (const name of ["tv", "Anime 10", "Anime 9", ".cache"]) await mkdir(join(root, name));
    await writeFile(join(root, "notes.txt"), "");
    await symlink(join(root, "tv"), join(root, "shows"));
    await symlink(join(root, "missing"), join(root, "broken"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("gives the folders inside, in natural order, without files or hidden ones", async () => {
    const listing = await listFolders(root);
    expect(listing.path).toBe(root);
    expect(listing.folders.map((f) => f.name)).toEqual(["Anime 9", "Anime 10", "shows", "tv"]);
    expect(listing.folders[3]).toEqual({ name: "tv", path: join(root, "tv") });
  });

  it("starts at the home folder and knows where to go up", async () => {
    const listing = await listFolders(undefined, join(root, "tv"));
    expect(listing).toEqual({ path: join(root, "tv"), parent: root, folders: [] });
    expect((await listFolders("/")).parent).toBeNull();
  });

  it("says why it cannot list a folder", async () => {
    await expect(listFolders("relative/path")).rejects.toMatchObject({ code: "bad_request" });
    await expect(listFolders(join(root, "nope"))).rejects.toMatchObject({ code: "not_found" });
    await expect(listFolders(join(root, "notes.txt"))).rejects.toBeInstanceOf(AppError);
  });
});

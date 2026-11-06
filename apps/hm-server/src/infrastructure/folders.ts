import type { FolderListing } from "@orca/hm-contract";
import type { Dirent } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AppError } from "../domain/errors.ts";

/**
 * The folders inside one folder of this server's disk, for the panel to pick the series folder
 * from, the way Jellyfin picks a library's: names and paths only, never files or what is in them.
 * Hidden folders (a leading dot) are left out. Starts at the home folder of whoever runs H&M.
 */
export async function listFolders(path?: string, home = homedir()): Promise<FolderListing> {
  if (path !== undefined && !isAbsolute(path)) {
    throw new AppError("bad_request", "The folder must be an absolute path");
  }
  const folder = resolve(path ?? home);
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    throw folderError(error, folder);
  }
  const folders: FolderListing["folders"] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = join(folder, entry.name);
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await isFolder(child)))) {
      folders.push({ name: entry.name, path: child });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const parent = dirname(folder);
  return { path: folder, parent: parent === folder ? null : parent, folders };
}

/** Makes one folder inside `parent` (never its parents), and says where it is. */
export async function makeFolder(parent: string, name: string): Promise<{ path: string }> {
  if (!isAbsolute(parent)) throw new AppError("bad_request", "The folder must be an absolute path");
  const path = join(resolve(parent), name);
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AppError("conflict", `${path} already exists`);
    }
    throw folderError(error, resolve(parent));
  }
  return { path };
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function folderError(error: unknown, folder: string): AppError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return new AppError("not_found", `There is no folder ${folder}`);
  if (code === "ENOTDIR") return new AppError("bad_request", `${folder} is not a folder`);
  if (code === "EACCES" || code === "EPERM") {
    return new AppError("forbidden", `H&M may not read ${folder}`);
  }
  return new AppError("unavailable", `Could not read ${folder}`, { cause: error });
}

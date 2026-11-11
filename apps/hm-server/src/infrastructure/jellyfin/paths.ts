/**
 * Paths as two machines write them: this server's (`C:\Videos\Shows` on Windows, `/srv/tv` elsewhere)
 * and Jellyfin's, which may be another system altogether. Never `node:path`: that only knows the
 * system this server runs on, and Jellyfin's paths are of the system Jellyfin runs on.
 */

/** A Windows path: a drive (`C:\`, `c:/`) or a share (`\\host\share`). Its letters' case is not told apart. */
const isWindows = (path: string) => /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith("\\\\");

/** The separator a path is written with: `\` for a Windows one, `/` otherwise. */
const separatorOf = (path: string) => (isWindows(path) ? "\\" : "/");

/** Without the separators it ends with; a root (`/`, `C:\`) keeps its own. */
function trimEnd(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "") return path.slice(0, 1);
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

/** For comparing: one separator, none at the end, and a Windows path in lower case. */
function comparable(path: string): string {
  const forward = trimEnd(path).replace(/\\/g, "/").replace(/\/+$/, "");
  return isWindows(path) ? forward.toLowerCase() : forward;
}

/**
 * What `path` is under `folder`, with `/` between its parts: `""` when it is the folder itself, null
 * when it is not under it.
 */
export function relativeTo(path: string, folder: string): string | null {
  const one = comparable(path);
  const other = comparable(folder);
  if (one === other) return "";
  if (!one.startsWith(`${other}/`)) return null;
  return trimEnd(path)
    .replace(/\\/g, "/")
    .slice(other.length + 1);
}

export const isUnder = (path: string, folder: string) => relativeTo(path, folder) !== null;

/** `relative` (parts split by `/`) inside `folder`, written with the folder's own separator. */
export function inside(folder: string, relative: string): string {
  const root = trimEnd(folder);
  if (relative === "") return root;
  const separator = separatorOf(folder);
  const base = root.endsWith(separator) ? root.slice(0, -1) : root;
  return `${base}${separator}${relative.split("/").join(separator)}`;
}

/** The folder holding `path` (a file), with either separator. */
export function parentOf(path: string): string {
  const trimmed = trimEnd(path);
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? trimmed : trimEnd(trimmed.slice(0, cut + 1));
}

/** Whether two paths name the same place (a Windows one whatever its case). */
export const samePath = (one: string, other: string) => comparable(one) === comparable(other);

/** `path` from one folder to another: `C:\Videos\Shows\X` from `C:\Videos\Shows` to `/data/tv` is `/data/tv/X`. */
export function moveBetween(path: string, from: string, to: string): string | null {
  const relative = relativeTo(path, from);
  return relative === null ? null : inside(to, relative);
}

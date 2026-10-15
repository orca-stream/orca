import { AVATAR_ICONS, type AvatarIcon } from "./avatar-icons";

/** One row of the icon picker: a folder of `avatars/`, or the built-in faces. */
export interface AvatarCategory {
  /** The folder's name, or null for the built-in faces (the UI names them). */
  title: string | null;
  icons: AvatarIcon[];
}

/** "02 Anime" → "Anime": a leading number only orders the folders. */
function folderTitle(folder: string): string {
  return folder.replace(/^\d+[\s._-]*/, "") || folder;
}

/**
 * Groups the library's files into rows by folder (`avatars/<folder>/<file>`), both sorted by name.
 * Files right under `avatars/` and empty folders are ignored. The built-in faces come last, so the
 * owner's own library leads.
 */
export function groupLibrary(
  files: Record<string, string>,
  builtIn: readonly AvatarIcon[] = AVATAR_ICONS,
): AvatarCategory[] {
  const folders = new Map<string, AvatarIcon[]>();
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

  for (const path of Object.keys(files).sort(byName)) {
    const match = /avatars\/([^/]+)\/[^/]+$/.exec(path);
    if (!match) continue;
    const folder = match[1]!;
    const icons = folders.get(folder) ?? [];
    icons.push({ id: path, url: files[path]! });
    folders.set(folder, icons);
  }

  return [
    ...[...folders.keys()]
      .sort(byName)
      .map((folder) => ({ title: folderTitle(folder), icons: folders.get(folder)! })),
    ...(builtIn.length > 0 ? [{ title: null, icons: [...builtIn] }] : []),
  ];
}

/**
 * The owner's avatar library: images dropped in `avatars/<category>/` at the repo root. Bundled
 * with the app (hashed URLs), so every device offers the same icons.
 */
export const AVATAR_LIBRARY = groupLibrary(
  import.meta.glob<string>("/avatars/*/*.{png,jpg,jpeg,webp,avif,gif,svg}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
);

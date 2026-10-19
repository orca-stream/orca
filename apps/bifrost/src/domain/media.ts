/** The slice of `host` that decides where media lives; structural so the config schema can use it. */
export interface MediaHost {
  dataDir: string;
  mediaDisk?: { mount: string } | undefined;
  mediaMounts?: { source: string; target: string; readOnly: boolean }[] | undefined;
}

/** Where Jellyfin sees the default media volume inside its container. */
export const JELLYFIN_MEDIA_TARGET = "/media";

/** The media directory when no disk is configured: part of the data dir, owned by root, read-only to Jellyfin. */
export function mediaRoot(host: MediaHost): string {
  return host.mediaDisk?.mount ?? `${host.dataDir}/media`;
}

/** The media volumes Jellyfin gets: the configured ones, or the media root read-only. */
export function mediaMounts(
  host: MediaHost,
): { source: string; target: string; readOnly: boolean }[] {
  return (
    host.mediaMounts ?? [{ source: mediaRoot(host), target: JELLYFIN_MEDIA_TARGET, readOnly: true }]
  );
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * The path a host directory has inside Jellyfin's container, through the longest mount that contains
 * it. H&M mounts the same directory at that same path, so the paths it reports to Jellyfin match.
 */
export function jellyfinPathOf(host: MediaHost, hostPath: string): string | undefined {
  const mounts = mediaMounts(host)
    .filter((m) => isUnder(hostPath, m.source))
    .sort((a, b) => b.source.length - a.source.length);
  const best = mounts[0];
  if (!best) return undefined;
  const rest = hostPath.slice(best.source.length).replace(/^\/+/, "");
  const base = best.target.replace(/\/+$/, "");
  return rest ? `${base}/${rest}` : best.target;
}

/** Whether `path` is one of `libraryPaths` or inside one. */
export function insideAny(path: string, libraryPaths: string[]): boolean {
  return libraryPaths.some((p) => isUnder(path, p));
}

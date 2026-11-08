// Reads the app's own APT repository directly: one small `Packages` file says which version it
// serves, in under a second. Asking PackageKit instead refreshes every source on the system (23 on
// the laptop it was measured on: ~7 s), for the one package that matters here. The index is not
// verified here; it only decides whether to offer a version. apt verifies the signature when it
// installs it.

/** How long reading the repository's index may take. */
const FETCH_TIMEOUT_MS = 30_000;

/** The repository's address from the deb822 source the .deb installs (scripts/apt.ts). */
export function repositoryUrlFrom(source: string): string | undefined {
  const uri = /^URIs:\s*(\S+)\s*$/m.exec(source)?.[1];
  return uri?.replace(/\/+$/, "");
}

/** The newest version of `name` a `Packages` index lists, if any. */
export function latestVersion(packages: string, name: string): string | undefined {
  let latest: string | undefined;
  for (const stanza of packages.split(/\n\s*\n/)) {
    const pkg = /^Package:\s*(\S+)/m.exec(stanza)?.[1];
    const version = /^Version:\s*(\S+)/m.exec(stanza)?.[1];
    if (pkg === name && version && (!latest || isNewer(version, latest))) latest = version;
  }
  return latest;
}

/**
 * Whether `candidate` is newer than `current`. The app's versions are plain `x.y.z` (release-please,
 * no prerelease part): compared number by number.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10));
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/** The newest version of `name` the repository at `url` serves; rejects when it cannot be read. */
export async function fetchLatestVersion(
  url: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const response = await fetchImpl(`${url}/Packages`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url}/Packages answered ${response.status}.`);
  return latestVersion(await response.text(), name);
}

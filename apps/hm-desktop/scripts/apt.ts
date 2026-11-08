// What the .deb needs to add the app's own APT repository on install, so that its updates arrive
// like any other package's (Chrome, VS Code and others do the same). Pure, for scripts/deb.ts.

/** The repository's settings, from the build's environment. Both or neither. */
export interface AptRepository {
  /** Where the repository is served, a flat one: e.g. a GitHub release's download URL. */
  url: string;
  /** The public key that signs it, as `gpg --export` writes it (binary, not armored). */
  key: Uint8Array;
}

/**
 * Reads the repository from the environment: HM_APT_URL and HM_APT_KEY_FILE. Without either, the
 * .deb adds no repository (a local build); with only one, the build fails rather than ship a half.
 */
export function aptRepositoryFrom(
  env: Record<string, string | undefined>,
  readKey: (path: string) => Uint8Array,
): AptRepository | undefined {
  const url = env.HM_APT_URL?.trim();
  const keyFile = env.HM_APT_KEY_FILE?.trim();
  if (!url && !keyFile) return undefined;
  if (!url || !keyFile) {
    throw new Error("Set both HM_APT_URL and HM_APT_KEY_FILE, or neither.");
  }
  if (!/^https?:\/\/[^/]/.test(url)) throw new Error(`HM_APT_URL is not a web address: ${url}`);
  const key = readKey(keyFile);
  if (new TextDecoder().decode(key.slice(0, 10)).startsWith("-----")) {
    throw new Error("HM_APT_KEY_FILE is armored: export it with `gpg --export`, without --armor.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/** The deb822 source for `name`'s repository: a flat one, signed by the package's own key. */
export function aptSource(name: string, url: string): string {
  return [
    `# Added by the ${name} package, which removes it when uninstalled.`,
    "Types: deb",
    `URIs: ${url}/`,
    "Suites: ./",
    `Signed-By: /usr/share/keyrings/${name}.gpg`,
    "",
  ].join("\n");
}

// The scripts below are appended to electron-builder's own after-install and after-remove (which
// link the binary, set up the sandbox and the AppArmor profile). They go through its templating,
// where `${name}` is a macro: only `${executable}` and `${sanitizedProductName}` may appear.

/**
 * Installs the repository's source and key when the build carried them, and removes them when it
 * did not: a local build installed over a released one never updates, so it keeps no source.
 */
export const AFTER_INSTALL = `
# The app's own APT repository (apps/hm-desktop/scripts/apt.ts): its updates then arrive with the
# system's. A local build carries none, and leaves none behind.
APT_FILES='/opt/\${sanitizedProductName}/resources/apt'
if [ -f "$APT_FILES/\${executable}.sources" ] && [ -f "$APT_FILES/\${executable}.gpg" ]; then
  install -D -m 644 "$APT_FILES/\${executable}.gpg" '/usr/share/keyrings/\${executable}.gpg'
  install -D -m 644 "$APT_FILES/\${executable}.sources" '/etc/apt/sources.list.d/\${executable}.sources'
else
  rm -f '/etc/apt/sources.list.d/\${executable}.sources' '/usr/share/keyrings/\${executable}.gpg'
fi
`;

/** Removes them on uninstall; an upgrade keeps them. */
export const AFTER_REMOVE = `
# The app's own APT repository: gone with the app, kept across an upgrade.
case "$1" in
  remove|purge)
    rm -f '/etc/apt/sources.list.d/\${executable}.sources' '/usr/share/keyrings/\${executable}.gpg'
    ;;
esac
`;

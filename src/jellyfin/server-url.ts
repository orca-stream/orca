/**
 * Normalizes whatever the user typed as their Jellyfin server address into the base URL the SDK
 * expects: scheme present, no trailing slash, and no `/web` client path. People routinely paste the
 * address bar of jellyfin-web (`https://host/web/#/home`), which is not the API root.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("Server address is empty");
  }

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Not a valid server address: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  const path = url.pathname.replace(/\/web(\/.*)?$/i, "").replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}
